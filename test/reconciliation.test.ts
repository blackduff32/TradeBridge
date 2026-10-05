import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCandidate } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { Store } from '../src/store.js';
import { reconcileFourWay, type BookPosting } from '../src/reconciliation.js';
import type { SettlementEffects } from '../src/sui.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';

function fixture() {
  const terms = exampleTerms('buyer'); const principal = examplePrincipals()[0]!; const store = new Store(); seedSandbox(store, principal, new Date());
  const config = { chain_id: 'test', package_id: '0x' + 'a'.repeat(64), registry_id: '0x' + 'b'.repeat(64), bond_type: terms.bond_type, cash_type: terms.cash_type };
  const approved = createCandidate(store.get(principal.tenant, 'TB-001')!, terms, 'Test approved terms', config, new Date()); store.close();
  const expected = { digest: 'transaction-digest', agreement_id: 'agreement', escrow_id: 'escrow' };
  const effects: SettlementEffects = { digest: expected.digest, chain_id: config.chain_id, checkpoint: '1', status: 'success', calls: [{ package_id: config.package_id, module: 'settlement', function: 'settle', object_ids: [config.registry_id, expected.agreement_id, expected.escrow_id] }], balance_changes: [{ owner: terms.buyer_recipient, coin_type: terms.bond_type, amount: terms.quantity }, { owner: terms.broker_recipient, coin_type: terms.cash_type, amount: terms.net_cash_base }] };
  const posting: BookPosting = { trade_id: terms.trade_id, version: approved.version, terms_hash: approved.terms_hash, transaction_digest: expected.digest, bond_type: terms.bond_type, cash_type: terms.cash_type, quantity: terms.quantity, net_cash_base: terms.net_cash_base, buyer_recipient: terms.buyer_recipient, broker_recipient: terms.broker_recipient, posting_reference: 'posting-1', posted_at: new Date().toISOString() };
  return { approved, config, expected, effects, books: { buyer: posting, broker: { ...posting, posting_reference: 'posting-2' } } };
}
test('four-way reconciliation requires actual approved terms, final effects, and both postings', () => {
  const f = fixture(); assert.equal(reconcileFourWay(f).status, 'BOOK_RECONCILED');
  assert.equal(reconcileFourWay({ ...f, approved: null }).status, 'NO_APPROVED_TERMS');
  assert.equal(reconcileFourWay({ ...f, effects: null }).status, 'UNKNOWN_CHAIN_OUTCOME');
  assert.equal(reconcileFourWay({ ...f, effects: { ...f.effects, balance_changes: [] } }).reconciled, false);
  assert.equal(reconcileFourWay({ ...f, books: { buyer: f.books.buyer } }).status, 'SETTLED_BOOK_MISSING');
});
test('wrong book quantity/hash/digest produces proposed adjustments and never mutates source books', () => {
  for (const changes of [{ quantity: '1100' }, { terms_hash: 'f'.repeat(64) }, { transaction_digest: 'different' }]) {
    const f = fixture(); f.books.broker = { ...f.books.broker, ...changes }; const original = structuredClone(f.books);
    const result = reconcileFourWay(f); assert.equal(result.status, 'SETTLED_BOOK_MISMATCH'); assert.equal(result.adjustments[0]!.side, 'broker');
    assert.deepEqual(f.books, original); assert.equal(result.adjustments[0]!.suggested.quantity, '1000');
  }
});
