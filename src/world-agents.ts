import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canonicalJson, createCandidate, DomainError, sha256, type Economics, type Environment, type Principal, type Side, type Trade } from './domain.js';
import type { Store } from './store.js';
import { AgentTools, runAgent, type ModelDriver } from './agents.js';

// --- World ID for Agents (Human Continuity IdP) client configuration -------------------------------------------
// Confidential (server-only) OIDC client. Never present in the browser bundle; the browser only ever sees the
// public device-flow fields returned by safeView() below.
export const agentIdpConfigSchema = z.strictObject({
  issuer: z.string().regex(/^https:\/\/[a-zA-Z0-9.-]+$/, 'Issuer must be an https origin with no path.'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});
export type AgentIdpConfig = z.infer<typeof agentIdpConfigSchema>;
/** Reads server-only World ID for Agents credentials. Absent WORLD_IDP_CLIENT_ID leaves the integration off. */
export function agentIdpFromEnv(env: NodeJS.ProcessEnv): AgentIdpConfig | undefined {
  if (!env.WORLD_IDP_CLIENT_ID) return undefined;
  return agentIdpConfigSchema.parse({ issuer: env.WORLD_IDP_ISSUER ?? 'https://sandbox.auth.world.org', client_id: env.WORLD_IDP_CLIENT_ID, client_secret: env.WORLD_IDP_CLIENT_SECRET });
}

const DEFAULT_INTERVAL = 5;
export type AgentAuthorizationState = 'PENDING_HUMAN' | 'AUTHORIZED' | 'DENIED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
export interface AgentProposalEnvelope {
  message_id: string; sending_principal: string; role: Side; trade_id: string;
  changed_fields: string[]; source_ids: string[]; evidence_ids: string[];
  proposed_fix: Economics; timestamp: string; prior_message_id: string | null;
}
// Full server-side record. device_code and any raw token/claim values never leave this shape; safeView() below
// is the only thing ever sent to the browser.
export interface AgentAuthorizationRecord {
  id: string; tenant: string; trade_id: string; side: Side; organisation: string;
  agent_account: string; human_account: string | null;
  expected_revision: number; terms: Economics; reason: string; envelope: AgentProposalEnvelope; created_at: string;
  device_code?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string;
  device_expires_at?: string; interval?: number; last_polled_at?: string; authorization_started_at?: string;
  decided_at?: string; candidate_version?: number; failure_reason?: string;
}
type StoredAuthorization = AgentAuthorizationRecord & { state: AgentAuthorizationState };
function safeView(record: StoredAuthorization, now: Date) {
  const pending = record.state === 'PENDING_HUMAN';
  const expiresIn = pending && record.device_expires_at ? Math.max(0, Math.round((Date.parse(record.device_expires_at) - now.getTime()) / 1000)) : null;
  return {
    id: record.id, trade_id: record.trade_id, side: record.side, state: record.state,
    reason: record.reason, envelope: record.envelope, created_at: record.created_at,
    human_account: record.human_account, agent_account: record.agent_account,
    user_code: pending ? record.user_code ?? null : null,
    verification_uri: pending ? record.verification_uri ?? null : null,
    verification_uri_complete: pending ? record.verification_uri_complete ?? null : null,
    expires_in: expiresIn, interval: pending ? record.interval ?? DEFAULT_INTERVAL : null,
    decided_at: record.decided_at ?? null, candidate_version: record.candidate_version ?? null, failure_reason: record.failure_reason ?? null,
  };
}

// --- World token/device endpoints (confidential client_secret_basic) -------------------------------------------
const basicAuth = (idp: AgentIdpConfig) => 'Basic ' + Buffer.from(`${idp.client_id}:${idp.client_secret}`).toString('base64');
const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1), user_code: z.string().min(1), verification_uri: z.string().min(1),
  verification_uri_complete: z.string().min(1).optional(), expires_in: z.number().int().positive(), interval: z.number().int().positive().optional(),
});
export async function startDeviceAuthorization(idp: AgentIdpConfig, request: typeof fetch) {
  const response = await request(`${idp.issuer}/api/v1/device_authorization`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(idp) },
    body: new URLSearchParams({ client_id: idp.client_id, scope: 'openid' }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new DomainError('IDP_DEVICE_AUTH_UNAVAILABLE', 'Could not start a World ID device authorization request.', 503);
  return deviceAuthorizationSchema.parse(await response.json());
}
type TokenPollOutcome = { outcome: 'success'; id_token: string } | { outcome: 'pending' } | { outcome: 'slow_down' } | { outcome: 'denied' } | { outcome: 'expired' } | { outcome: 'failed' };
export async function pollDeviceToken(idp: AgentIdpConfig, deviceCode: string, request: typeof fetch): Promise<TokenPollOutcome> {
  let response: Response;
  try {
    response = await request(`${idp.issuer}/api/v1/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(idp) },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: idp.client_id }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch { return { outcome: 'failed' }; }
  const body: unknown = await response.json().catch(() => ({}));
  if (response.ok) {
    const parsed = z.object({ id_token: z.string().min(1) }).safeParse(body);
    return parsed.success ? { outcome: 'success', id_token: parsed.data.id_token } : { outcome: 'failed' };
  }
  const error = z.object({ error: z.string() }).safeParse(body);
  if (!error.success) return { outcome: 'failed' };
  if (error.data.error === 'authorization_pending') return { outcome: 'pending' };
  if (error.data.error === 'slow_down') return { outcome: 'slow_down' };
  if (error.data.error === 'access_denied') return { outcome: 'denied' };
  if (error.data.error === 'expired_token') return { outcome: 'expired' };
  return { outcome: 'failed' };
}

// --- ID token verification (node:crypto only; no dependency added) ---------------------------------------------
interface Jwks { keys: Record<string, unknown>[] }
export async function fetchJwks(idp: AgentIdpConfig, request: typeof fetch): Promise<Jwks> {
  const response = await request(`${idp.issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new DomainError('IDP_JWKS_UNAVAILABLE', 'Could not fetch the identity provider signing keys.', 503);
  return z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1) }).parse(await response.json());
}
const idTokenClaimsSchema = z.object({
  iss: z.string().min(1), sub: z.string().min(1), aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(), auth_time: z.number(), acr: z.string().min(1), jti: z.string().min(1),
}).passthrough();
/** Verifies signature (RS256 via JWKS kid), iss, aud, exp, auth_time freshness and acr presence. jti single-use
 *  and (iss,sub)-to-human binding are enforced by the caller via store.bindEnrollment. */
export function verifyIdToken(token: string, jwks: Jwks, idp: AgentIdpConfig, authorizationStartedAt: Date, now: Date) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new DomainError('IDP_TOKEN_MALFORMED', 'The identity token is malformed.', 400);
  const headerPart = parts[0]!, payloadPart = parts[1]!, signaturePart = parts[2]!;
  let header: { alg?: string; kid?: string };
  try { header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: string; kid?: string }; }
  catch { throw new DomainError('IDP_TOKEN_MALFORMED', 'The identity token header could not be parsed.', 400); }
  if (header.alg !== 'RS256') throw new DomainError('IDP_TOKEN_ALG_REJECTED', 'Only RS256 identity tokens are accepted.', 400);
  const jwk = jwks.keys.find(key => key.kid === header.kid);
  if (!jwk) throw new DomainError('IDP_KEY_UNKNOWN', 'The signing key was not found in the published JWKS.', 400);
  let keyObject;
  try { keyObject = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' }); }
  catch { throw new DomainError('IDP_KEY_INVALID', 'The published signing key could not be parsed.', 400); }
  let signatureValid = false;
  try { signatureValid = verifySignature('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`, 'ascii'), keyObject, Buffer.from(signaturePart, 'base64url')); }
  catch { signatureValid = false; }
  if (!signatureValid) throw new DomainError('IDP_TOKEN_SIGNATURE_INVALID', 'The identity token signature is invalid.', 400);
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')); }
  catch { throw new DomainError('IDP_TOKEN_MALFORMED', 'The identity token payload could not be parsed.', 400); }
  const claims = idTokenClaimsSchema.parse(payload);
  if (claims.iss !== idp.issuer) throw new DomainError('IDP_ISS_MISMATCH', 'Unexpected token issuer.', 400);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(idp.client_id)) throw new DomainError('IDP_AUD_MISMATCH', 'Token was not issued for this client.', 400);
  if (claims.exp * 1000 <= now.getTime()) throw new DomainError('IDP_TOKEN_EXPIRED', 'The identity token has expired.', 400);
  if (claims.auth_time * 1000 < authorizationStartedAt.getTime() - 30_000) throw new DomainError('IDP_AUTH_STALE', 'Authentication happened before this authorization began.', 400);
  return claims;
}

// --- Routes -------------------------------------------------------------------------------------------------
export interface AgentRoutesDeps {
  store: Store; principals: Principal[]; environment: Environment; now: () => Date;
  model?: ModelDriver; idp?: AgentIdpConfig; fetch?: typeof fetch;
  actor: (request: FastifyRequest) => Principal; tradeFor: (request: FastifyRequest) => Trade;
}
const authIdParams = z.object({ aid: z.uuid() });
const dispatchInput = z.strictObject({ expected_revision: z.number().int().nonnegative() });

export function registerAgentRoutes(api: FastifyInstance, deps: AgentRoutesDeps) {
  const request = deps.fetch ?? fetch;
  const readAuthorization = (tenant: string, id: string) => deps.store.agentAuthorization<AgentAuthorizationRecord>(tenant, id) as StoredAuthorization | undefined;

  /** A human may only dispatch (or an agent may only run as) their own side's agent; the authorizing human is
   *  always resolved from the configured principals list, never from client input. */
  function resolveAgentAndHuman(caller: Principal, tradeId: string): { agent: Principal; humanAccount: string } {
    const sameScope = (p: Principal) => p.tenant === caller.tenant && p.side === caller.side && p.tradeIds.includes(tradeId);
    if (caller.kind === 'agent') {
      const human = deps.principals.find(p => p.kind === 'human' && sameScope(p));
      if (!human) throw new DomainError('AGENT_HUMAN_NOT_CONFIGURED', 'No human account is configured for this side.', 503);
      return { agent: caller, humanAccount: human.id };
    }
    const agent = deps.principals.find(p => p.kind === 'agent' && sameScope(p));
    if (!agent) throw new DomainError('AGENT_NOT_CONFIGURED', 'No agent account is configured for this side.', 503);
    return { agent, humanAccount: caller.id };
  }

  /** Starts the World device flow for a freshly drafted authorization. The browser will only ever see the
   *  fields safeView() exposes; device_code stays server-side. Never throws: a failure here resolves the
   *  authorization to FAILED so the dispatch response and the agent's own run result are unaffected. */
  async function beginDeviceAuthorization(tenant: string, record: StoredAuthorization, at: Date) {
    if (!deps.idp) return;
    try {
      const device = await startDeviceAuthorization(deps.idp, request);
      const updated: StoredAuthorization = {
        ...record, state: 'PENDING_HUMAN',
        device_code: device.device_code, user_code: device.user_code, verification_uri: device.verification_uri,
        verification_uri_complete: device.verification_uri_complete, interval: device.interval ?? DEFAULT_INTERVAL,
        device_expires_at: new Date(at.getTime() + device.expires_in * 1000).toISOString(),
        last_polled_at: at.toISOString(), authorization_started_at: at.toISOString(),
      };
      deps.store.transitionAgentAuthorization(tenant, record.id, 'PENDING_HUMAN', 'PENDING_HUMAN', updated);
    } catch (error) {
      const failed: StoredAuthorization = { ...record, state: 'FAILED', failure_reason: error instanceof DomainError ? error.code : 'DEVICE_AUTHORIZATION_UNAVAILABLE', decided_at: at.toISOString() };
      if (deps.store.transitionAgentAuthorization(tenant, record.id, 'PENDING_HUMAN', 'FAILED', failed)) {
        const agentPrincipal: Principal = { id: record.agent_account, tenant, organisation: record.organisation, side: record.side, kind: 'agent', tradeIds: [record.trade_id], token: '' };
        deps.store.audit(agentPrincipal, record.trade_id, 'AGENT_PROPOSAL_FAILED', at, { authorization_id: record.id, reason: failed.failure_reason });
      }
    }
  }

  /** Verifies a successful token response and, only if every check passes, creates exactly one candidate in a
   *  single store.write alongside its audit event. Any failure resolves to FAILED with no candidate created. */
  async function finalize(principal: Principal, trade: Trade, record: StoredAuthorization, idToken: string, at: Date) {
    const fail = (code: string) => {
      const failed: StoredAuthorization = { ...record, state: 'FAILED', decided_at: at.toISOString(), failure_reason: code };
      if (deps.store.transitionAgentAuthorization(principal.tenant, record.id, 'PENDING_HUMAN', 'FAILED', failed)) {
        deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_FAILED', at, { authorization_id: record.id, reason: code });
        return safeView(failed, at);
      }
      // Another poll resolved this draft first; report what is actually stored.
      return safeView(readAuthorization(principal.tenant, record.id) ?? failed, at);
    };
    let claims: ReturnType<typeof verifyIdToken>;
    try {
      const jwks = await fetchJwks(deps.idp!, request);
      claims = verifyIdToken(idToken, jwks, deps.idp!, new Date(record.authorization_started_at ?? record.created_at), at);
    } catch (error) { return fail(error instanceof DomainError ? error.code : 'IDP_TOKEN_VERIFICATION_FAILED'); }
    try { deps.store.bindEnrollment(principal.tenant, claims.jti, `agent-idp-jti:${deps.idp!.issuer}`, record.id, at); }
    catch { return fail('IDP_TOKEN_REPLAYED'); }
    if (!record.human_account) return fail('AGENT_HUMAN_NOT_CONFIGURED');
    try { deps.store.bindEnrollment(principal.tenant, record.human_account, `agent-idp:${deps.idp!.issuer}`, claims.sub, at); }
    catch { return fail('IDP_IDENTITY_MISMATCH'); }
    const serviceAgent: Principal = { id: record.agent_account, tenant: principal.tenant, organisation: record.organisation, side: record.side, kind: 'agent', tradeIds: [trade.id], token: '' };
    let authorized: StoredAuthorization;
    try {
      authorized = deps.store.write(serviceAgent, `agent-authz-${record.id}`, sha256(canonicalJson({ authorization: record.id, jti: claims.jti })), () => {
        const current = deps.store.get(principal.tenant, trade.id);
        if (!current || current.revision !== record.expected_revision || current.canonical) throw new DomainError('STALE_REVISION', 'The trade changed since this draft was proposed.', 409);
        const created = createCandidate(current, record.terms, record.reason, deps.environment, at);
        const resolved: StoredAuthorization = { ...record, state: 'AUTHORIZED', decided_at: at.toISOString(), candidate_version: created.version };
        // Same transaction as the candidate: a concurrent poll can never leave a candidate behind a FAILED draft.
        if (!deps.store.transitionAgentAuthorization(principal.tenant, record.id, 'PENDING_HUMAN', 'AUTHORIZED', resolved)) throw new DomainError('AUTHORIZATION_RESOLVED', 'This draft was already resolved.', 409);
        current.candidates.push(created); current.revision++; deps.store.save(current);
        deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_AUTHORIZED', at, { authorization_id: record.id, version: created.version, terms_hash: created.terms_hash, idp_issuer: deps.idp!.issuer, sub_hash: sha256(claims.sub), auth_time: claims.auth_time, acr: claims.acr });
        return resolved;
      });
    } catch (error) { return fail(error instanceof DomainError ? error.code : 'CANDIDATE_CREATION_FAILED'); }
    return safeView(authorized, at);
  }

  api.post('/trades/:id/agent-runs', async httpRequest => {
    const trade = deps.tradeFor(httpRequest);
    const caller = deps.actor(httpRequest);
    if (!deps.model) throw new DomainError('MODEL_NOT_CONFIGURED', 'Configure a model provider before running an agent. Deterministic comparison remains available.', 503);
    const { agent, humanAccount } = resolveAgentAndHuman(caller, trade.id);
    const input = dispatchInput.parse(httpRequest.body);
    const key = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).parse(httpRequest.headers['idempotency-key']);
    const run = deps.store.beginAgentRun(agent, key, sha256(canonicalJson({ trade: trade.id, input })));
    if (!run.claimed) {
      if (run.state === 'COMPLETE') return run.result;
      throw new DomainError('AGENT_RUN_UNRESOLVED', 'This run failed or is still running. Refresh its audit/proposals before starting a new run; the same request will not run twice.', 409);
    }
    try {
      if (trade.revision !== input.expected_revision) throw new DomainError('STALE_REVISION', 'Refresh before asking an agent to review this version.', 409);
      const tools = new AgentTools(deps.store, agent, trade.id, deps.environment, humanAccount);
      const result = await runAgent(tools, deps.model);
      const proposal = result.trace.find(entry => entry.name === 'propose_correction');
      const parsedProposal = z.object({ authorization_id: z.string().min(1) }).safeParse(proposal?.result);
      if (parsedProposal.success) {
        const record = readAuthorization(agent.tenant, parsedProposal.data.authorization_id);
        if (record) await beginDeviceAuthorization(agent.tenant, record, deps.now());
      }
      deps.store.finishAgentRun(agent, key, 'COMPLETE', result);
      return result;
    } catch (error) {
      deps.store.finishAgentRun(agent, key, 'FAILED', { message: 'Inspect saved proposals and audit before retrying with a new run.' });
      throw error;
    }
  });

  api.get('/trades/:id/agent-authorizations', async httpRequest => {
    const trade = deps.tradeFor(httpRequest);
    const principal = deps.actor(httpRequest);
    const at = deps.now();
    const records = deps.store.agentAuthorizations<AgentAuthorizationRecord>(principal.tenant, trade.id) as StoredAuthorization[];
    return { idp_configured: Boolean(deps.idp), authorizations: records.map(record => safeView(record, at)) };
  });

  api.post('/trades/:id/agent-authorizations/:aid/poll', async httpRequest => {
    const trade = deps.tradeFor(httpRequest);
    const principal = deps.actor(httpRequest);
    const { aid } = authIdParams.parse(httpRequest.params);
    if (!deps.idp) throw new DomainError('INTEGRATION_NOT_READY', 'Connect World ID for Agents before authorizing a draft.', 503);
    const record = readAuthorization(principal.tenant, aid);
    if (!record || record.trade_id !== trade.id) throw new DomainError('NOT_FOUND', 'Authorization was not found in your scope.', 404);
    if (principal.kind !== 'human' || principal.id !== record.human_account) throw new DomainError('AGENT_AUTHORITY_DENIED', "Only the side's human can authorize or deny this draft.", 403);
    const at = deps.now();
    if (record.state !== 'PENDING_HUMAN') return safeView(record, at);
    if (!record.device_code) throw new DomainError('AGENT_AUTHORIZATION_NOT_STARTED', 'World ID authorization has not started for this draft yet.', 409);
    if (record.last_polled_at && at.getTime() - Date.parse(record.last_polled_at) < (record.interval ?? DEFAULT_INTERVAL) * 1000) return safeView(record, at);
    if (record.device_expires_at && at.getTime() >= Date.parse(record.device_expires_at)) {
      const expired: StoredAuthorization = { ...record, state: 'EXPIRED', decided_at: at.toISOString() };
      if (deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'EXPIRED', expired)) deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_EXPIRED', at, { authorization_id: aid });
      return safeView(expired, at);
    }
    const outcome = await pollDeviceToken(deps.idp, record.device_code, request);
    if (outcome.outcome === 'pending') {
      const updated = { ...record, last_polled_at: at.toISOString() };
      deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'PENDING_HUMAN', updated);
      return safeView(updated, at);
    }
    if (outcome.outcome === 'slow_down') {
      const updated = { ...record, last_polled_at: at.toISOString(), interval: Math.min((record.interval ?? DEFAULT_INTERVAL) + 5, 60) };
      deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'PENDING_HUMAN', updated);
      return safeView(updated, at);
    }
    if (outcome.outcome === 'denied') {
      const denied: StoredAuthorization = { ...record, state: 'DENIED', decided_at: at.toISOString() };
      if (deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'DENIED', denied)) deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_DENIED', at, { authorization_id: aid });
      return safeView(denied, at);
    }
    if (outcome.outcome === 'expired') {
      const expired: StoredAuthorization = { ...record, state: 'EXPIRED', decided_at: at.toISOString() };
      if (deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'EXPIRED', expired)) deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_EXPIRED', at, { authorization_id: aid });
      return safeView(expired, at);
    }
    if (outcome.outcome === 'failed') {
      const failed: StoredAuthorization = { ...record, state: 'FAILED', decided_at: at.toISOString(), failure_reason: 'IDP_TOKEN_REQUEST_FAILED' };
      if (deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'FAILED', failed)) deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_FAILED', at, { authorization_id: aid, reason: failed.failure_reason });
      return safeView(failed, at);
    }
    return finalize(principal, trade, record, outcome.id_token, at);
  });

  api.post('/trades/:id/agent-authorizations/:aid/cancel', async httpRequest => {
    const trade = deps.tradeFor(httpRequest);
    const principal = deps.actor(httpRequest);
    const { aid } = authIdParams.parse(httpRequest.params);
    const record = readAuthorization(principal.tenant, aid);
    if (!record || record.trade_id !== trade.id) throw new DomainError('NOT_FOUND', 'Authorization was not found in your scope.', 404);
    if (principal.kind !== 'human' || principal.id !== record.human_account) throw new DomainError('AGENT_AUTHORITY_DENIED', "Only the side's human can cancel this draft.", 403);
    const at = deps.now();
    if (record.state !== 'PENDING_HUMAN') return safeView(record, at);
    const cancelled: StoredAuthorization = { ...record, state: 'CANCELLED', decided_at: at.toISOString() };
    if (deps.store.transitionAgentAuthorization(principal.tenant, aid, 'PENDING_HUMAN', 'CANCELLED', cancelled)) deps.store.audit(principal, trade.id, 'AGENT_PROPOSAL_CANCELLED', at, { authorization_id: aid });
    return safeView(cancelled, at);
  });
}
