import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCandidate } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { Store } from '../src/store.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';
import { proposeTransaction, approveTransaction, settlementTransaction, verifySettlementEffects, attestationTransaction, commitmentTransaction, depositTransaction, refundTransaction, cancellationTransaction, type SettlementEffects } from '../src/sui.js';

const address = (digit: string) => '0x' + digit.repeat(64);
function fixture() {
  const now = new Date(); const terms = exampleTerms('buyer', now);
  const config = { chain_id: 'localnet-test', package_id: address('a'), registry_id: address('b'), bond_type: terms.bond_type, cash_type: terms.cash_type };
  const principal = examplePrincipals()[0]!; const store = new Store(); seedSandbox(store, principal, now);
  const candidate = createCandidate(store.get(principal.tenant, 'TB-001')!, terms, 'Test terms', config, now); store.close();
  const expected = { digest: 'test-digest', agreement_id: address('c'), escrow_id: address('d') };
  const effects: SettlementEffects = { digest: expected.digest, chain_id: config.chain_id, checkpoint: '123', status: 'success', calls: [{ package_id: config.package_id, module: 'settlement', function: 'settle', object_ids: [expected.agreement_id, expected.escrow_id, config.registry_id] }], balance_changes: [{ owner: terms.buyer_recipient, coin_type: terms.bond_type, amount: terms.quantity }, { owner: terms.broker_recipient, coin_type: terms.cash_type, amount: terms.net_cash_base }] };
  return { config, candidate, expected, effects };
}
test('Sui transaction builders bind actual package, registry, assets and party sender', () => {
  const { config, candidate, expected } = fixture();
  const propose = proposeTransaction(config, candidate, candidate.terms.buyer_address).getData();
  assert.equal(propose.sender, candidate.terms.buyer_address);
  assert.equal(propose.commands[0]?.MoveCall?.function, 'propose');
  assert.equal(propose.commands[0]?.MoveCall?.package, config.package_id);
  const approve = approveTransaction(config, candidate, expected.agreement_id, 'broker').getData();
  assert.equal(approve.sender, candidate.terms.broker_address);
  assert.equal(approve.commands[0]?.MoveCall?.function, 'approve_broker');
  assert.equal(settlementTransaction(config, candidate, expected.agreement_id, expected.escrow_id).getData().commands[0]?.MoveCall?.function, 'settle');
});
test('a changed network or a nonparty sender cannot build an intent', () => {
  const { config, candidate } = fixture();
  assert.throws(() => proposeTransaction({ ...config, chain_id: 'other' }, candidate, candidate.terms.buyer_address), /bind/);
  assert.throws(() => proposeTransaction(config, candidate, address('f')), /Only a trade party/);
});
test('effect verification requires both exact recipient balance changes and finality', () => {
  const { config, candidate, expected, effects } = fixture();
  assert.equal(verifySettlementEffects(config, candidate, expected, effects).verified, true);
  assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, checkpoint: null }).verified, false);
  assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, digest: 'another' }).verified, false);
  assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, calls: [] }).verified, false);
  assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, balance_changes: [] }).verified, false);
  assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, status: 'failure' }).status, 'ABORTED');
});
test('wrong amount or extra payouts cannot pass event-like success claims', () => {
  const { config, candidate, expected, effects } = fixture();
  for (const amount of ['999', '1001']) assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, balance_changes: [{ ...effects.balance_changes[0]!, amount }, effects.balance_changes[1]!] }).verified, false);
  assert.equal(verifySettlementEffects(config, candidate, expected, { ...effects, balance_changes: [...effects.balance_changes, { ...effects.balance_changes[0]!, owner: address('f'), amount: '1' }] }).verified, false);
});
test('funding binds the funding party and expiry does not disable authorized refund builders', () => {
  const { config, candidate, expected } = fixture();
  const deposit = depositTransaction(config, candidate, expected.agreement_id, expected.escrow_id, BigInt(candidate.terms.net_cash_base), 'buyer').getData();
  assert.equal(deposit.sender, candidate.terms.buyer_address); assert.equal(deposit.commands.find(c => c.MoveCall)!.MoveCall!.function, 'deposit_cash');
  assert.throws(() => depositTransaction(config, candidate, expected.agreement_id, expected.escrow_id, BigInt(candidate.terms.net_cash_base) + 1n, 'buyer'), /within the approved leg/);
  const expired = { ...candidate, terms: { ...candidate.terms, expires_at: '2020-01-01T00:00:00Z' } };
  assert.throws(() => depositTransaction(config, expired, expected.agreement_id, expected.escrow_id, 1n, 'buyer'), /Expired/);
  const refund = refundTransaction(config, expired, expected.agreement_id, expected.escrow_id, 'broker').getData();
  assert.equal(refund.sender, candidate.terms.broker_address); assert.equal(refund.commands[0]!.MoveCall!.function, 'refund_bond');
  assert.equal(cancellationTransaction(config, expired, expected.agreement_id, expected.escrow_id, 'buyer').getData().commands[0]!.MoveCall!.function, 'cancel');
});
test('commitment and linked amendment builders preserve registry ordering and receipt boundaries', () => {
  const { config, candidate, expected } = fixture();
  assert.equal(commitmentTransaction(config, candidate, address('e')).getData().commands[0]!.MoveCall!.function, 'commit');
  assert.equal(commitmentTransaction(config, candidate, address('e'), expected).getData().commands[0]!.MoveCall!.function, 'amend');
  const receipts = { buyer: '1'.repeat(64), broker: '2'.repeat(64), expires_at: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(attestationTransaction(config, candidate, address('e'), address('f'), receipts).getData().commands[0]!.MoveCall!.function, 'attest');
  assert.throws(() => attestationTransaction(config, candidate, address('e'), address('f'), { ...receipts, broker: receipts.buyer }), /distinct/);
});
