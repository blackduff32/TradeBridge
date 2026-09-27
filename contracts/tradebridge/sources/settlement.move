/// Two role transactions plus restricted verifier attestations precede commitment.
/// World ID verification is an off-chain trust boundary, never a native Move claim.
module tradebridge::settlement;

use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::table::{Self, Table};

const EAuthority: u64 = 0;
const ETerms: u64 = 1;
const EExpired: u64 = 2;
const EApproval: u64 = 3;
const EReplay: u64 = 4;
const EState: u64 = 5;
const EAmount: u64 = 6;

public struct AdminCap has key, store { id: UID, registry: ID }
public struct VerifierCap has key, store { id: UID, registry: ID }
public struct Registry has key {
    id: UID,
    verifier: ID,
    current: Table<vector<u8>, ID>,
    used: Table<vector<u8>, bool>,
}
public struct Intent<phantom B, phantom C> has key {
    id: UID, registry: ID, trade_key: vector<u8>, version: u64, terms_hash: vector<u8>,
    buyer: address, broker: address, buyer_recipient: address, broker_recipient: address,
    quantity: u64, unit_price: u64, interest: u64, fees: u64, cash: u64, expiry: u64,
    buyer_receipt: vector<u8>, broker_receipt: vector<u8>, approval_expiry: u64,
    verifier: ID, buyer_approved: bool, broker_approved: bool,
}
/// Frozen after creation. Mutable execution state is a separate escrow object.
public struct Agreement<phantom B, phantom C> has key {
    id: UID, registry: ID, trade_key: vector<u8>, version: u64, terms_hash: vector<u8>,
    buyer: address, broker: address, buyer_recipient: address, broker_recipient: address,
    quantity: u64, unit_price: u64, interest: u64, fees: u64, cash: u64, expiry: u64,
    prior: Option<ID>, buyer_receipt: vector<u8>, broker_receipt: vector<u8>,
}
public struct Escrow<phantom B, phantom C> has key {
    id: UID, agreement: ID, bond: Balance<B>, cash: Balance<C>, cancelled: bool, settled: bool,
}
public struct Committed has copy, drop { agreement: ID, escrow: ID, version: u64 }
public struct Settled has copy, drop { agreement: ID, bond_amount: u64, cash_amount: u64 }

fun init(ctx: &mut TxContext) {
    let registry_id = object::new(ctx);
    let registry_ref = object::uid_to_inner(&registry_id);
    let verifier = VerifierCap { id: object::new(ctx), registry: registry_ref };
    let registry = Registry { id: registry_id, verifier: object::id(&verifier), current: table::new(ctx), used: table::new(ctx) };
    transfer::transfer(AdminCap { id: object::new(ctx), registry: registry_ref }, ctx.sender());
    transfer::transfer(verifier, ctx.sender());
    transfer::share_object(registry);
}

public fun rotate_verifier(admin: &AdminCap, registry: &mut Registry, recipient: address, ctx: &mut TxContext) {
    assert!(admin.registry == object::id(registry) && recipient != @0x0, EAuthority);
    let cap = VerifierCap { id: object::new(ctx), registry: object::id(registry) };
    registry.verifier = object::id(&cap);
    transfer::transfer(cap, recipient);
}

public fun propose<B, C>(
    registry: &Registry, trade_key: vector<u8>, version: u64, terms_hash: vector<u8>,
    buyer: address, broker: address, buyer_recipient: address, broker_recipient: address,
    quantity: u64, unit_price: u64, interest: u64, fees: u64, cash: u64, expiry: u64,
    clock: &Clock, ctx: &mut TxContext,
) {
    assert!(ctx.sender() == buyer || ctx.sender() == broker, EAuthority);
    assert!(buyer != broker && buyer != @0x0 && broker != @0x0, ETerms);
    assert!(buyer_recipient != broker_recipient && buyer_recipient != @0x0 && broker_recipient != @0x0, ETerms);
    assert!(std::type_name::with_defining_ids<B>() != std::type_name::with_defining_ids<C>(), ETerms);
    assert!(trade_key.length() > 0 && trade_key.length() <= 128 && terms_hash.length() == 32 && version > 0, ETerms);
    assert!(quantity > 0 && unit_price > 0 && cash > 0, EAmount);
    // Overflow aborts before an intent can be created.
    assert!(quantity * unit_price + interest + fees == cash, EAmount);
    assert!(clock::timestamp_ms(clock) < expiry, EExpired);
    transfer::share_object(Intent<B, C> {
        id: object::new(ctx), registry: object::id(registry), trade_key, version, terms_hash,
        buyer, broker, buyer_recipient, broker_recipient, quantity, unit_price, interest, fees, cash, expiry,
        buyer_receipt: vector[], broker_receipt: vector[], approval_expiry: 0,
        verifier: registry.verifier, buyer_approved: false, broker_approved: false,
    });
}

