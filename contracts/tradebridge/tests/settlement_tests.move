#[test_only]
module tradebridge::settlement_tests;

use sui::clock;
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self, Scenario};
use tradebridge::settlement::{Self, Registry, VerifierCap, AdminCap, Intent, Agreement, Escrow};

public struct BOND has drop {}
public struct CASH has drop {}
const ADMIN: address = @0xa;
const BUYER: address = @0x1;
const BROKER: address = @0x2;

fun receipt(value: u8): vector<u8> {
    let mut bytes = vector[];
    let mut i = 0u64;
    while (i < 32) { bytes.push_back(value); i = i + 1; };
    bytes
}
fun setup(): Scenario {
    let mut s = test_scenario::begin(ADMIN);
    settlement::init_for_testing(s.ctx());
    s.next_tx(BUYER);
    let registry = s.take_shared<Registry>();
    let clock = clock::create_for_testing(s.ctx());
    settlement::propose<BOND, CASH>(&registry, b"TB-001", 2, receipt(7), BUYER, BROKER, BUYER, BROKER, 1000, 1000, 0, 0, 1000000, 10000, &clock, s.ctx());
    test_scenario::return_shared(registry);
    clock::destroy_for_testing(clock);
    s
}
fun approve(s: &mut Scenario, broker: bool) { approve_with_receipts(s, broker, 1); }
fun approve_with_receipts(s: &mut Scenario, broker: bool, receipt_id: u8) {
    s.next_tx(ADMIN);
    let cap = s.take_from_sender<VerifierCap>();
    let registry = s.take_shared<Registry>();
    let mut intent = s.take_shared<Intent<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    settlement::attest(&cap, &registry, &mut intent, receipt(receipt_id), receipt(receipt_id + 1), 5000, &clock);
    s.return_to_sender(cap);
    test_scenario::return_shared(registry);
    test_scenario::return_shared(intent);
    clock::destroy_for_testing(clock);
    s.next_tx(BUYER);
    let mut intent = s.take_shared<Intent<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    settlement::approve_buyer(&mut intent, &clock, s.ctx());
    test_scenario::return_shared(intent);
    clock::destroy_for_testing(clock);
    if (broker) {
        s.next_tx(BROKER);
        let mut intent = s.take_shared<Intent<BOND, CASH>>();
        let clock = clock::create_for_testing(s.ctx());
        settlement::approve_broker(&mut intent, &clock, s.ctx());
        test_scenario::return_shared(intent);
        clock::destroy_for_testing(clock);
    };
}
fun commit(s: &mut Scenario) {
    s.next_tx(ADMIN);
    let mut registry = s.take_shared<Registry>();
    let intent = s.take_shared<Intent<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    settlement::commit(&mut registry, intent, &clock, s.ctx());
    test_scenario::return_shared(registry);
    clock::destroy_for_testing(clock);
}
fun committed(): Scenario {
    let mut s = setup(); approve(&mut s, true); commit(&mut s); s
}
fun fund_bond(s: &mut Scenario, sender: address, amount: u64) {
    s.next_tx(sender);
    let registry = s.take_shared<Registry>();
    let agreement = s.take_immutable<Agreement<BOND, CASH>>();
    let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    let coin = coin::mint_for_testing<BOND>(amount, s.ctx());
    settlement::deposit_bond(&registry, &agreement, &mut escrow, coin, &clock, s.ctx());
    test_scenario::return_shared(registry); test_scenario::return_shared(escrow);
    test_scenario::return_immutable(agreement); clock::destroy_for_testing(clock);
}
fun fund_cash(s: &mut Scenario) {
    s.next_tx(BUYER);
    let registry = s.take_shared<Registry>();
    let agreement = s.take_immutable<Agreement<BOND, CASH>>();
    let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    let coin = coin::mint_for_testing<CASH>(1000000, s.ctx());
    settlement::deposit_cash(&registry, &agreement, &mut escrow, coin, &clock, s.ctx());
    test_scenario::return_shared(registry); test_scenario::return_shared(escrow);
    test_scenario::return_immutable(agreement); clock::destroy_for_testing(clock);
}
fun settle(s: &mut Scenario) {
    s.next_tx(ADMIN);
    let registry = s.take_shared<Registry>();
    let agreement = s.take_immutable<Agreement<BOND, CASH>>();
    let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    settlement::settle(&registry, &agreement, &mut escrow, &clock, s.ctx());
    test_scenario::return_shared(registry); test_scenario::return_shared(escrow);
    test_scenario::return_immutable(agreement); clock::destroy_for_testing(clock);
}
#[test]
fun atomic_delivery_and_payment() {
    let mut s = committed(); fund_bond(&mut s, BROKER, 1000); fund_cash(&mut s); settle(&mut s);
    s.next_tx(BUYER);
    let bond = s.take_from_sender<Coin<BOND>>(); assert!(bond.value() == 1000); coin::burn_for_testing(bond);
    s.next_tx(BROKER);
    let cash = s.take_from_sender<Coin<CASH>>(); assert!(cash.value() == 1000000); coin::burn_for_testing(cash);
    s.end();
}
#[test]
fun partial_deposits_sum_to_exact_amount() {
    let mut s = committed(); fund_bond(&mut s, BROKER, 400); fund_bond(&mut s, BROKER, 600); fund_cash(&mut s); settle(&mut s); s.end();
}
#[test, expected_failure(abort_code = 6, location = tradebridge::settlement)]
fun one_sided_funding_cannot_settle() { let mut s = committed(); fund_bond(&mut s, BROKER, 1000); settle(&mut s); s.end(); }
#[test, expected_failure(abort_code = 0, location = tradebridge::settlement)]
fun buyer_cannot_deposit_brokers_bond() { let mut s = committed(); fund_bond(&mut s, BUYER, 1000); s.end(); }
#[test, expected_failure(abort_code = 6, location = tradebridge::settlement)]
fun overfunding_is_rejected() { let mut s = committed(); fund_bond(&mut s, BROKER, 1100); s.end(); }
#[test, expected_failure(abort_code = 5, location = tradebridge::settlement)]
fun duplicate_settlement_is_rejected() { let mut s = committed(); fund_bond(&mut s, BROKER, 1000); fund_cash(&mut s); settle(&mut s); settle(&mut s); s.end(); }
#[test, expected_failure(abort_code = 3, location = tradebridge::settlement)]
fun one_approval_cannot_commit() { let mut s = setup(); approve(&mut s, false); commit(&mut s); s.end(); }
#[test, expected_failure(abort_code = 3, location = tradebridge::settlement)]
fun unattested_wallet_approval_is_rejected() {
    let mut s = setup(); s.next_tx(BUYER);
    let mut intent = s.take_shared<Intent<BOND, CASH>>(); let clock = clock::create_for_testing(s.ctx());
    settlement::approve_buyer(&mut intent, &clock, s.ctx());
    test_scenario::return_shared(intent); clock::destroy_for_testing(clock); s.end();
}
#[test, expected_failure(abort_code = 0, location = tradebridge::settlement)]
fun wrong_sender_cannot_approve() {
    let mut s = setup(); approve(&mut s, true); s.next_tx(ADMIN);
    let mut intent = s.take_shared<Intent<BOND, CASH>>(); let clock = clock::create_for_testing(s.ctx());
    settlement::approve_buyer(&mut intent, &clock, s.ctx());
    test_scenario::return_shared(intent); clock::destroy_for_testing(clock); s.end();
}
#[test]
fun cancelled_partial_funding_refunds_original_funder() {
    let mut s = committed(); fund_bond(&mut s, BROKER, 500); s.next_tx(BUYER);
    let agreement = s.take_immutable<Agreement<BOND, CASH>>(); let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    settlement::cancel(&agreement, &mut escrow, s.ctx());
    test_scenario::return_immutable(agreement); test_scenario::return_shared(escrow);
    s.next_tx(BROKER);
    let agreement = s.take_immutable<Agreement<BOND, CASH>>(); let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    let clock = clock::create_for_testing(s.ctx());
    settlement::refund_bond(&agreement, &mut escrow, &clock, s.ctx());
    test_scenario::return_immutable(agreement); test_scenario::return_shared(escrow); clock::destroy_for_testing(clock);
    s.next_tx(BROKER); let refunded = s.take_from_sender<Coin<BOND>>(); assert!(refunded.value() == 500); coin::burn_for_testing(refunded); s.end();
}
#[test]
fun expired_cash_refunds_buyer() {
    let mut s = committed(); fund_cash(&mut s); s.next_tx(BUYER);
    let agreement = s.take_immutable<Agreement<BOND, CASH>>(); let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    let mut clock = clock::create_for_testing(s.ctx()); clock::set_for_testing(&mut clock, 10000);
    settlement::refund_cash(&agreement, &mut escrow, &clock, s.ctx());
    test_scenario::return_immutable(agreement); test_scenario::return_shared(escrow); clock::destroy_for_testing(clock);
    s.next_tx(BUYER); let refunded = s.take_from_sender<Coin<CASH>>(); assert!(refunded.value() == 1000000); coin::burn_for_testing(refunded); s.end();
}
#[test, expected_failure(abort_code = 0, location = tradebridge::settlement)]
fun operator_cannot_redirect_refund() {
    let mut s = committed(); fund_bond(&mut s, BROKER, 1000); s.next_tx(ADMIN);
    let agreement = s.take_immutable<Agreement<BOND, CASH>>(); let mut escrow = s.take_shared<Escrow<BOND, CASH>>();
    let mut clock = clock::create_for_testing(s.ctx()); clock::set_for_testing(&mut clock, 10000);
    settlement::refund_bond(&agreement, &mut escrow, &clock, s.ctx());
    test_scenario::return_immutable(agreement); test_scenario::return_shared(escrow); clock::destroy_for_testing(clock); s.end();
}
#[test, expected_failure(abort_code = 2, location = tradebridge::settlement)]
fun expired_approvals_cannot_commit() {
    let mut s = setup(); approve(&mut s, true); s.next_tx(ADMIN);
    let mut registry = s.take_shared<Registry>(); let intent = s.take_shared<Intent<BOND, CASH>>();
    let mut clock = clock::create_for_testing(s.ctx()); clock::set_for_testing(&mut clock, 5000);
    settlement::commit(&mut registry, intent, &clock, s.ctx());
    test_scenario::return_shared(registry); clock::destroy_for_testing(clock); s.end();
}
#[test, expected_failure(abort_code = 0, location = tradebridge::settlement)]
fun rotated_verifier_invalidates_uncommitted_attestations() {
    let mut s = setup(); approve(&mut s, true); s.next_tx(ADMIN);
    let admin = s.take_from_sender<AdminCap>(); let mut registry = s.take_shared<Registry>();
    settlement::rotate_verifier(&admin, &mut registry, @0xb, s.ctx());
    s.return_to_sender(admin); test_scenario::return_shared(registry);
    commit(&mut s); s.end();
}
fun propose_amendment(s: &mut Scenario) {
    s.next_tx(BUYER);
    let registry = s.take_shared<Registry>(); let clock = clock::create_for_testing(s.ctx());
    settlement::propose<BOND, CASH>(&registry, b"TB-001", 3, receipt(8), BUYER, BROKER, BUYER, BROKER, 1000, 1200, 0, 0, 1200000, 10000, &clock, s.ctx());
    test_scenario::return_shared(registry); clock::destroy_for_testing(clock);
}
#[test, expected_failure(abort_code = 4, location = tradebridge::settlement)]
fun consumed_verification_receipts_cannot_be_reused() {
    let mut s = committed(); propose_amendment(&mut s); approve(&mut s, true); s.end();
}
#[test, expected_failure(abort_code = 5, location = tradebridge::settlement)]
fun funded_agreement_cannot_be_superseded_without_refund() {
    let mut s = committed(); fund_bond(&mut s, BROKER, 500); propose_amendment(&mut s); approve_with_receipts(&mut s, true, 3);
    s.next_tx(ADMIN);
    let mut registry = s.take_shared<Registry>(); let agreement = s.take_immutable<Agreement<BOND, CASH>>(); let mut escrow = s.take_shared<Escrow<BOND, CASH>>(); let intent = s.take_shared<Intent<BOND, CASH>>(); let clock = clock::create_for_testing(s.ctx());
    settlement::amend(&mut registry, &agreement, &mut escrow, intent, &clock, s.ctx());
    test_scenario::return_shared(registry); test_scenario::return_shared(escrow); test_scenario::return_immutable(agreement); clock::destroy_for_testing(clock); s.end();
}
#[test, expected_failure(abort_code = 5, location = tradebridge::settlement)]
fun superseded_agreement_cannot_execute() {
    let mut s = committed(); propose_amendment(&mut s); approve_with_receipts(&mut s, true, 3);
    s.next_tx(ADMIN);
    let mut registry = s.take_shared<Registry>(); let agreement = s.take_immutable<Agreement<BOND, CASH>>(); let mut escrow = s.take_shared<Escrow<BOND, CASH>>(); let intent = s.take_shared<Intent<BOND, CASH>>(); let clock = clock::create_for_testing(s.ctx());
    let old_agreement_id = object::id(&agreement); let old_escrow_id = object::id(&escrow);
    settlement::amend(&mut registry, &agreement, &mut escrow, intent, &clock, s.ctx());
    test_scenario::return_shared(registry); test_scenario::return_shared(escrow); test_scenario::return_immutable(agreement); clock::destroy_for_testing(clock);
    s.next_tx(ADMIN);
    let registry = s.take_shared<Registry>(); let agreement = s.take_immutable_by_id<Agreement<BOND, CASH>>(old_agreement_id); let mut escrow = s.take_shared_by_id<Escrow<BOND, CASH>>(old_escrow_id); let clock = clock::create_for_testing(s.ctx());
    settlement::settle(&registry, &agreement, &mut escrow, &clock, s.ctx());
    test_scenario::return_shared(registry); test_scenario::return_shared(escrow); test_scenario::return_immutable(agreement); clock::destroy_for_testing(clock); s.end();
}
