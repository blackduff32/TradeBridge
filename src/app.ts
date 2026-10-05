import { timingSafeEqual, randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canonicalJson, compare, createCandidate, demoEnvironment, DomainError, economicsSchema, parseCsv, sha256, tradeIdSchema, validateEnvironment, type Environment, type Principal, type Trade } from './domain.js';
import { Store } from './store.js';
import { browserSessions } from './browser-session.js';
import { seedSandbox } from './seed.js';
import { WorldIdService, worldTrustMode, type HumanTrustBoundary, type WorldConfig } from './world-id.js';
import { ConsentService, type StaffAuthority } from './consent.js';
import type { ModelDriver } from './agents.js';
import { registerAgentRoutes, type AgentIdpConfig } from './world-agents.js';
import { ChainFlow } from './chain-flow.js';
import type { SuiLive } from './sui-live.js';

const importSchema = z.strictObject({ csv: z.string().min(1).max(500_000), expected_revisions: z.record(tradeIdSchema, z.number().int().nonnegative()) });
const proposalSchema = z.strictObject({ expected_revision: z.number().int().nonnegative(), terms: economicsSchema, reason: z.string().min(10).max(2000) });
const paths = z.object({ id: tradeIdSchema });
export function createApp(options: { store: Store; principals: Principal[]; environment?: Environment; now?: () => Date; browser?: boolean; demo?: boolean; world?: WorldConfig; worldFetch?: typeof fetch; staffAuthority?: StaffAuthority; humanTrust?: HumanTrustBoundary; demoTrust?: boolean; model?: ModelDriver; idp?: AgentIdpConfig; sui?: SuiLive; ports?: { api: number; web: number } }) {
  const app = Fastify({ bodyLimit: 600_000, logger: false, rewriteUrl: request => request.url?.startsWith('/api/') ? request.url.slice(4) : request.url ?? '/' });
  const environment = options.environment ?? options.sui?.environment() ?? demoEnvironment;
  const parties = options.sui ? { buyer: options.sui.address('buyer'), broker: options.sui.address('broker') } : undefined;
  const now = options.now ?? (() => new Date());
  const world = options.world ? new WorldIdService(options.store, options.world, options.humanTrust, options.worldFetch ?? fetch, now) : undefined;
  const approvalsReady = Boolean(world && options.humanTrust && options.staffAuthority);
  const worldStatus = !world ? 'not_configured' : !approvalsReady ? 'configured_trust_boundary_pending' : options.demoTrust ? 'configured_demo_trust_boundary' : 'configured';
  const consent = new ConsentService(options.store, options.staffAuthority, now);
  const chain = options.sui ? new ChainFlow(options.store, options.sui, consent, now) : undefined;
  const principals = new WeakMap<FastifyRequest, Principal>();
  let browserPrincipal: ((request: FastifyRequest) => Principal | undefined) | undefined;
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'VALIDATION_FAILED', issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
    if (error instanceof DomainError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) return reply.code(statusCode).send({ error: 'INVALID_REQUEST', message: 'Check the request format and size.' });
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'The request failed. No partial write was committed.' });
  });
  app.get('/health', async () => ({ status: 'ok', stage: 'trade-workspace', integrations: { world_id: worldStatus, sui: chain ? 'testnet' : 'not_connected' } }));
  if (options.browser) browserPrincipal = browserSessions(app, options.principals, options.store, options.demo ?? false, p => seedSandbox(options.store, p, now(), environment, parties), options.ports);
  app.register(async api => {
    api.addHook('onRequest', async request => {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const digest = Buffer.from(sha256(token), 'hex');
      const principal = options.principals.find(p => timingSafeEqual(Buffer.from(sha256(p.token), 'hex'), digest)) ?? browserPrincipal?.(request);
      if (!principal) throw new DomainError('UNAUTHENTICATED', 'A configured bearer token is required.', 401);
      principals.set(request, principal);
    });
    const actor = (request: FastifyRequest) => principals.get(request)!;
    api.get('/integrations', async () => ({ world_id: { configured: Boolean(world), approvals_ready: approvalsReady, trust: approvalsReady && options.demoTrust ? 'demo_static_roster' : null, trust_mode: options.world ? worldTrustMode(options.world) : null, reason: !world ? 'Connect a World ID app and relying party.' : !approvalsReady ? 'Fresh-presence integrity and staff enrollment require a trusted server adapter.' : options.demoTrust ? 'Demo trust boundary: a static roster of one buyer and one broker approver, a staging World ID app, and presence as IDKit reports it. Not production authentication.' : 'World ID approvals are enabled. Each account binds to one verified person per version; staff checks use the development directory.', environment: options.world?.environment ?? null }, sui: { deployed: Boolean(chain), network: chain ? 'testnet' : environment.chain_id, package_id: chain ? environment.package_id : null }, agents: { configured: Boolean(options.model), world_id_for_agents: Boolean(options.idp) }, identity: { mode: 'development_tokens', production_ready: false } }));
    api.get('/trades', async request => {
      const p = actor(request);
      return { trades: options.store.list(p.tenant, p.tradeIds).map(trade => ({ id: trade.id, revision: trade.revision, status: compare(trade).status, candidate_version: trade.candidates.at(-1)?.version ?? null })) };
    });
    function assertScope(p: Principal, id: string) {
      if (!p.tradeIds.includes(id)) throw new DomainError('NOT_FOUND', 'Trade was not found in your scope.', 404);
    }
    function tradeFor(request: FastifyRequest) {
      const { id } = paths.parse(request.params);
      const p = actor(request);
      assertScope(p, id);
      const trade = options.store.get(p.tenant, id);
      if (!trade) throw new DomainError('NOT_FOUND', 'Trade was not found in your scope.', 404);
      return trade;
    }
    function write<T>(request: FastifyRequest, operation: () => T): T {
      const key = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).parse(request.headers['idempotency-key']);
      return options.store.write(actor(request), key, sha256(canonicalJson({ path: request.url, body: request.body })), operation);
    }
    api.post('/imports', async request => {
      const input = importSchema.parse(request.body);
      const p = actor(request);
      return write(request, () => {
        const records = parseCsv(input.csv);
        if (Object.keys(input.expected_revisions).length !== records.length || records.some(r => input.expected_revisions[r.record.trade_id] === undefined)) {
          throw new DomainError('EXPECTED_REVISION_REQUIRED', 'Supply the expected revision for every imported trade (0 for a new trade).');
        }
        const at = now();
        options.store.saveSourceFile(p.tenant, sha256(input.csv), input.csv);
        const imported = records.map(({ record, ...evidence }) => {
          assertScope(p, record.trade_id);
          validateEnvironment(record, environment, at);
          const trade: Trade = options.store.get(p.tenant, record.trade_id) ?? { id: record.trade_id, tenant: p.tenant, revision: 0, sources: {}, candidates: [], canonical: null };
          if (trade.revision !== input.expected_revisions[trade.id]) throw new DomainError('STALE_REVISION', 'Reload the trade before writing.', 409);
          if (trade.sources[p.side]) throw new DomainError('SOURCE_EXISTS', 'Original source records cannot be overwritten; propose a new version.', 409);
          trade.sources[p.side] = { ...evidence, record, id: randomUUID(), side: p.side, file_hash: sha256(input.csv), imported_at: at.toISOString(), actor: p.id, organisation: p.organisation };
          trade.revision += 1;
          options.store.save(trade);
          options.store.audit(p, trade.id, 'SOURCE_IMPORTED', at, { source_id: trade.sources[p.side]!.id, side: p.side, file_hash: sha256(input.csv) });
          return { trade_id: trade.id, revision: trade.revision, comparison: compare(trade) };
        });
        return { imported };
      });
    });
    api.get('/trades/:id', async request => tradeFor(request));
    // Agents draft; only the side's human, authorized through World ID for Agents, turns a draft into a candidate.
    registerAgentRoutes(api, { store: options.store, principals: options.principals, environment, now, model: options.model, idp: options.idp, actor, tradeFor });
    api.get('/trades/:id/reconciliation', async request => {
      const trade = tradeFor(request);
      const candidate = trade.candidates.at(-1);
      const consents = candidate ? options.store.consents(trade.tenant, trade.id, candidate.version) : [];
      const instruction = candidate ? options.store.instruction(trade.tenant, trade.id, candidate.version) : undefined;
      const status = (side: 'buyer' | 'broker') => {
        const decision = consents.find(c => c.side === side);
        return !decision ? 'AWAITING_WORLD_ID' : decision.decision === 'reject' ? 'REJECTED' : Date.parse(decision.expires_at) <= now().getTime() ? 'EXPIRED' : decision.consumed ? 'CONSUMED' : 'HUMAN_APPROVED';
      };
      return { ...compare(trade), revision: trade.revision, canonical: trade.canonical, candidate: candidate ?? null, chain_evidence: instruction?.state === 'CONFIRMED' ? { digest: instruction.digest, agreement_id: instruction.agreement_id } : null, commitment_status: instruction?.state ?? null, approvals: { buyer: status('buyer'), broker: status('broker') }, limitations: [...(world ? [] : ['WORLD_ID_NOT_CONFIGURED']), approvalsReady ? (options.demoTrust ? 'DEMO_TRUST_BOUNDARY' : null) : 'TRUST_ADAPTER_NOT_CONNECTED', chain ? null : 'SUI_NOT_CONNECTED', 'BOOK_POSTINGS_NOT_IMPLEMENTED'].filter(Boolean) };
    });
    api.post('/trades/:id/compare', async request => compare(tradeFor(request)));
    api.get('/trades/:id/chain', async request => {
      if (!chain) throw new DomainError('SUI_NOT_CONNECTED', 'No Sui deployment is configured.', 503);
      return chain.state(tradeFor(request));
    });
    api.get('/trades/:id/audit', async request => {
      const trade = tradeFor(request);
      return { events: options.store.history(trade.tenant, trade.id) };
    });
    api.post('/trades/:id/proposals', async request => {
      const input = proposalSchema.parse(request.body);
      return write(request, () => {
        const trade = tradeFor(request);
        if (trade.revision !== input.expected_revision) throw new DomainError('STALE_REVISION', 'Reload the trade before proposing a new version.', 409);
        if (trade.canonical) throw new DomainError('CORRECTION_ALREADY_STAGED', 'Resolve the existing commitment before creating a linked amendment.', 409);
        const at = now();
        const candidate = createCandidate(trade, input.terms, input.reason, environment, at);
        trade.candidates.push(candidate);
        trade.revision += 1;
        options.store.save(trade);
        options.store.audit(actor(request), trade.id, 'CANDIDATE_PROPOSED', at, { version: candidate.version, terms_hash: candidate.terms_hash });
        return { candidate, revision: trade.revision, status: 'HUMAN_VERIFICATION_REQUIRED', canonical_changed: false };
      });
    });
    for (const path of ['verification-challenges', 'world-id-verifications', 'approvals', 'agreement-commitments', 'funding-intents', 'settlement-instructions']) {
      api.post(`/trades/:id/${path}`, async request => {
        const trade = tradeFor(request);
        if (actor(request).kind === 'agent') throw new DomainError('AGENT_AUTHORITY_DENIED', 'Agents cannot verify humans, approve trades, commit agreements, fund, or settle.', 403);
        if (path === 'approvals') {
          // Authority is dependency-injected by a server integration, never enabled by a browser flag.
          if (!options.staffAuthority) throw new DomainError('INTEGRATION_NOT_READY', 'Verified organizational authority is required before consent can be accepted.', 503);
          const key = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).parse(request.headers['idempotency-key']);
          const recorded = await consent.record(actor(request), trade.id, request.body, key);
          // Once both sides approve the same version, the deterministic correction service stages it.
          const decisions = options.store.consents(trade.tenant, trade.id, recorded.version);
          if (recorded.decision !== 'approve' || decisions.length !== 2 || decisions.some(c => c.decision !== 'approve')) return { ...recorded, correction: null };
          try {
            const instruction = await consent.stage(trade.tenant, trade.id, options.store.get(trade.tenant, trade.id)!.revision);
            return { ...recorded, correction: { staged: true, instruction_id: instruction.id, version: instruction.version, state: instruction.state } };
          } catch (error) {
            // The decision above is already durable; report why staging did not follow it.
            if (error instanceof DomainError) return { ...recorded, correction: { staged: false, error: error.code, message: error.message } };
            throw error;
          }
        }
        if (chain && path === 'agreement-commitments') return chain.commit(actor(request), trade);
        if (chain && path === 'funding-intents') return chain.fund(actor(request), trade);
        if (chain && path === 'settlement-instructions') return chain.settle(actor(request), trade, z.strictObject({ onchain_probe: z.boolean().optional() }).parse(request.body ?? {}).onchain_probe ?? false);
        if (world && path === 'verification-challenges') {
          return write(request, () => {
            const input = z.strictObject({ expected_revision: z.number().int(), terms_hash: z.string() }).parse(request.body);
            const candidate = trade.candidates.at(-1);
            if (!candidate || trade.revision !== input.expected_revision || candidate.terms_hash !== input.terms_hash) throw new DomainError('STALE_REVISION', 'Refresh the proposal before verification.', 409);
            return world.publicRequest(world.begin(actor(request), candidate));
          });
        }
        if (world && path === 'world-id-verifications') {
          const input = z.strictObject({ challenge_id: z.uuid(), proof: z.unknown() }).parse(request.body);
          await world.verify(actor(request), input.challenge_id, input.proof, () => options.store.get(trade.tenant, trade.id)?.candidates.at(-1));
          return { status: 'WORLD_ID_VERIFIED', approval: 'NOT_GIVEN' };
        }
        throw new DomainError('INTEGRATION_NOT_READY', 'Verified organisational identity, fresh presence and a deployed Sui adapter are required. This operation remains blocked.', 503);
      });
    }
  });
  return app;
}
