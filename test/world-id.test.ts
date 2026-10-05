import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createCandidate, type Candidate } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { approvalAction, WorldIdService, worldConfigFromEnv, worldConfigSchema, worldTrustMode, type HumanTrustBoundary, type WorldConfig } from '../src/world-id.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';

const config: WorldConfig = { app_id: 'app_test', rp_id: 'rp_test', action: 'tradebridge-approval', signing_key: '1'.repeat(64), environment: 'staging', require_presence: true, allow_legacy_simulator: false };
const fakeTrust: HumanTrustBoundary = {
  async validatePresence() { return 'test-only-authenticated-presence'; },
  async validateEnrollment(_p, scope, nullifier) { return `${scope}:${nullifier}`; },
};
function fixture(trust?: HumanTrustBoundary, configOverrides: Partial<WorldConfig> = {}) {
  const cfg: WorldConfig = { ...config, ...configOverrides };
  const store = new Store(); const principal = examplePrincipals().find(p => p.id === 'buyer-human')!;
  const now = new Date(); seedSandbox(store, principal, now);
  const trade = store.get(principal.tenant, 'TB-001')!;
  let candidate: Candidate | undefined = createCandidate(trade, exampleTerms('buyer', now), 'Test proposal', { chain_id: 'local', package_id: 'package', registry_id: 'registry', bond_type: exampleTerms('buyer', now).bond_type, cash_type: exampleTerms('buyer', now).cash_type }, now);
  const calls: string[] = []; const headers: Record<string, string>[] = [];
  let serverReply: unknown; let replyStatus = 200;
  const request = (async (url: string | URL | Request, init?: RequestInit) => { calls.push(String(url)); headers.push({ ...(init?.headers as Record<string, string>) }); return new Response(JSON.stringify(serverReply), { status: replyStatus }); }) as typeof fetch;
  const service = new WorldIdService(store, cfg, trust, request);
  const challenge = service.begin(principal, candidate);
  serverReply = { success: true, action: challenge.action, environment: cfg.environment, results: [{ identifier: 'proof_of_human', success: true, nullifier: '0x2a' }] };
  const proof = { protocol_version: '4.0', action: challenge.action, environment: cfg.environment, nonce: challenge.nonce, user_presence_completed: true, responses: [{ identifier: 'proof_of_human', signal_hash: challenge.signal_hash, nullifier: '0x2a', issuer_schema_id: 1, expires_at_min: Math.floor(now.getTime() / 1000) + 3600, proof: ['0x1','0x2','0x3','0x4','0x5'] }] };
  return { store, principal, service, challenge, proof, calls, headers, candidate: () => candidate, changeCandidate() { candidate = undefined; }, setReply(reply: unknown, status = 200) { serverReply = reply; replyStatus = status; } };
}
test('challenge is role/version/context-bound and does not expose its signing key', () => {
  const f = fixture(); try {
    const publicRequest = f.service.publicRequest(f.challenge);
    assert.equal(publicRequest.require_user_presence, true); assert.equal(publicRequest.allow_legacy_proofs, false);
    assert.equal(publicRequest.version, 2); assert.equal(publicRequest.rp_context.nonce, f.challenge.nonce);
    assert.equal(JSON.stringify(publicRequest).includes(config.signing_key), false);
    const second = f.service.begin(f.principal, f.candidate()!);
    assert.notEqual(second.signal_hash, f.challenge.signal_hash);
  } finally { f.store.close(); }
});
test('a valid World proof alone never satisfies presence or staff identity', async () => {
  const f = fixture(); try {
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate), /trusted fresh-presence/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.store.getChallenge<{state: string}>(f.challenge.id, f.principal.tenant)!.state, 'FAILED');
  } finally { f.store.close(); }
});
test('test-injected trust adapter permits a receipt, not trade approval', async () => {
  const f = fixture(fakeTrust); try {
    const result = await f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate);
    assert.equal(result.challenge_id, f.challenge.id); assert.ok(result.person_binding.endsWith(':42'));
    assert.equal(f.store.get(f.principal.tenant, 'TB-001')!.canonical, null);
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate), /already been submitted/);
    assert.equal(f.calls.length, 1);
  } finally { f.store.close(); }
});
for (const [field, value] of [['nonce', 'wrong'], ['action', 'other'], ['environment', 'production'], ['protocol_version', '3.0'], ['user_presence_completed', false]] as const) {
  test(`rejects invalid ${field} before contacting World`, async () => {
    const f = fixture(fakeTrust); try {
      await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, { ...f.proof, [field]: value }, f.candidate));
      assert.equal(f.calls.length, 0);
    } finally { f.store.close(); }
  });
}
test('stale proposal and different account cannot reuse a challenge', async () => {
  const f = fixture(fakeTrust); try {
    await assert.rejects(() => f.service.verify({ ...f.principal, id: 'different-human' }, f.challenge.id, f.proof, f.candidate), /not authorized/);
    f.changeCandidate();
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate), /trade changed/);
    assert.equal(f.calls.length, 0);
  } finally { f.store.close(); }
});
test('HTTP success with a failed required credential does not verify', async () => {
  const f = fixture(fakeTrust); try {
    f.setReply({ success: true, action: f.challenge.action, environment: config.environment, results: [{ identifier: 'proof_of_human', success: false, nullifier: '0x2a' }] });
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate));
  } finally { f.store.close(); }
});
test('server response environment mismatch is rejected', async () => {
  const f = fixture(fakeTrust); try {
    f.setReply({ success: true, action: f.challenge.action, environment: 'production', results: [{ identifier: 'proof_of_human', success: true, nullifier: '0x2a' }] });
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate), /does not match/);
  } finally { f.store.close(); }
});
test('each candidate version gets its own World action, and a proof for another action is refused', async () => {
  const f = fixture(fakeTrust); try {
    assert.equal(f.challenge.action, approvalAction(config.action, f.candidate()!));
    assert.match(f.challenge.action, /^tradebridge-approval-[a-f0-9]{32}$/);
    assert.equal(f.service.publicRequest(f.challenge).action, f.challenge.action);
    const trade = f.store.get(f.principal.tenant, 'TB-001')!;
    const next = createCandidate({ ...trade, candidates: [f.candidate()!] }, exampleTerms('buyer'), 'Another version', { chain_id: 'local', package_id: 'package', registry_id: 'registry', bond_type: exampleTerms('buyer').bond_type, cash_type: exampleTerms('buyer').cash_type }, new Date());
    assert.notEqual(approvalAction(config.action, next), f.challenge.action);
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, { ...f.proof, action: config.action }, f.candidate), /does not match/);
    assert.equal(f.calls.length, 0);
  } finally { f.store.close(); }
});
test('one person cannot verify for both sides of a version, but can retry for their own side', async () => {
  const f = fixture(fakeTrust); try {
    await f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate);
    const broker = examplePrincipals().find(p => p.id === 'broker-human')!;
    const other = f.service.begin(broker, f.candidate()!);
    await assert.rejects(() => f.service.verify(broker, other.id, { ...f.proof, nonce: other.nonce, responses: [{ ...f.proof.responses[0]!, signal_hash: other.signal_hash }] }, f.candidate), (error: Error & { code?: string }) => error.code === 'SAME_PERSON_BOTH_SIDES' && /buyer approver/.test(error.message));
    const retry = f.service.begin(f.principal, f.candidate()!);
    const again = await f.service.verify(f.principal, retry.id, { ...f.proof, nonce: retry.nonce, responses: [{ ...f.proof.responses[0]!, signal_hash: retry.signal_hash }] }, f.candidate);
    assert.equal(again.challenge_id, retry.id);
  } finally { f.store.close(); }
});
test('a concurrent proof replay contacts the verifier at most once', async () => {
  const f = fixture(fakeTrust); try {
    const results = await Promise.allSettled([f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate), f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.length, 1);
  } finally { f.store.close(); }
});
test('presence is required by default; a proof that does not confirm it is rejected pre-network', async () => {
  const f = fixture(fakeTrust); try {
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, { ...f.proof, user_presence_completed: false }, f.candidate), /presence/);
    assert.equal(f.calls.length, 0);
  } finally { f.store.close(); }
});
test('presence is not required when the config says so; an incomplete proof still verifies', async () => {
  const f = fixture(fakeTrust, { require_presence: false }); try {
    const result = await f.service.verify(f.principal, f.challenge.id, { ...f.proof, user_presence_completed: false }, f.candidate);
    assert.ok(result.identity_scope.endsWith(':4.0'));
  } finally { f.store.close(); }
});
test('legacy 3.0 proofs are rejected unless the staging simulator path is explicitly allowed', async () => {
  const f = fixture(fakeTrust);
  const legacy = { protocol_version: '3.0', action: f.challenge.action, environment: config.environment, nonce: f.challenge.nonce, responses: [{ identifier: 'proof_of_human', signal_hash: f.challenge.signal_hash, proof: '0xabc', merkle_root: '0xdef', nullifier: '0x2a' }] };
  try {
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, legacy, f.candidate), /World ID 4\.0/);
    assert.equal(f.calls.length, 0);
  } finally { f.store.close(); }
});
test('legacy 3.0 proofs are accepted on staging once explicitly allowed, scoped apart from 4.0', async () => {
  // The simulator cannot satisfy a presence check either, so the realistic staging-backup
  // configuration turns both flags on together.
  const f = fixture(fakeTrust, { allow_legacy_simulator: true, require_presence: false });
  const legacy = { protocol_version: '3.0', action: f.challenge.action, environment: config.environment, nonce: f.challenge.nonce, responses: [{ identifier: 'proof_of_human', signal_hash: f.challenge.signal_hash, proof: '0xabc', merkle_root: '0xdef', nullifier: '0x2a' }] };
  try {
    const result = await f.service.verify(f.principal, f.challenge.id, legacy, f.candidate);
    assert.ok(result.identity_scope.endsWith(':3.0'));
  } finally { f.store.close(); }
});
test('worldConfigSchema rejects the legacy simulator path outside staging', () => {
  assert.throws(() => worldConfigSchema.parse({ app_id: 'app_test', rp_id: 'rp_test', action: 'a', signing_key: '2'.repeat(64), environment: 'production', allow_legacy_simulator: true }));
  assert.doesNotThrow(() => worldConfigSchema.parse({ app_id: 'app_test', rp_id: 'rp_test', action: 'a', signing_key: '2'.repeat(64), environment: 'staging', allow_legacy_simulator: true }));
});
test('worldConfigFromEnv returns undefined without an app id, and defaults presence/legacy flags', () => {
  assert.equal(worldConfigFromEnv({}), undefined);
  const parsed = worldConfigFromEnv({ WORLD_APP_ID: 'app_x', WORLD_RP_ID: 'rp_x', WORLD_ACTION: 'tradebridge-approval', WORLD_SIGNING_KEY: '2'.repeat(64) });
  assert.deepEqual(parsed, { app_id: 'app_x', rp_id: 'rp_x', action: 'tradebridge-approval', signing_key: '2'.repeat(64), environment: 'staging', require_presence: true, allow_legacy_simulator: false });
});
test('worldConfigFromEnv parses explicit environment/presence/legacy overrides', () => {
  const parsed = worldConfigFromEnv({ WORLD_APP_ID: 'app_x', WORLD_RP_ID: 'rp_x', WORLD_ACTION: 'tradebridge-approval', WORLD_SIGNING_KEY: '2'.repeat(64), WORLD_ENVIRONMENT: 'staging', WORLD_REQUIRE_PRESENCE: 'false', WORLD_ALLOW_LEGACY_SIMULATOR: 'true' });
  assert.equal(parsed?.require_presence, false); assert.equal(parsed?.allow_legacy_simulator, true);
});
test('worldTrustMode reports the active trust posture for the UI', () => {
  assert.equal(worldTrustMode({ ...config, require_presence: true, allow_legacy_simulator: false }), 'world-app-presence');
  assert.equal(worldTrustMode({ ...config, require_presence: false, allow_legacy_simulator: false }), 'presence-not-requested');
  assert.equal(worldTrustMode({ ...config, allow_legacy_simulator: true }), 'staging-legacy-simulator');
});
test('browser session uses an isolated tenant and HttpOnly cookie; no token is returned', async () => {
  const store = new Store(); const app = createApp({ store, principals: examplePrincipals(), browser: true, demo: true });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/session/demo' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.body.includes('token'), false);
    const cookie = response.headers['set-cookie'] as string;
    assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('SameSite=Strict'));
    const headers = { cookie };
    const trade = await app.inject({ url: '/api/trades/TB-001', headers });
    assert.equal(trade.statusCode, 200); assert.ok(trade.json().tenant.startsWith('sandbox-'));
    assert.equal((await app.inject({ method: 'POST', url: '/api/trades/TB-001/approvals', headers })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/session/demo', headers: { origin: 'https://untrusted.example' } })).statusCode, 403);
    await app.inject({ method: 'DELETE', url: '/api/session', headers });
    assert.equal((await app.inject({ url: '/api/trades/TB-001', headers })).statusCode, 401);
  } finally { await app.close(); store.close(); }
});
test('staging proofs carry the staging verification token when one is configured', async () => {
  const f = fixture(fakeTrust, { staging_verification_token: 'window-token' }); try {
    await f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate);
    assert.equal(f.headers[0]!['x-staging-verification-token'], 'window-token');
  } finally { f.store.close(); }
});
test('without a token, no staging verification header is sent', async () => {
  const f = fixture(fakeTrust); try {
    await f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate);
    assert.equal('x-staging-verification-token' in f.headers[0]!, false);
  } finally { f.store.close(); }
});
test('a closed staging verification window is reported as such, not as a rejected proof', async () => {
  const f = fixture(fakeTrust); try {
    f.setReply({ code: 'environment_not_allowed', detail: 'Staging verification is not enabled.' }, 403);
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, f.proof, f.candidate), (error: unknown) => (error as { code?: string }).code === 'WORLD_STAGING_WINDOW_CLOSED');
  } finally { f.store.close(); }
});
test('a staging verification token is refused outside staging and read from the environment', () => {
  assert.throws(() => worldConfigSchema.parse({ app_id: 'app_test', rp_id: 'rp_test', action: 'a', signing_key: '2'.repeat(64), environment: 'production', staging_verification_token: 't' }));
  assert.equal(worldConfigFromEnv({ WORLD_APP_ID: 'app_test', WORLD_RP_ID: 'rp_test', WORLD_SIGNING_KEY: '2'.repeat(64), WORLD_ENVIRONMENT: 'staging', WORLD_STAGING_VERIFICATION_TOKEN: 't' })?.staging_verification_token, 't');
  assert.equal(worldConfigFromEnv({ WORLD_APP_ID: 'app_test', WORLD_RP_ID: 'rp_test', WORLD_SIGNING_KEY: '2'.repeat(64), WORLD_ENVIRONMENT: 'production', WORLD_STAGING_VERIFICATION_TOKEN: '' })?.staging_verification_token, undefined);
});
test('a real-world credential expiry attested at about the moment of proving still verifies', async () => {
  const f = fixture(fakeTrust); try {
    const proof = { ...f.proof, responses: [{ ...f.proof.responses[0]!, expires_at_min: f.challenge.created_at }] };
    const result = await f.service.verify(f.principal, f.challenge.id, proof, f.candidate);
    assert.ok(result.person_binding);
  } finally { f.store.close(); }
});
test('an attested credential expiry that ends before the challenge was issued is refused, naming the check', async () => {
  const f = fixture(fakeTrust); try {
    const proof = { ...f.proof, responses: [{ ...f.proof.responses[0]!, expires_at_min: f.challenge.created_at - 3600 }] };
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, proof, f.candidate), /\(credential expiry\)/);
  } finally { f.store.close(); }
});
test('nonces compare as field elements, so formatting differences do not matter but other values do', async () => {
  const f = fixture(fakeTrust); try {
    await assert.rejects(() => f.service.verify(f.principal, f.challenge.id, { ...f.proof, nonce: '0x' + '0'.repeat(63) + '1' }, f.candidate), /\(nonce\)/);
    const result = await f.service.verify(f.principal, f.challenge.id, { ...f.proof, nonce: f.challenge.nonce.toUpperCase().replace('0X', '0x') }, f.candidate);
    assert.ok(result.person_binding);
  } finally { f.store.close(); }
});
