import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError, sha256, type Principal } from './domain.js';
import { Store } from './store.js';

export function browserSessions(app: FastifyInstance, principals: Principal[], store: Store, enableDemo: boolean, seed: (p: Principal) => void, ports = { api: 3100, web: 5173 }) {
  const allowed = new Set([ports.api, ports.web].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
  const sessions = new Map<string, { principal: Principal; expires: number; demo: boolean }>();
  const cookieToken = (request: FastifyRequest) => request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('tb_session='))?.slice(11) ?? '';
  app.addHook('onRequest', async request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.headers.origin) {
      if (!allowed.has(request.headers.origin)) throw new DomainError('ORIGIN_DENIED', 'This browser origin is not allowed.', 403);
    }
  });
  const getSession = (request: FastifyRequest) => {
    const session = sessions.get(sha256(cookieToken(request)));
    if (!session || session.expires <= Date.now()) return undefined;
    return session;
  };
  const publicSession = (session: NonNullable<ReturnType<typeof getSession>>) => ({
    principal: { id: session.principal.id, side: session.principal.side, kind: session.principal.kind, organisation: session.principal.organisation, tradeIds: session.principal.tradeIds },
    demo: session.demo, expires_at: new Date(session.expires).toISOString(),
  });
  function create(principal: Principal, demo: boolean) {
    for (const [key, session] of sessions) if (session.expires <= Date.now()) sessions.delete(key);
    if (sessions.size >= 100) throw new DomainError('SESSION_LIMIT', 'Too many active local sessions. Retry after existing sessions expire.', 429);
    const token = randomBytes(32).toString('hex');
    const session = { principal, demo, expires: Date.now() + 3600_000 };
    sessions.set(sha256(token), session);
    return { token, session };
  }
  const cookieHeader = (token: string) => `tb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`;
  app.get('/session', async request => {
    const session = getSession(request);
    return session ? publicSession(session) : { principal: null, demo_available: enableDemo };
  });
  app.post('/session', async (request, reply) => {
    const { token } = z.strictObject({ token: z.string().min(32).max(512) }).parse(request.body);
    const p = principals.find(p => timingSafeEqual(Buffer.from(sha256(p.token), 'hex'), Buffer.from(sha256(token), 'hex')));
    if (!p) throw new DomainError('UNAUTHENTICATED', 'The development access token was not recognized.', 401);
    const session = create(p, false);
    reply.header('set-cookie', cookieHeader(session.token));
    return publicSession(session.session);
  });
  app.post('/session/demo', async (_request, reply) => {
    if (!enableDemo) throw new DomainError('DEMO_DISABLED', 'Local demo sessions are disabled.', 404);
    const p: Principal = { id: 'demo-reviewer', tenant: `sandbox-${randomUUID()}`, organisation: 'Local sandbox', side: 'buyer', kind: 'agent', tradeIds: ['TB-001'], token: randomBytes(32).toString('hex') };
    const session = create(p, true);
    seed(p);
    reply.header('set-cookie', cookieHeader(session.token));
    return publicSession(session.session);
  });
  app.delete('/session', async (request, reply) => {
    const session = getSession(request);
    if (session?.demo) store.removeSandbox(session.principal.tenant);
    sessions.delete(sha256(cookieToken(request)));
    reply.header('set-cookie', 'tb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { signed_out: true };
  });
  return (request: FastifyRequest) => getSession(request)?.principal;
}
