import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, randomUUID, sign as signOnce } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Store } from '../src/store.js';
import { DomainError, demoEnvironment, tradeIdSchema, type Economics, type Principal } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';
import { agentIdpFromEnv, registerAgentRoutes, type AgentAuthorizationRecord, type AgentIdpConfig } from '../src/world-agents.js';
import type { ModelDriver } from '../src/agents.js';

// --- A fake World ID for Agents IdP: a real RSA keypair, a real JWKS document, and a scriptable device/token
// endpoint. Everything is served through an injected `fetch`, exactly like production would inject the real one.
function fakeIdp() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key-1';
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid, alg: 'RS256', use: 'sig' };
  const issuer = 'https://idp.test';
  const config: AgentIdpConfig = { issuer, client_id: 'agent-client-test', client_secret: 'agent-secret-test' };
  const tokenQueues = new Map<string, { status: number; body: unknown }[]>();
  let deviceCounter = 0; let tokenCalls = 0;
  function sign(claims: Record<string, unknown>) {
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signingInput = `${encode(header)}.${encode(claims)}`;
    return `${signingInput}.${signOnce('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
  }
  function claims(atSeconds: number, overrides: Record<string, unknown> = {}) {
    return { iss: issuer, sub: 'sub-buyer-1', aud: config.client_id, exp: atSeconds + 300, iat: atSeconds, auth_time: atSeconds, acr: 'https://world.org/oidc/acr/orb-v3', amr: ['pop'], jti: randomUUID(), ...overrides };
  }
  function queueToken(deviceCode: string, response: { status: number; body: unknown }) {
    (tokenQueues.get(deviceCode) ?? tokenQueues.set(deviceCode, []).get(deviceCode)!).push(response);
  }
  const fetchImpl: typeof fetch = async (url, init) => {
    const href = String(url);
    if (href === `${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    if (href === `${issuer}/api/v1/device_authorization`) {
      deviceCounter += 1;
      const deviceCode = `device-code-${deviceCounter}`;
      tokenQueues.set(deviceCode, []);
      return new Response(JSON.stringify({ device_code: deviceCode, user_code: `USER-${deviceCounter}`, verification_uri: `${issuer}/device`, verification_uri_complete: `${issuer}/device?user_code=USER-${deviceCounter}`, expires_in: 600, interval: 1 }), { status: 200 });
    }
    if (href === `${issuer}/api/v1/token`) {
      tokenCalls += 1;
      const params = new URLSearchParams(String(init?.body ?? ''));
      const deviceCode = params.get('device_code') ?? '';
      const next = tokenQueues.get(deviceCode)?.shift() ?? { status: 400, body: { error: 'authorization_pending' } };
      return new Response(JSON.stringify(next.body), { status: next.status });
    }
    throw new Error(`fakeIdp: unexpected fetch to ${href}`);
  };
  return { config, issuer, sign, claims, queueToken, fetchImpl, tokenCalls: () => tokenCalls };
}
function corruptSignature(token: string) {
  const [header, payload, signature] = token.split('.');
  const flipped = (signature![0] === 'A' ? 'B' : 'A') + signature!.slice(1);
  return `${header}.${payload}.${flipped}`;
}
/** A deterministic, stateless script: read the source, compare, propose, then stop. Stateless (derives its turn
 *  from how many tool results are already in the conversation) so one instance can drive multiple independent runs. */
function scriptedDriver(expectedRevision: number, terms: Economics, reason: string): ModelDriver {
  return {
    async respond(input) {
      const completed = input.filter(item => typeof item === 'object' && item !== null && (item as { type?: string }).type === 'function_call_output').length;
      if (completed === 0) return { output: [{ type: 'function_call', name: 'read_own_source', call_id: 'c1', arguments: '{}' }] };
      if (completed === 1) return { output: [{ type: 'function_call', name: 'compare_records', call_id: 'c2', arguments: '{}' }] };
      if (completed === 2) return { output: [{ type: 'function_call', name: 'propose_correction', call_id: 'c3', arguments: JSON.stringify({ expected_revision: expectedRevision, terms, reason }) }] };
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Draft created. Awaiting World ID authorization.' }] }] };
    },
  };
}

