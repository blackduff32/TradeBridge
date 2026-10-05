import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSignal } from '@worldcoin/idkit-core';
import { createApp } from '../src/app.js';
import { demoTrust } from '../src/demo-trust.js';
import { Store } from '../src/store.js';
import { seedSandbox } from '../src/seed.js';
import type { WorldConfig } from '../src/world-id.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';

const world: WorldConfig = { app_id: 'app_test', rp_id: 'rp_test', action: 'tradebridge-approval', signing_key: '1'.repeat(64), environment: 'staging', require_presence: true, allow_legacy_simulator: false };

test('demo roster is opt-in, staging-only and names exactly one buyer and one broker human', () => {
  const principals = examplePrincipals();
  assert.throws(() => demoTrust(principals, 'buyer-human,broker-human', undefined), /needs a World ID app/);
  assert.throws(() => demoTrust(principals, 'buyer-human,broker-human', { ...world, environment: 'production' }), /only runs with WORLD_ENVIRONMENT=staging/);
  assert.throws(() => demoTrust(principals, 'buyer-human', world), /exactly one buyer and one broker/);
  assert.throws(() => demoTrust(principals, 'buyer-human,buyer-human', world), /exactly one buyer and one broker/);
  assert.throws(() => demoTrust(principals, 'buyer-agent,broker-human', world), /must name exactly one human/);
  assert.throws(() => demoTrust(principals, 'buyer-human,nobody', world), /must name exactly one human/);
  assert.deepEqual(demoTrust(principals, ' buyer-human , broker-human ', world).approvers, [{ id: 'buyer-human', side: 'buyer' }, { id: 'broker-human', side: 'broker' }]);
});
test('demo roster enforces enrollment and binds a person to the scoped nullifier only', async () => {
  const principals = examplePrincipals(); const { staffAuthority, humanTrust } = demoTrust(principals, 'buyer-human,broker-human', world);
  const buyer = principals.find(p => p.id === 'buyer-human')!; const agent = principals.find(p => p.id === 'buyer-agent')!;
  await staffAuthority.assertCurrent(buyer);
  await assert.rejects(() => staffAuthority.assertCurrent(agent), /not an enrolled approver/);
  await assert.rejects(() => staffAuthority.assertCurrent({ ...buyer, side: 'broker' }), /not an enrolled approver/);
  assert.equal(staffAuthority.resolve(buyer.tenant, 'buyer-human')?.id, 'buyer-human');
  assert.equal(staffAuthority.resolve(buyer.tenant, 'buyer-agent'), undefined);
  const person = await humanTrust.validateEnrollment(buyer, 'rp_test:action:staging', '42');
  assert.match(person, /^person:[a-f0-9]{64}$/);
  assert.notEqual(person, await humanTrust.validateEnrollment(buyer, 'rp_test:other:staging', '42'));
  await assert.rejects(() => humanTrust.validateEnrollment(agent, 'scope', '42'), /not an enrolled approver/);
  const challenge = { id: 'challenge', nonce: 'nonce' } as never;
  assert.match(await humanTrust.validatePresence({ user_presence_completed: true }, {}, challenge), /^demo-client-reported:/);
  await assert.rejects(() => humanTrust.validatePresence({}, {}, challenge), /does not report a completed presence check/);
});

// A stub World verifier that accepts any well-formed proof, so the rest of the path is real code.
function worldApi() {
  const calls: string[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body));
    return Response.json({ success: true, action: body.action, environment: body.environment, results: [{ identifier: 'proof_of_human', success: true, nullifier: body.responses[0].nullifier }] });
  }) as typeof fetch;
  return { calls, request };
}
function fixture() {
  const store = new Store(); const principals = examplePrincipals(); const now = new Date(); const api = worldApi();
  const trust = demoTrust(principals, 'buyer-human,broker-human', world);
  const app = createApp({ store, principals, world, worldFetch: api.request, staffAuthority: trust.staffAuthority, humanTrust: trust.humanTrust, demoTrust: true, now: () => now });
  const human = (id: string) => principals.find(p => p.id === id)!;
  seedSandbox(store, human('buyer-human'), now);
  const auth = (id: string, key?: string) => ({ authorization: `Bearer ${human(id).token}`, ...(key ? { 'idempotency-key': key } : {}) });
  const trade = () => store.get(human('buyer-human').tenant, 'TB-001')!;
  async function verify(id: string, nullifier: string) {
    const latest = trade().candidates.at(-1)!;
    const challenge = await app.inject({ method: 'POST', url: '/trades/TB-001/verification-challenges', headers: auth(id, `challenge-${id}-${nullifier}-${trade().revision}`), payload: { expected_revision: trade().revision, terms_hash: latest.terms_hash } });
    assert.equal(challenge.statusCode, 200, challenge.body);
    const request = challenge.json();
    const proof = { protocol_version: '4.0', action: request.action, environment: request.environment, nonce: request.rp_context.nonce, user_presence_completed: true, responses: [{ identifier: 'proof_of_human', signal_hash: hashSignal(request.signal), nullifier, issuer_schema_id: 1, expires_at_min: Math.floor(now.getTime() / 1000) + 3600, proof: ['0x1', '0x2', '0x3', '0x4', '0x5'] }] };
    return { request, response: await app.inject({ method: 'POST', url: '/trades/TB-001/world-id-verifications', headers: auth(id), payload: { challenge_id: request.challenge_id, proof } }) };
  }
  async function decide(id: string, challengeId: string, decision: 'approve' | 'reject', replay?: object) {
    const latest = trade().candidates.at(-1)!;
    const payload = replay ?? { expected_revision: trade().revision, challenge_id: challengeId, version: latest.version, terms_hash: latest.terms_hash, decision };
    return Object.assign(await app.inject({ method: 'POST', url: '/trades/TB-001/approvals', headers: auth(id, `decision-${challengeId}`), payload }), { sent: payload });
  }
  async function propose() {
    const response = await app.inject({ method: 'POST', url: '/trades/TB-001/proposals', headers: auth('broker-agent', `propose-${trade().revision}`), payload: { expected_revision: trade().revision, terms: exampleTerms('buyer', now), reason: 'Align the broker confirmation with the buyer order.' } });
    assert.equal(response.statusCode, 200, response.body);
  }
  return { app, store, api, trade, verify, decide, propose, auth, close: async () => { await app.close(); store.close(); } };
}

