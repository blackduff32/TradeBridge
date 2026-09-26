import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, compare, createCandidate, demoEnvironment, economicsSchema, parseCsv, type Trade } from '../src/domain.js';
import { exampleCsv, exampleTerms } from '../scripts/fixtures.js';

const now = new Date('2026-09-26T12:00:00Z');
function trade(): Trade {
  const result: Trade = { id: 'TB-001', tenant: 'demo', revision: 2, sources: {}, candidates: [], canonical: null };
  for (const side of ['buyer', 'broker'] as const) {
    const csv = exampleCsv(side, now);
    const row = parseCsv(csv)[0]!;
    result.sources[side] = { ...row, id: `${side}-source`, side, file_hash: 'source-hash', imported_at: now.toISOString(), actor: side, organisation: side };
  }
  return result;
}
test('100-unit mismatch includes exact source evidence and signed delta', () => {
  const result = compare(trade());
  assert.equal(result.status, 'INTERVENTION_REQUIRED');
  assert.equal(result.settlement_allowed, false);
  const delta = result.differences.find(d => d.field === 'quantity')!;
  assert.equal(delta.delta, '100');
  assert.equal(delta.evidence.broker.source_id, 'broker-source');
  assert.equal(delta.evidence.buyer.record_number, 1);
});
test('price mismatch is detected even when volume matches', () => {
  const value = trade();
  Object.assign(value.sources.broker!.record, { quantity: '1000', unit_price_base: '1100', net_cash_base: '1100000' });
  assert.ok(compare(value).differences.some(d => d.code === 'PRICE_MISMATCH'));
});
test('matched imports still require human verification', () => {
  const value = trade();
  Object.assign(value.sources.broker!.record, { quantity: '1000', net_cash_base: '1000000' });
  assert.equal(compare(value).status, 'HUMAN_VERIFICATION_REQUIRED');
  assert.equal(compare(value).settlement_allowed, false);
});
test('missing book has a distinct status', () => {
  const value = trade();
  delete value.sources.broker;
  assert.equal(compare(value).status, 'MISSING_BROKER');
  assert.throws(() => createCandidate(value, exampleTerms('buyer', now), 'reason', demoEnvironment, now), /Both source/);
});
test('exact integer arithmetic survives the JavaScript safe-integer boundary', () => {
  const terms = { ...exampleTerms('buyer', now), quantity: '9007199254740993', unit_price_base: '1', net_cash_base: '9007199254740993' };
  assert.equal(economicsSchema.parse(terms).quantity, '9007199254740993');
  assert.throws(() => economicsSchema.parse({ ...terms, net_cash_base: '9007199254740992' }));
});
for (const invalid of ['1.1', '-1', '01', '1e3', '18446744073709551616', ' 1']) {
  test(`rejects ambiguous/out-of-range quantity ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => economicsSchema.parse({ ...exampleTerms('buyer', now), quantity: invalid }));
  });
}
test('rejects overflow of a product even when both input operands fit u64', () => {
  assert.throws(() => economicsSchema.parse({ ...exampleTerms('buyer', now), quantity: '18446744073709551615' }));
});
test('rejects incorrect net cash and unknown approval flags', () => {
  assert.throws(() => economicsSchema.parse({ ...exampleTerms('buyer', now), net_cash_base: '42' }));
  assert.throws(() => economicsSchema.parse({ ...exampleTerms('buyer', now), approved: true }));
});
test('rejects same-party addresses, zero recipient and identical assets', () => {
  const terms = exampleTerms('buyer', now);
  assert.throws(() => economicsSchema.parse({ ...terms, broker_address: terms.buyer_address }));
  assert.throws(() => economicsSchema.parse({ ...terms, buyer_recipient: '0x' + '0'.repeat(64) }));
  assert.throws(() => economicsSchema.parse({ ...terms, cash_type: terms.bond_type }));
});
test('canonical serialization is independent of object insertion order', () => {
  assert.equal(canonicalJson({ b: ['x', { z: 2, a: 1 }], a: '1' }), canonicalJson({ a: '1', b: ['x', { a: 1, z: 2 }] }));
});
test('proposal hash binds economics, environment, tenant, version and source evidence', () => {
  const value = trade();
  const terms = exampleTerms('buyer', now);
  const first = createCandidate(value, terms, 'reason', demoEnvironment, now);
  const changed = [
    createCandidate(value, { ...terms, quantity: '1100', net_cash_base: '1100000' }, 'reason', demoEnvironment, now),
    createCandidate(value, { ...terms, buyer_recipient: '0x' + '3'.repeat(64) }, 'reason', demoEnvironment, now),
    createCandidate(value, terms, 'reason', { ...demoEnvironment, chain_id: 'different-chain' }, now),
    createCandidate(value, terms, 'reason', { ...demoEnvironment, package_id: 'different-package' }, now),
    createCandidate(value, terms, 'reason', { ...demoEnvironment, registry_id: 'different-registry' }, now),
    createCandidate({ ...value, tenant: 'other' }, terms, 'reason', demoEnvironment, now),
    createCandidate({ ...value, candidates: [first] }, terms, 'reason', demoEnvironment, now),
  ];
  value.sources.buyer!.id = 'changed-source';
  changed.push(createCandidate(value, terms, 'reason', demoEnvironment, now));
  for (const candidate of changed) assert.notEqual(candidate.terms_hash, first.terms_hash);
});
test('CSV parser preserves originals and rejects duplicate headers, rows and invalid amounts', () => {
  const csv = exampleCsv('buyer', now);
  const row = parseCsv(csv)[0]!;
  assert.equal(row.record.quantity, '1000');
  assert.equal(row.line_end, 2);
  assert.equal(row.raw_row, csv.split('\n')[1] + '\n');
  assert.throws(() => parseCsv(csv.replace('instrument_id', 'trade_id')));
  assert.throws(() => parseCsv(csv + csv.split('\n')[1] + '\n'));
  assert.throws(() => parseCsv(exampleCsv('buyer', now, { net_cash_base: '9' })));
});