// --- A standalone harness for src/world-agents.ts's registerAgentRoutes, mirroring the auth hook and the
// actor()/tradeFor() helpers the lead will wire up in src/app.ts (see the final report for that exact code).
function buildTestApp(opts: { model?: ModelDriver; idp?: AgentIdpConfig; fetchImpl?: typeof fetch; now?: () => Date } = {}) {
  const store = new Store();
  const principals = examplePrincipals();
  const now = opts.now ?? (() => new Date());
  seedSandbox(store, principals.find(p => p.id === 'buyer-human')!, now());
  const app = Fastify({ logger: false });
  const principalsMap = new WeakMap<FastifyRequest, Principal>();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'VALIDATION_FAILED', issues: error.issues });
    if (error instanceof DomainError) return reply.code(error.status).send({ error: error.code, message: error.message });
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: String(error) });
  });
  app.register(async api => {
    api.addHook('onRequest', async request => {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const principal = principals.find(p => p.token === token);
      if (!principal) throw new DomainError('UNAUTHENTICATED', 'A configured bearer token is required.', 401);
      principalsMap.set(request, principal);
    });
    const actor = (request: FastifyRequest) => principalsMap.get(request)!;
    const pathParams = z.object({ id: tradeIdSchema });
    function tradeFor(request: FastifyRequest) {
      const { id } = pathParams.parse(request.params);
      const p = actor(request);
      if (!p.tradeIds.includes(id)) throw new DomainError('NOT_FOUND', 'Trade was not found in your scope.', 404);
      const trade = store.get(p.tenant, id);
      if (!trade) throw new DomainError('NOT_FOUND', 'Trade was not found in your scope.', 404);
      return trade;
    }
    registerAgentRoutes(api, { store, principals, environment: demoEnvironment, now, model: opts.model, idp: opts.idp, fetch: opts.fetchImpl, actor, tradeFor });
  });
  return { app, store, principals };
}
function clockBox(start = new Date('2026-09-26T00:00:00.000Z')) {
  let current = start;
  return { now: () => current, advance: (ms: number) => { current = new Date(current.getTime() + ms); } };
}
const dispatch = (app: FastifyInstance, token: string, key: string, revision: number) =>
  app.inject({ method: 'POST', url: '/trades/TB-001/agent-runs', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, payload: { expected_revision: revision } });
const pollOnce = (app: FastifyInstance, token: string, aid: string) =>
  app.inject({ method: 'POST', url: `/trades/TB-001/agent-authorizations/${aid}/poll`, headers: { authorization: `Bearer ${token}` } });
const cancelOnce = (app: FastifyInstance, token: string, aid: string) =>
  app.inject({ method: 'POST', url: `/trades/TB-001/agent-authorizations/${aid}/cancel`, headers: { authorization: `Bearer ${token}` } });
const listAuthorizations = (app: FastifyInstance, token: string) =>
  app.inject({ method: 'GET', url: '/trades/TB-001/agent-authorizations', headers: { authorization: `Bearer ${token}` } });
async function freshDraft(app: FastifyInstance, store: Store, tenant: string, token: string, key: string) {
  const before = new Set(store.agentAuthorizations<AgentAuthorizationRecord>(tenant, 'TB-001').map(r => r.id));
  const response = await dispatch(app, token, key, 2);
  assert.equal(response.statusCode, 200, response.body);
  const created = store.agentAuthorizations<AgentAuthorizationRecord>(tenant, 'TB-001').find(r => !before.has(r.id));
  assert.ok(created, 'expected the agent to have drafted a proposal');
  return created!;
}
function driverFor(revision = 2) { return scriptedDriver(revision, exampleTerms('buyer'), 'Buyer evidence supports exactly 1000 units.'); }