/// The service must authenticate both distinct humans, freshness and exact consent
/// before issuing these opaque receipt commitments. No identity/nullifier is stored.
public fun attest<B, C>(cap: &VerifierCap, registry: &Registry, intent: &mut Intent<B, C>, buyer_receipt: vector<u8>, broker_receipt: vector<u8>, approval_expiry: u64, clock: &Clock) {
    assert!(cap.registry == object::id(registry) && object::id(cap) == registry.verifier && intent.registry == object::id(registry), EAuthority);
    assert!(intent.buyer_receipt.is_empty() && intent.broker_receipt.is_empty(), EState);
    assert!(buyer_receipt.length() == 32 && broker_receipt.length() == 32 && buyer_receipt != broker_receipt, EApproval);
    assert!(clock::timestamp_ms(clock) < approval_expiry && approval_expiry <= intent.expiry, EExpired);
    assert!(!registry.used.contains(buyer_receipt) && !registry.used.contains(broker_receipt), EReplay);
    intent.buyer_receipt = buyer_receipt; intent.broker_receipt = broker_receipt;
    intent.approval_expiry = approval_expiry; intent.verifier = registry.verifier;
}
public fun approve_buyer<B, C>(intent: &mut Intent<B, C>, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == intent.buyer, EAuthority);
    assert!(!intent.buyer_receipt.is_empty(), EApproval);
    assert!(clock::timestamp_ms(clock) < intent.approval_expiry, EExpired);
    intent.buyer_approved = true;
}
public fun approve_broker<B, C>(intent: &mut Intent<B, C>, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == intent.broker, EAuthority);
    assert!(!intent.broker_receipt.is_empty(), EApproval);
    assert!(clock::timestamp_ms(clock) < intent.approval_expiry, EExpired);
    intent.broker_approved = true;
}
public fun commit<B, C>(registry: &mut Registry, intent: Intent<B, C>, clock: &Clock, ctx: &mut TxContext) {
    assert!(!registry.current.contains(intent.trade_key), EReplay);
    finish_commit(registry, intent, option::none(), clock, ctx);
}
public fun amend<B, C>(registry: &mut Registry, old: &Agreement<B, C>, old_escrow: &mut Escrow<B, C>, intent: Intent<B, C>, clock: &Clock, ctx: &mut TxContext) {
    assert_current(registry, old, old_escrow);
    assert!(!old_escrow.settled && old_escrow.bond.value() == 0 && old_escrow.cash.value() == 0, EState);
    assert!(intent.trade_key == old.trade_key && intent.version > old.version, ETerms);
    assert!(intent.buyer == old.buyer && intent.broker == old.broker, EAuthority);
    old_escrow.cancelled = true;
    registry.current.remove(old.trade_key);
    finish_commit(registry, intent, option::some(object::id(old)), clock, ctx);
}
fun finish_commit<B, C>(registry: &mut Registry, intent: Intent<B, C>, prior: Option<ID>, clock: &Clock, ctx: &mut TxContext) {
    assert!(intent.registry == object::id(registry) && intent.verifier == registry.verifier, EAuthority);
    assert!(intent.buyer_approved && intent.broker_approved, EApproval);
    assert!(clock::timestamp_ms(clock) < intent.approval_expiry && clock::timestamp_ms(clock) < intent.expiry, EExpired);
    assert!(!registry.used.contains(intent.buyer_receipt) && !registry.used.contains(intent.broker_receipt), EReplay);
    registry.used.add(intent.buyer_receipt, true); registry.used.add(intent.broker_receipt, true);
    let Intent { id, registry: registry_ref, trade_key, version, terms_hash, buyer, broker, buyer_recipient, broker_recipient, quantity, unit_price, interest, fees, cash, expiry, buyer_receipt, broker_receipt, approval_expiry: _, verifier: _, buyer_approved: _, broker_approved: _ } = intent;
    id.delete();
    let agreement = Agreement<B, C> { id: object::new(ctx), registry: registry_ref, trade_key, version, terms_hash, buyer, broker, buyer_recipient, broker_recipient, quantity, unit_price, interest, fees, cash, expiry, prior, buyer_receipt, broker_receipt };
    let agreement_id = object::id(&agreement);
    let escrow = Escrow<B, C> { id: object::new(ctx), agreement: agreement_id, bond: balance::zero(), cash: balance::zero(), cancelled: false, settled: false };
    registry.current.add(trade_key, agreement_id);
    sui::event::emit(Committed { agreement: agreement_id, escrow: object::id(&escrow), version });
    transfer::freeze_object(agreement);
    transfer::share_object(escrow);
}
fun assert_current<B, C>(registry: &Registry, agreement: &Agreement<B, C>, escrow: &Escrow<B, C>) {
    assert!(agreement.registry == object::id(registry) && escrow.agreement == object::id(agreement), ETerms);
    assert!(registry.current.contains(agreement.trade_key) && *registry.current.borrow(agreement.trade_key) == object::id(agreement), EState);
}
fun assert_live<B, C>(registry: &Registry, agreement: &Agreement<B, C>, escrow: &Escrow<B, C>, clock: &Clock) {
    assert_current(registry, agreement, escrow);
    assert!(!escrow.cancelled && !escrow.settled, EState);
    assert!(clock::timestamp_ms(clock) < agreement.expiry, EExpired);
}
public fun deposit_bond<B, C>(registry: &Registry, agreement: &Agreement<B, C>, escrow: &mut Escrow<B, C>, coin: Coin<B>, clock: &Clock, ctx: &TxContext) {
    assert_live(registry, agreement, escrow, clock);
    assert!(ctx.sender() == agreement.broker, EAuthority);
    assert!(coin.value() > 0 && coin.value() <= agreement.quantity - escrow.bond.value(), EAmount);
    escrow.bond.join(coin.into_balance());
}
public fun deposit_cash<B, C>(registry: &Registry, agreement: &Agreement<B, C>, escrow: &mut Escrow<B, C>, coin: Coin<C>, clock: &Clock, ctx: &TxContext) {
    assert_live(registry, agreement, escrow, clock);
    assert!(ctx.sender() == agreement.buyer, EAuthority);
    assert!(coin.value() > 0 && coin.value() <= agreement.cash - escrow.cash.value(), EAmount);
    escrow.cash.join(coin.into_balance());
}
public fun settle<B, C>(registry: &Registry, agreement: &Agreement<B, C>, escrow: &mut Escrow<B, C>, clock: &Clock, ctx: &mut TxContext) {
    assert_live(registry, agreement, escrow, clock);
    assert!(escrow.bond.value() == agreement.quantity && escrow.cash.value() == agreement.cash, EAmount);
    escrow.settled = true;
    transfer::public_transfer(coin::from_balance(escrow.bond.withdraw_all(), ctx), agreement.buyer_recipient);
    transfer::public_transfer(coin::from_balance(escrow.cash.withdraw_all(), ctx), agreement.broker_recipient);
    sui::event::emit(Settled { agreement: object::id(agreement), bond_amount: agreement.quantity, cash_amount: agreement.cash });
}
public fun cancel<B, C>(agreement: &Agreement<B, C>, escrow: &mut Escrow<B, C>, ctx: &TxContext) {
    assert!(escrow.agreement == object::id(agreement) && !escrow.settled, EState);
    assert!(ctx.sender() == agreement.buyer || ctx.sender() == agreement.broker, EAuthority);
    escrow.cancelled = true;
}
public fun refund_bond<B, C>(agreement: &Agreement<B, C>, escrow: &mut Escrow<B, C>, clock: &Clock, ctx: &mut TxContext) {
    assert!(escrow.agreement == object::id(agreement) && !escrow.settled, EState);
    assert!(escrow.cancelled || clock::timestamp_ms(clock) >= agreement.expiry, EState);
    assert!(ctx.sender() == agreement.broker && escrow.bond.value() > 0, EAuthority);
    transfer::public_transfer(coin::from_balance(escrow.bond.withdraw_all(), ctx), agreement.broker);
}
public fun refund_cash<B, C>(agreement: &Agreement<B, C>, escrow: &mut Escrow<B, C>, clock: &Clock, ctx: &mut TxContext) {
    assert!(escrow.agreement == object::id(agreement) && !escrow.settled, EState);
    assert!(escrow.cancelled || clock::timestamp_ms(clock) >= agreement.expiry, EState);
    assert!(ctx.sender() == agreement.buyer && escrow.cash.value() > 0, EAuthority);
    transfer::public_transfer(coin::from_balance(escrow.cash.withdraw_all(), ctx), agreement.buyer);
}
#[test_only] public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
