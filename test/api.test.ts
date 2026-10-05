import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { readPrincipals } from '../src/config.js';
import { Store } from '../src/store.js';
import { exampleCsv, examplePrincipals, exampleTerms } from '../scripts/fixtures.js';

const now = new Date('2026-09-26T12:00:00Z');
async function fixture() {
  const principals = examplePrincipals();
  const store = new Store();
  const app = createApp({ store, principals, now: () => now });
  await app.ready();
  const headers = (actor = 'buyer-agent', key = 'request-0001') => ({ authorization: `Bearer ${principals.find(p => p.id === actor)!.token}`, 'idempotency-key': key });
  const importSide = (side: 'buyer' | 'broker', revision: number, key = `import-${side}`) => app.inject({ method: 'POST', url: '/imports', headers: headers(`${side}-agent`, key), payload: { csv: exampleCsv(side, now), expected_revisions: { 'TB-001': revision } } });
  const seed = async () => {
    assert.equal((await importSide('buyer', 0)).statusCode, 200);
    assert.equal((await importSide('broker', 1)).statusCode, 200);
  };
  const propose = (key = 'proposal-001', revision = 2) => app.inject({ method: 'POST', url: '/trades/TB-001/proposals', headers: headers('broker-agent', key), payload: { terms: exampleTerms('buyer', now), expected_revision: revision, reason: 'Match original buyer order.' } });
  const close = async () => { await app.close(); store.close(); };
  return { principals, store, app, headers, importSide, seed, propose, close };
}
test('unauthenticated access denied; health truthfully reports disconnected integrations', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.app.inject('/trades/TB-001')).statusCode, 401);
  assert.equal((await f.app.inject({ url: '/trades/TB-001', headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
  assert.equal((await f.app.inject('/health')).json().integrations.world_id, 'not_configured');
});
test('source import, mismatch, proposal and audit persist without applying a correction', async t => {
  const f = await fixture(); t.after(f.close);
  await f.seed();
  const result = await f.propose();
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().candidate.version, 2);
  assert.equal(result.json().canonical_changed, false);
  const trade = f.store.get('demo-workspace', 'TB-001')!;
  assert.equal(trade.canonical, null);
  assert.equal(trade.sources.broker!.record.quantity, '1100');
  assert.equal(trade.candidates[0]!.terms.quantity, '1000');
  const audit = await f.app.inject({ url: '/trades/TB-001/audit', headers: f.headers() });
  assert.deepEqual(audit.json().events.map((e: { action: string }) => e.action), ['SOURCE_IMPORTED', 'SOURCE_IMPORTED', 'CANDIDATE_PROPOSED']);
});
test('idempotent retries return original response and cannot duplicate audit or proposals', async t => {
  const f = await fixture(); t.after(f.close);
  const original = await f.importSide('buyer', 0);
  assert.equal((await f.importSide('buyer', 0)).body, original.body);
  assert.equal((await f.importSide('broker', 1)).statusCode, 200);
  const first = await f.propose();
  assert.equal((await f.propose()).body, first.body);
  assert.equal(f.store.get('demo-workspace', 'TB-001')!.candidates.length, 1);
  assert.equal(f.store.history('demo-workspace', 'TB-001').length, 3);
  const conflict = await f.propose('proposal-001', 3);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, 'IDEMPOTENCY_CONFLICT');
});
test('stale and concurrent proposals produce only one next version', async t => {
  const f = await fixture(); t.after(f.close); await f.seed();
  const responses = await Promise.all([f.propose('concurrent-01'), f.propose('concurrent-02')]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(f.store.get('demo-workspace', 'TB-001')!.revision, 3);
  const amended = await f.propose('amendment-03', 3);
  assert.equal(amended.json().candidate.version, 3);
  assert.notEqual(amended.json().candidate.terms_hash, f.store.get('demo-workspace', 'TB-001')!.candidates[0]!.terms_hash);
});
test('cannot overwrite source records or spoof import side', async t => {
  const f = await fixture(); t.after(f.close); await f.seed();
  const overwrite = await f.importSide('broker', 2, 'overwrite-001');
  assert.equal(overwrite.json().error, 'SOURCE_EXISTS');
  const spoof = await f.app.inject({ method: 'POST', url: '/imports', headers: f.headers(), payload: { csv: exampleCsv('broker', now), side: 'broker', expected_revisions: { 'TB-001': 2 } } });
  assert.equal(spoof.statusCode, 400);
});
test('tenant and explicit trade scope isolate read/write access', async t => {
  const f = await fixture(); t.after(f.close); await f.seed();
  f.principals[0]!.tenant = 'other-workspace';
  assert.equal((await f.app.inject({ url: '/trades/TB-001', headers: f.headers() })).statusCode, 404);
  f.principals[0]!.tenant = 'demo-workspace';
  f.principals[0]!.tradeIds = ['TB-002'];
  assert.equal((await f.app.inject({ url: '/trades/TB-001/audit', headers: f.headers() })).statusCode, 404);
  assert.equal((await f.importSide('buyer', 2, 'scope-0001')).statusCode, 404);
});
test('missing idempotency and expected revision are rejected without a write', async t => {
  const f = await fixture(); t.after(f.close);
  const result = await f.app.inject({ method: 'POST', url: '/imports', headers: { authorization: f.headers().authorization }, payload: { csv: exampleCsv('buyer', now), expected_revisions: { 'TB-001': 0 } } });
  assert.equal(result.statusCode, 400);
  const missing = await f.app.inject({ method: 'POST', url: '/imports', headers: f.headers(), payload: { csv: exampleCsv('buyer', now), expected_revisions: {} } });
  assert.equal(missing.statusCode, 400);
  assert.equal(f.store.get('demo-workspace', 'TB-001'), undefined);
});
test('multi-row imports roll back earlier writes when a later row is out of scope', async t => {
  const f = await fixture(); t.after(f.close);
  const csv = exampleCsv('buyer', now) + exampleCsv('buyer', now, { trade_id: 'TB-002' }).split('\n')[1] + '\n';
  const response = await f.app.inject({ method: 'POST', url: '/imports', headers: f.headers(), payload: { csv, expected_revisions: { 'TB-001': 0, 'TB-002': 0 } } });
  assert.equal(response.statusCode, 404);
  assert.equal(f.store.get('demo-workspace', 'TB-001'), undefined);
  assert.equal(f.store.history('demo-workspace', 'TB-001').length, 0);
  assert.equal((await f.importSide('buyer', 0)).statusCode, 200);
});
test('expired trades and unsupported assets cannot be imported', async t => {
  const f = await fixture(); t.after(f.close);
  for (const override of [{ expires_at: '2026-09-26T11:00:00Z' }, { bond_type: '0x' + 'f'.repeat(64) + '::bond::BOND' }]) {
    const response = await f.app.inject({ method: 'POST', url: '/imports', headers: f.headers(), payload: { csv: exampleCsv('buyer', now, override), expected_revisions: { 'TB-001': 0 } } });
    assert.equal(response.statusCode, 400, response.body);
  }
});
test('all privileged paths reject agents and remain closed even to configured humans', async t => {
  const f = await fixture(); t.after(f.close); await f.seed(); await f.propose();
  for (const path of ['verification-challenges', 'world-id-verifications', 'approvals', 'agreement-commitments', 'funding-intents', 'settlement-instructions']) {
    const request = { method: 'POST' as const, url: `/trades/TB-001/${path}`, payload: { face_verified: true, approved: true, proof: 'untrusted-browser-proof' } };
    const agent = await f.app.inject({ ...request, headers: f.headers('buyer-agent') });
    assert.equal(agent.statusCode, 403, path);
    const human = await f.app.inject({ ...request, headers: f.headers('buyer-human') });
    assert.equal(human.statusCode, 503, path);
    assert.equal(human.json().error, 'INTEGRATION_NOT_READY');
  }
  assert.equal(f.store.get('demo-workspace', 'TB-001')!.canonical, null);
});
test('malformed JSON, excessive body size and unexpected terms fail safely', async t => {
  const f = await fixture(); t.after(f.close); await f.seed();
  assert.equal((await f.app.inject({ method: 'POST', url: '/imports', headers: { ...f.headers(), 'content-type': 'application/json' }, payload: '{' })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: '/imports', headers: f.headers(), payload: { csv: 'x'.repeat(650_000) } })).statusCode, 413);
  assert.equal((await f.app.inject({ method: 'POST', url: '/trades/TB-001/proposals', headers: f.headers(), payload: { expected_revision: 2, reason: 'Injected permission flag', terms: { ...exampleTerms('buyer', now), approved: true } } })).statusCode, 400);
});
test('SQLite persists idempotency, sources and audit across process-style reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tradebridge-test-'));
  const path = join(dir, 'state.db');
  const principals = examplePrincipals();
  const request = { method: 'POST' as const, url: '/imports', headers: { authorization: `Bearer ${principals[0]!.token}`, 'idempotency-key': 'persistent-01' }, payload: { csv: exampleCsv('buyer', now), expected_revisions: { 'TB-001': 0 } } };
  let store = new Store(path);
  let app = createApp({ store, principals, now: () => now });
  try {
    const original = await app.inject(request);
    await app.close(); store.close();
    store = new Store(path); app = createApp({ store, principals, now: () => now });
    assert.equal((await app.inject(request)).body, original.body);
    assert.equal(store.history('demo-workspace', 'TB-001').length, 1);
    const hash = store.get('demo-workspace', 'TB-001')!.sources.buyer!.file_hash;
    assert.equal(store.sourceFile('demo-workspace', hash), request.payload.csv);
  } finally { await app.close(); store.close(); rmSync(dir, { recursive: true }); }
});
test('configuration refuses missing credentials and duplicate principal tokens', () => {
  assert.throws(() => readPrincipals(undefined));
  const principals = examplePrincipals(); principals[1]!.token = principals[0]!.token;
  assert.throws(() => readPrincipals(JSON.stringify(principals)), /unique/);
});
test('a trade-scoped reader cannot obtain unrelated rows from a multi-trade source file', async t => {
  const f = await fixture(); t.after(f.close);
  f.principals[0]!.tradeIds.push('TB-002');
  const csv = exampleCsv('buyer', now) + exampleCsv('buyer', now, { trade_id: 'TB-002', instrument_id: 'PRIVATE-OTHER-TRADE' }).split('\n')[1] + '\n';
  const result = await f.app.inject({ method: 'POST', url: '/imports', headers: f.headers(), payload: { csv, expected_revisions: { 'TB-001': 0, 'TB-002': 0 } } });
  assert.equal(result.statusCode, 200, result.body);
  const read = await f.app.inject({ url: '/trades/TB-001', headers: f.headers('buyer-human') });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.includes('PRIVATE-OTHER-TRADE'), false);
  assert.equal(read.body.includes('raw_csv'), false);
});