test('agentIdpFromEnv reads server-only credentials and is absent without a client id', () => {
  assert.equal(agentIdpFromEnv({}), undefined);
  const config = agentIdpFromEnv({ WORLD_IDP_CLIENT_ID: 'client-x', WORLD_IDP_CLIENT_SECRET: 'secret-x' });
  assert.equal(config?.issuer, 'https://sandbox.auth.world.org'); assert.equal(config?.client_id, 'client-x'); assert.equal(config?.client_secret, 'secret-x');
});

test('approved path: a valid World ID authorization creates exactly one candidate', async () => {
  const idp = fakeIdp(); const clock = clockBox();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
    assert.equal(draft.human_account, 'buyer-human'); assert.equal(draft.agent_account, 'buyer-agent');
    assert.ok(draft.device_code); assert.ok(draft.user_code); assert.ok(draft.verification_uri_complete);
    clock.advance(2000);
    idp.queueToken(draft.device_code!, { status: 200, body: { id_token: idp.sign(idp.claims(Math.floor(clock.now().getTime() / 1000))) } });
    const response = await pollOnce(app, human.token, draft.id);
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(body.state, 'AUTHORIZED'); assert.equal(body.candidate_version, 2); assert.equal(body.user_code, null);
    const trade = store.get(human.tenant, 'TB-001')!;
    assert.equal(trade.candidates.length, 1); assert.equal(trade.candidates[0]!.terms.quantity, exampleTerms('buyer').quantity);
    const authorizedEvent = store.history(human.tenant, 'TB-001').at(-1)!;
    assert.equal(authorizedEvent.action, 'AGENT_PROPOSAL_AUTHORIZED');
    assert.ok(JSON.stringify(authorizedEvent.detail).includes(idp.issuer));
    assert.equal(JSON.stringify(authorizedEvent.detail).includes('sub-buyer-1'), false); // only a hash of sub is audited
  } finally { await app.close(); store.close(); }
});

test('polling faster than the interval is throttled locally and never contacts World twice', async () => {
  const idp = fakeIdp(); const clock = clockBox();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1'); // interval is 1s
    clock.advance(1); // far less than the 1s interval since device authorization started
    const throttled = await pollOnce(app, human.token, draft.id);
    assert.equal(JSON.parse(throttled.body).state, 'PENDING_HUMAN'); assert.equal(idp.tokenCalls(), 0);
    clock.advance(2000); // now past the interval
    const pending = await pollOnce(app, human.token, draft.id);
    assert.equal(JSON.parse(pending.body).state, 'PENDING_HUMAN'); assert.equal(idp.tokenCalls(), 1);
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 0);
  } finally { await app.close(); store.close(); }
});

for (const errorCode of ['access_denied', 'expired_token'] as const) {
  test(`${errorCode} from World resolves to a terminal state with no candidate created`, async () => {
    const idp = fakeIdp(); const clock = clockBox();
    const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
    try {
      const human = principals.find(p => p.id === 'buyer-human')!;
      const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
      clock.advance(2000);
      idp.queueToken(draft.device_code!, { status: 400, body: { error: errorCode } });
      const response = await pollOnce(app, human.token, draft.id);
      const body = JSON.parse(response.body);
      assert.equal(body.state, errorCode === 'access_denied' ? 'DENIED' : 'EXPIRED');
      assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 0);
      const event = store.history(human.tenant, 'TB-001').at(-1)!;
      assert.equal(event.action, errorCode === 'access_denied' ? 'AGENT_PROPOSAL_DENIED' : 'AGENT_PROPOSAL_EXPIRED');
    } finally { await app.close(); store.close(); }
  });
}

test('a human cancelling a pending draft creates no candidate and blocks further authorization', async () => {
  const idp = fakeIdp();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
    const response = await cancelOnce(app, human.token, draft.id);
    assert.equal(JSON.parse(response.body).state, 'CANCELLED');
    idp.queueToken(draft.device_code!, { status: 200, body: { id_token: idp.sign(idp.claims(Math.floor(Date.now() / 1000))) } });
    const afterCancel = await pollOnce(app, human.token, draft.id); // idempotent: already resolved, does not contact World again
    assert.equal(JSON.parse(afterCancel.body).state, 'CANCELLED');
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 0);
  } finally { await app.close(); store.close(); }
});