test('demo trust: two distinct verified approvers stage exactly the approved version once', async () => {
  const f = fixture(); try {
    assert.equal((await f.app.inject('/health')).json().integrations.world_id, 'configured_demo_trust_boundary');
    const integrations = (await f.app.inject({ url: '/integrations', headers: f.auth('buyer-human') })).json();
    assert.equal(integrations.world_id.approvals_ready, true); assert.equal(integrations.world_id.trust, 'demo_static_roster');
    await f.propose();
    const buyer = await f.verify('buyer-human', '0x2a');
    assert.equal(buyer.response.statusCode, 200, buyer.response.body);
    assert.deepEqual(buyer.response.json(), { status: 'WORLD_ID_VERIFIED', approval: 'NOT_GIVEN' });
    assert.deepEqual(f.api.calls, ['https://developer.world.org/api/v4/verify/rp_test']);
    const first = await f.decide('buyer-human', buyer.request.challenge_id, 'approve');
    assert.equal(first.statusCode, 200, first.body); assert.equal(first.json().correction, null);
    assert.equal(f.trade().canonical, null);
    const broker = await f.verify('broker-human', '0x2b');
    assert.equal(broker.request.action, buyer.request.action);
    assert.equal(broker.response.statusCode, 200, broker.response.body);
    const second = await f.decide('broker-human', broker.request.challenge_id, 'approve');
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual({ ...second.json().correction, instruction_id: 'id' }, { staged: true, instruction_id: 'id', version: 2, state: 'PENDING' });
    assert.equal(f.trade().canonical!.terms.quantity, '1000'); assert.equal(f.trade().sources.broker!.record.quantity, '1100');
    const reconciliation = (await f.app.inject({ url: '/trades/TB-001/reconciliation', headers: f.auth('buyer-human') })).json();
    assert.deepEqual(reconciliation.approvals, { buyer: 'CONSUMED', broker: 'CONSUMED' });
    assert.equal(reconciliation.commitment_status, 'PENDING'); assert.ok(reconciliation.limitations.includes('DEMO_TRUST_BOUNDARY'));
    const replay = await f.decide('broker-human', broker.request.challenge_id, 'approve', second.sent);
    assert.equal(replay.statusCode, 200); assert.equal(replay.json().correction.instruction_id, second.json().correction.instruction_id);
    const audit = (await f.app.inject({ url: '/trades/TB-001/audit', headers: f.auth('buyer-human') })).json().events.map((e: { action: string }) => e.action);
    assert.deepEqual(audit.filter((a: string) => a !== 'SOURCE_IMPORTED'), ['CANDIDATE_PROPOSED', 'HUMAN_APPROVED', 'HUMAN_APPROVED', 'CORRECTION_STAGED']);
  } finally { await f.close(); }
});
test('demo trust: the same World ID cannot approve both sides, and a rejection blocks the version', async () => {
  const f = fixture(); try {
    await f.propose();
    const buyer = await f.verify('buyer-human', '0x2a');
    assert.equal(buyer.response.statusCode, 200, buyer.response.body);
    const same = await f.verify('broker-human', '0x2a');
    assert.equal(same.response.statusCode, 403); assert.equal(same.response.json().error, 'SAME_PERSON_BOTH_SIDES');
    assert.equal((await f.decide('buyer-human', buyer.request.challenge_id, 'reject')).json().decision, 'reject');
    const broker = await f.verify('broker-human', '0x2b');
    assert.equal(broker.response.statusCode, 200, broker.response.body);
    const blocked = await f.decide('broker-human', broker.request.challenge_id, 'approve');
    assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error, 'APPROVAL_REJECTED');
    assert.equal(f.trade().canonical, null);
    const agent = await f.app.inject({ method: 'POST', url: '/trades/TB-001/verification-challenges', headers: f.auth('buyer-agent', 'agent-challenge'), payload: { expected_revision: f.trade().revision, terms_hash: f.trade().candidates.at(-1)!.terms_hash } });
    assert.equal(agent.statusCode, 403); assert.equal(agent.json().error, 'AGENT_AUTHORITY_DENIED');
  } finally { await f.close(); }
});
