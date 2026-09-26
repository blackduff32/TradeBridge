import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { ConsentService, type StaffAuthority } from '../src/consent.js';
import { CommitWorker, type CommitDriver, type CommitObservation } from '../src/outbox.js';
import { approvalAction, WorldIdService, type HumanTrustBoundary, type WorldConfig } from '../src/world-id.js';
import { createCandidate, demoEnvironment, type Principal } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';

const config: WorldConfig = { app_id: 'app_test', rp_id: 'rp_test', action: 'tradebridge-approval', signing_key: '1'.repeat(64), environment: 'staging', require_presence: true, allow_legacy_simulator: false };
function fixture(path?: string) {
  const store = new Store(path); const people = examplePrincipals().filter(p => p.kind === 'human');
  const buyer = people.find(p => p.side === 'buyer')!; const broker = people.find(p => p.side === 'broker')!;
  let clock = Date.now(); let revoked = false; let samePerson = false;
  const authority: StaffAuthority = { resolve: (tenant, id) => people.find(p => p.tenant === tenant && p.id === id), async assertCurrent() { if (revoked) throw new Error('Staff role revoked'); } };
  seedSandbox(store, buyer, new Date(clock));
  const trade = store.get(buyer.tenant, 'TB-001')!;
  trade.candidates.push(createCandidate(trade, exampleTerms('buyer'), 'Align confirmation with order', demoEnvironment, new Date(clock)));
  store.save(trade);
  const trust: HumanTrustBoundary = { async validatePresence() { return 'test-only-presence'; }, async validateEnrollment(p) { return samePerson ? 'same-person' : p.id; } };
  const service = new ConsentService(store, authority, () => new Date(clock));
  async function record(person: Principal, decision: 'approve' | 'reject' = 'approve') {
    const latest = store.get(buyer.tenant, 'TB-001')!; const candidate = latest.candidates.at(-1)!;
    const nullifier = person.side === 'buyer' ? '0x1' : '0x2'; const action = approvalAction(config.action, candidate);
    const provider = (async () => new Response(JSON.stringify({ success: true, action, environment: config.environment, results: [{ identifier: 'proof_of_human', success: true, nullifier }] }))) as typeof fetch;
    const world = new WorldIdService(store, config, trust, provider, () => new Date(clock));
    const challenge = world.begin(person, candidate);
    await world.verify(person, challenge.id, { protocol_version: '4.0', action, environment: config.environment, nonce: challenge.nonce, user_presence_completed: true, responses: [{ identifier: 'proof_of_human', signal_hash: challenge.signal_hash, nullifier, issuer_schema_id: 1, expires_at_min: Math.floor(clock / 1000) + 3600, proof: ['1', '2', '3', '4', '5'] }] }, () => store.get(buyer.tenant, 'TB-001')!.candidates.at(-1));
    const input = { expected_revision: latest.revision, version: candidate.version, terms_hash: candidate.terms_hash, challenge_id: challenge.id, decision };
    const key = `consent-${challenge.id}`;
    return { result: await service.record(person, 'TB-001', input, key), input, key };
  }
  const stage = () => service.stage(buyer.tenant, 'TB-001', store.get(buyer.tenant, 'TB-001')!.revision);
  return { store, buyer, broker, record, stage, service, setSamePerson() { samePerson = true; }, revoke() { revoked = true; }, advance(ms: number) { clock += ms; }, now: () => clock };
}
test('two explicit consents atomically stage one canonical correction and one durable instruction', async () => {
  const f = fixture(); try {
    const buyer = await f.record(f.buyer);
    assert.equal(f.store.get(f.buyer.tenant, 'TB-001')!.canonical, null);
    assert.deepEqual(await f.service.record(f.buyer, 'TB-001', buyer.input, buyer.key), buyer.result);
    await assert.rejects(f.stage, /Two current/);
    await f.record(f.broker);
    const result = await f.stage();
    assert.equal(result.state, 'PENDING'); assert.equal(result.digest, null);
    assert.equal(f.store.get(f.buyer.tenant, 'TB-001')!.canonical!.terms.quantity, '1000');
    assert.equal(f.store.get(f.buyer.tenant, 'TB-001')!.sources.broker!.record.quantity, '1100');
    assert.ok(f.store.consents(f.buyer.tenant, 'TB-001', result.version).every(c => c.consumed));
    assert.deepEqual(await f.stage(), result);
    assert.equal(f.store.history(f.buyer.tenant, 'TB-001').filter(e => e.action === 'CORRECTION_STAGED').length, 1);
  } finally { f.store.close(); }
});
test('two accounts for the same person cannot approve both roles', async () => {
  const f = fixture(); try { f.setSamePerson(); await f.record(f.buyer); await assert.rejects(() => f.record(f.broker), /distinct verified people/); } finally { f.store.close(); }
});
test('rejection and expired approvals never produce a correction', async () => {
  const f = fixture(); try { await f.record(f.buyer, 'reject'); await assert.rejects(() => f.record(f.broker), /was rejected/); await assert.rejects(f.stage, /Two current/); } finally { f.store.close(); }
  const g = fixture(); try { await g.record(g.buyer); await g.record(g.broker); g.advance(901_000); await assert.rejects(g.stage, /Two current/); assert.equal(g.store.get(g.buyer.tenant, 'TB-001')!.canonical, null); } finally { g.store.close(); }
});
test('revocation is rechecked immediately before staging', async () => {
  const f = fixture(); try { await f.record(f.buyer); await f.record(f.broker); f.revoke(); await assert.rejects(f.stage, /revoked/); assert.ok(f.store.consents(f.buyer.tenant, 'TB-001', 2).every(c => !c.consumed)); } finally { f.store.close(); }
});
test('a new candidate cannot reuse previous version approvals', async () => {
  const f = fixture(); try {
    await f.record(f.buyer); await f.record(f.broker);
    const trade = f.store.get(f.buyer.tenant, 'TB-001')!;
    trade.candidates.push(createCandidate(trade, exampleTerms('buyer'), 'Another proposed amendment', demoEnvironment, new Date())); trade.revision++; f.store.save(trade);
    await assert.rejects(f.stage, /Two current/);
  } finally { f.store.close(); }
});
async function staged(path?: string) {
  const f = fixture(path); await f.record(f.buyer); await f.record(f.broker); const instruction = await f.stage();
  let prepares = 0; const broadcasts: string[] = []; const lookups: string[] = [];
  let observation: CommitObservation = { status: 'not_found' }; let outcome: CommitObservation | Error = new Error('Timeout');
  const driver: CommitDriver = {
    async preflight() {},
    async prepare() { prepares++; return { digest: 'stable-digest', bytes: 'signed-transaction', expires_at: new Date(f.now() + 300_000).toISOString() }; },
    async lookup(digest) { lookups.push(digest); return observation; },
    async broadcast(bytes) {
      const persisted = f.store.instruction(instruction.tenant, instruction.trade_id, instruction.version)!;
      assert.equal(persisted.digest, 'stable-digest'); assert.equal(persisted.prepared!.bytes, bytes);
      broadcasts.push(bytes); if (outcome instanceof Error) throw outcome; return outcome;
    },
  };
  const confirmed: CommitObservation = { status: 'confirmed', digest: 'stable-digest', agreement_id: 'agreement-object', terms_hash: instruction.terms_hash, version: instruction.version, instruction_id: instruction.id };
  return { ...f, driver, instruction, confirmed, broadcasts, lookups, prepares: () => prepares, observe(value: CommitObservation) { observation = value; }, outcome(value: CommitObservation | Error) { outcome = value; } };
}
test('timeout recovery queries existing digest before broadcasting or preparing anything new', async () => {
  const f = await staged(); try {
    const worker = new CommitWorker(f.store, f.driver, f.now); const run = () => worker.run(f.instruction.tenant, 'TB-001', 2);
    await assert.rejects(run, /Timeout/); assert.equal(f.store.instruction(f.instruction.tenant, 'TB-001', 2)!.state, 'UNKNOWN');
    f.observe(f.confirmed); assert.equal((await run()).state, 'CONFIRMED');
    assert.equal(f.prepares(), 1); assert.equal(f.broadcasts.length, 1); assert.deepEqual(f.lookups, ['stable-digest']);
    assert.equal((await run()).state, 'CONFIRMED'); assert.equal(f.lookups.length, 1);
  } finally { f.store.close(); }
});
test('not-found recovery only rebroadcasts identical signed bytes', async () => {
  const f = await staged(); try {
    const worker = new CommitWorker(f.store, f.driver, f.now); const run = () => worker.run(f.instruction.tenant, 'TB-001', 2);
    await assert.rejects(run); f.outcome(f.confirmed); assert.equal((await run()).state, 'CONFIRMED');
    assert.deepEqual(f.broadcasts, ['signed-transaction', 'signed-transaction']); assert.equal(f.prepares(), 1);
  } finally { f.store.close(); }
});
test('expired signed bytes stay unknown and are never rebuilt', async () => {
  const f = await staged(); try {
    const worker = new CommitWorker(f.store, f.driver, f.now); const run = () => worker.run(f.instruction.tenant, 'TB-001', 2);
    await assert.rejects(run); f.advance(301_000); assert.equal((await run()).state, 'UNKNOWN'); assert.equal(f.prepares(), 1); assert.equal(f.broadcasts.length, 1);
  } finally { f.store.close(); }
});
test('mismatched finalized evidence leaves instruction unknown', async () => {
  const f = await staged(); try {
    f.outcome({ ...f.confirmed, terms_hash: 'other' } as CommitObservation);
    await assert.rejects(() => new CommitWorker(f.store, f.driver, f.now).run(f.instruction.tenant, 'TB-001', 2), /does not match/);
    assert.equal(f.store.instruction(f.instruction.tenant, 'TB-001', 2)!.state, 'UNKNOWN');
  } finally { f.store.close(); }
});
test('concurrent workers only prepare and submit once', async () => {
  const f = await staged(); try {
    f.outcome(f.confirmed); const worker = new CommitWorker(f.store, f.driver, f.now);
    await Promise.all([worker.run(f.instruction.tenant, 'TB-001', 2), worker.run(f.instruction.tenant, 'TB-001', 2)]);
    assert.equal(f.prepares(), 1); assert.equal(f.broadcasts.length, 1);
  } finally { f.store.close(); }
});
test('unknown instruction survives database restart with original transaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tradebridge-outbox-')); const path = join(dir, 'db.sqlite');
  const f = await staged(path);
  try {
    await assert.rejects(() => new CommitWorker(f.store, f.driver, f.now).run(f.instruction.tenant, 'TB-001', 2));
    f.store.close(); const reopened = new Store(path);
    try {
      f.observe(f.confirmed);
      const result = await new CommitWorker(reopened, f.driver, f.now).run(f.instruction.tenant, 'TB-001', 2);
      assert.equal(result.state, 'CONFIRMED'); assert.equal(f.prepares(), 1); assert.equal(f.broadcasts.length, 1);
    } finally { reopened.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