async function expectRejectedToken(buildToken: (idp: ReturnType<typeof fakeIdp>, nowSeconds: number) => string) {
  const idp = fakeIdp(); const clock = clockBox();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
    clock.advance(2000);
    idp.queueToken(draft.device_code!, { status: 200, body: { id_token: buildToken(idp, Math.floor(clock.now().getTime() / 1000)) } });
    const response = await pollOnce(app, human.token, draft.id);
    const body = JSON.parse(response.body);
    assert.equal(body.state, 'FAILED', JSON.stringify(body));
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 0);
  } finally { await app.close(); store.close(); }
}
test('a tampered signature is rejected', () => expectRejectedToken((idp, at) => corruptSignature(idp.sign(idp.claims(at)))));
test('a token issued for the wrong client (aud) is rejected', () => expectRejectedToken((idp, at) => idp.sign(idp.claims(at, { aud: 'someone-elses-client' }))));
test('a token from an unexpected issuer is rejected', () => expectRejectedToken((idp, at) => idp.sign(idp.claims(at, { iss: 'https://not-the-configured-idp.test' }))));
test('a stale auth_time (before this authorization began) is rejected', () => expectRejectedToken((idp, at) => idp.sign(idp.claims(at, { auth_time: at - 3600 }))));

test('a replayed jti is rejected when presented for a second, different authorization', async () => {
  const idp = fakeIdp(); const clock = clockBox();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft1 = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1'); clock.advance(1000);
    const draft2 = await freshDraft(app, store, human.tenant, human.token, 'dispatch-2'); clock.advance(2000);
    const sharedToken = idp.sign(idp.claims(Math.floor(clock.now().getTime() / 1000)));
    idp.queueToken(draft1.device_code!, { status: 200, body: { id_token: sharedToken } });
    idp.queueToken(draft2.device_code!, { status: 200, body: { id_token: sharedToken } });
    assert.equal(JSON.parse((await pollOnce(app, human.token, draft1.id)).body).state, 'AUTHORIZED');
    clock.advance(1000);
    assert.equal(JSON.parse((await pollOnce(app, human.token, draft2.id)).body).state, 'FAILED');
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 1);
  } finally { await app.close(); store.close(); }
});

test('a different sub for the same human account is rejected', async () => {
  const idp = fakeIdp(); const clock = clockBox();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft1 = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1'); clock.advance(1000);
    const draft2 = await freshDraft(app, store, human.tenant, human.token, 'dispatch-2'); clock.advance(2000);
    const at = Math.floor(clock.now().getTime() / 1000);
    idp.queueToken(draft1.device_code!, { status: 200, body: { id_token: idp.sign(idp.claims(at, { sub: 'sub-buyer-1' })) } });
    idp.queueToken(draft2.device_code!, { status: 200, body: { id_token: idp.sign(idp.claims(at, { sub: 'sub-buyer-IMPOSTER' })) } });
    assert.equal(JSON.parse((await pollOnce(app, human.token, draft1.id)).body).state, 'AUTHORIZED');
    clock.advance(1000);
    assert.equal(JSON.parse((await pollOnce(app, human.token, draft2.id)).body).state, 'FAILED');
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 1);
  } finally { await app.close(); store.close(); }
});

test('an agent cannot poll or cancel its own draft; only the side\'s human can', async () => {
  const idp = fakeIdp(); const clock = clockBox();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const agent = principals.find(p => p.id === 'buyer-agent')!;
    const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
    clock.advance(2000);
    assert.equal((await pollOnce(app, agent.token, draft.id)).statusCode, 403);
    assert.equal((await cancelOnce(app, agent.token, draft.id)).statusCode, 403);
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 0);
    assert.equal(JSON.parse((await cancelOnce(app, human.token, draft.id)).body).state, 'CANCELLED');
  } finally { await app.close(); store.close(); }
});

