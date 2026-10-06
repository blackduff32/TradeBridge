import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { sha256, type Principal } from './domain.js';
import { Store, type DemoSnapshot } from './store.js';
import { seedSandbox } from './seed.js';

export interface HostedState { principal: Principal; expires: number; snapshot: DemoSnapshot }
export interface HostedStorage {
  read(key: string): Promise<{ state: HostedState; etag: string } | null>;
  write(key: string, state: HostedState, etag?: string): Promise<void>;
  remove(key: string, etag: string): Promise<void>;
}
export class SnapshotConflict extends Error {}
const lifetime = 3600_000;
const cookie = (token: string, age = 3600) => `tb_hosted=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const publicSession = (state: HostedState) => ({ hosted: true, demo: true, expires_at: new Date(state.expires).toISOString(), principal: { id: state.principal.id, kind: state.principal.kind, side: state.principal.side, organisation: state.principal.organisation, tradeIds: state.principal.tradeIds } });
const guest = { principal: null, demo_available: true, hosted: true };
export function hostedHandler(storage: HostedStorage, now = () => new Date()) {
  return async (request: Request): Promise<Response> => {
    const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', ...headers } });
    const fail = (error: string, message: string, status: number) => json({ error, message }, status);
    const url = new URL(request.url); const path = url.pathname.replace(/^\/api/, '');
    const mutation = !['GET', 'HEAD'].includes(request.method);
    if (mutation && request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('ORIGIN_DENIED', 'Use this demo from its own website.', 403);
    if (request.headers.get('sec-fetch-site') === 'cross-site' && mutation) return fail('ORIGIN_DENIED', 'Cross-site writes are not allowed.', 403);
    if (path === '/health' && request.method === 'GET') return json({ status: 'ok', mode: 'hosted_synthetic_demo', storage: 'private_vercel_blob', commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, integrations: { world_id: 'not_configured', sui: 'not_connected' } });
    if (path === '/session' && request.method === 'POST') return fail('HOSTED_DEMO_ONLY', 'Development credentials are only accepted by the local app.', 403);
    const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('tb_hosted='))?.slice(10);
    const key = token && /^[a-f0-9]{64}$/.test(token) ? `sessions/${sha256(token)}.json` : null;
    let store: Store | undefined;
    try {
      if (path === '/session/demo' && request.method === 'POST') {
        // Double clicks keep the same workspace when a valid session exists.
        const existing = key ? await storage.read(key) : null;
        if (existing && existing.state.expires > now().getTime()) return json(publicSession(existing.state));
        const freshToken = randomBytes(32).toString('hex');
        const principal: Principal = { id: 'demo-reviewer', tenant: `sandbox-${randomUUID()}`, organisation: 'Hosted synthetic demo', side: 'buyer', kind: 'agent', tradeIds: ['TB-001'], token: randomBytes(32).toString('hex') };
        store = new Store(); seedSandbox(store, principal, now());
        const state = { principal, expires: now().getTime() + lifetime, snapshot: store.demoSnapshot() };
        await storage.write(`sessions/${sha256(freshToken)}.json`, state);
        return json(publicSession(state), 200, { 'Set-Cookie': cookie(freshToken) });
      }
      const saved = key ? await storage.read(key) : null;
      if (!saved || saved.state.expires <= now().getTime()) {
        if (saved && key) await storage.remove(key, saved.etag);
        if (path === '/session' && request.method === 'GET') return json(guest);
        if (path === '/session' && request.method === 'DELETE') return json({ signed_out: true }, 200, { 'Set-Cookie': cookie('', 0) });
        return fail('UNAUTHENTICATED', 'Your demo session ended. Start a new sample workspace.', 401);
      }
      if (path === '/session' && request.method === 'GET') return json(publicSession(saved.state));
      if (path === '/session' && request.method === 'DELETE') {
        await storage.remove(key!, saved.etag);
        return json({ signed_out: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (path === '/imports') return fail('HOSTED_DEMO_ONLY', 'The public demo only accepts its built-in synthetic records. Use the local app for CSV imports.', 403);
      const text = mutation ? await request.text() : undefined;
      if (text && Buffer.byteLength(text) > 12_000) return fail('PAYLOAD_TOO_LARGE', 'Keep demo requests under 12 KB.', 413);
      store = new Store(); store.restoreDemo(saved.state.snapshot);
      if (path.endsWith('/proposals') && request.method === 'POST' && (store.get(saved.state.principal.tenant, 'TB-001')?.candidates.length ?? 0) >= 20) return fail('DEMO_LIMIT', 'This sample has reached 20 proposals. Leave the demo and start a new workspace.', 429);
      const app = createApp({ store, principals: [saved.state.principal], now });
      try {
        const result = await app.inject({ method: request.method as 'GET' | 'POST', url: path + url.search, headers: { authorization: `Bearer ${saved.state.principal.token}`, ...(text ? { 'content-type': 'application/json' } : {}), ...(request.headers.has('idempotency-key') ? { 'idempotency-key': request.headers.get('idempotency-key')! } : {}) }, ...(text ? { payload: text } : {}) });
        if (mutation && result.statusCode >= 200 && result.statusCode < 300) await storage.write(key!, { ...saved.state, snapshot: store.demoSnapshot() }, saved.etag);
        return new Response(result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' } });
      } finally { await app.close(); }
    } catch (error) {
      if (error instanceof SnapshotConflict) return fail('STALE_REVISION', 'Another request changed this demo. Refresh before trying again.', 409);
      return fail('STORAGE_UNAVAILABLE', 'The demo could not confirm this request. Refresh to check its outcome before retrying.', 503);
    } finally { store?.close(); }
  };
}