test('a human dispatches their own side\'s agent; the agent may also start its own run', async () => {
  const idp = fakeIdp();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const agent = principals.find(p => p.id === 'buyer-agent')!;
    const viaHuman = await dispatch(app, human.token, 'dispatch-human', 2);
    assert.equal(viaHuman.statusCode, 200, viaHuman.body);
    const afterHuman = store.agentAuthorizations<AgentAuthorizationRecord>(human.tenant, 'TB-001');
    assert.equal(afterHuman.length, 1); assert.equal(afterHuman[0]!.human_account, 'buyer-human'); assert.equal(afterHuman[0]!.agent_account, 'buyer-agent');
    const viaAgent = await dispatch(app, agent.token, 'dispatch-agent', 2);
    assert.equal(viaAgent.statusCode, 200, viaAgent.body);
    const afterAgent = store.agentAuthorizations<AgentAuthorizationRecord>(agent.tenant, 'TB-001');
    assert.equal(afterAgent.length, 2); assert.equal(afterAgent[1]!.human_account, 'buyer-human');
  } finally { await app.close(); store.close(); }
});

test('without a configured model, dispatch fails honestly instead of fabricating agent output', async () => {
  const { app, store, principals } = buildTestApp({});
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const response = await dispatch(app, human.token, 'dispatch-1', 2);
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).error, 'MODEL_NOT_CONFIGURED');
  } finally { await app.close(); store.close(); }
});

test('dispatch retries with the same idempotency key do not run the model twice', async () => {
  let calls = 0;
  const countingDriver: ModelDriver = { async respond() { calls++; return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Review complete.' }] }] }; } };
  const { app, store, principals } = buildTestApp({ model: countingDriver });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const first = await dispatch(app, human.token, 'dispatch-retry', 2);
    assert.equal(first.statusCode, 200, first.body);
    const second = await dispatch(app, human.token, 'dispatch-retry', 2);
    assert.equal(second.body, first.body); assert.equal(calls, 1);
  } finally { await app.close(); store.close(); }
});

test('the authorizations list exposes only safe fields, never the device code or client secret', async () => {
  const idp = fakeIdp();
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: idp.fetchImpl });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
    const response = await listAuthorizations(app, human.token);
    assert.equal(response.statusCode, 200, response.body);
    const body = JSON.parse(response.body);
    assert.equal(body.idp_configured, true); assert.equal(body.authorizations.length, 1);
    assert.ok(body.authorizations[0].user_code); assert.ok(body.authorizations[0].verification_uri_complete);
    assert.equal(JSON.stringify(body).includes('device_code'), false);
    assert.equal(JSON.stringify(body).includes(idp.config.client_secret), false);
  } finally { await app.close(); store.close(); }
});

test('a draft resolved by a concurrent request while its token is verified never gains a candidate', async () => {
  const idp = fakeIdp(); const clock = clockBox();
  let race: (() => void) | undefined;
  // The JWKS fetch happens after World returned a token but before the candidate is written.
  const racingFetch: typeof fetch = async (url, init) => { if (String(url).endsWith('/.well-known/jwks.json')) race?.(); return idp.fetchImpl(url, init); };
  const { app, store, principals } = buildTestApp({ model: driverFor(), idp: idp.config, fetchImpl: racingFetch, now: clock.now });
  try {
    const human = principals.find(p => p.id === 'buyer-human')!;
    const draft = await freshDraft(app, store, human.tenant, human.token, 'dispatch-1');
    race = () => { store.transitionAgentAuthorization(human.tenant, draft.id, 'PENDING_HUMAN', 'CANCELLED', { ...draft, state: 'CANCELLED' }); };
    clock.advance(2000);
    idp.queueToken(draft.device_code!, { status: 200, body: { id_token: idp.sign(idp.claims(Math.floor(clock.now().getTime() / 1000))) } });
    const body = JSON.parse((await pollOnce(app, human.token, draft.id)).body);
    assert.equal(body.state, 'CANCELLED');
    assert.equal(store.get(human.tenant, 'TB-001')!.candidates.length, 0);
    assert.equal(store.history(human.tenant, 'TB-001').some(event => event.action === 'AGENT_PROPOSAL_AUTHORIZED'), false);
  } finally { await app.close(); store.close(); }
});
