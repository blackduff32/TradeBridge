import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedHandler, SnapshotConflict, type HostedStorage, type HostedState } from '../src/hosted.js';
import { exampleTerms } from '../scripts/fixtures.js';
import type { Trade } from '../src/domain.js';

class MemoryBlobs implements HostedStorage {
  rows = new Map<string, { state: HostedState; etag: string }>(); sequence = 0; conflict = false; unavailable = false;
  async read(key: string) { if (this.unavailable) throw new Error('offline'); return structuredClone(this.rows.get(key) ?? null); }
  async write(key: string, state: HostedState, etag?: string) {
    if (this.unavailable) throw new Error('offline');
    if (this.conflict || (etag && this.rows.get(key)?.etag !== etag) || (!etag && this.rows.has(key))) throw new SnapshotConflict();
    this.rows.set(key, { state: structuredClone(state), etag: String(++this.sequence) });
  }
  async remove(key: string, etag: string) { if (this.rows.get(key)?.etag !== etag) throw new SnapshotConflict(); this.rows.delete(key); }
}
const origin = 'https://tradebridge.vercel.app';
function request(path: string, method = 'GET', cookie = '', body?: unknown, key = 'hosted-proposal-1') {
  return new Request(origin + '/api' + path, { method, headers: { origin, cookie, 'content-type': 'application/json', 'idempotency-key': key }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function start(storage: MemoryBlobs) {
  const response = await hostedHandler(storage)(request('/session/demo', 'POST'));
  assert.equal(response.status, 200); const header = response.headers.get('set-cookie')!;
  assert.match(header, /Secure; HttpOnly; SameSite=Strict/);
  return header.split(';')[0]!;
}
const terms = exampleTerms('buyer');
const proposal = { expected_revision: 2, terms, reason: 'Align with the original buyer order.' };

test('hosted proposal and audit survive fresh handlers with immutable evidence and replay protection', async () => {
  const storage = new MemoryBlobs(); const cookie = await start(storage);
  const send = (req: Request) => hostedHandler(storage)(req); // simulate independent cold requests
  const first = await send(request('/trades/TB-001/proposals', 'POST', cookie, proposal));
  assert.equal(first.status, 200, await first.clone().text());
  const replay = await send(request('/trades/TB-001/proposals', 'POST', cookie, proposal));
  assert.deepEqual(await replay.json(), await first.json());
  const trade = await (await send(request('/trades/TB-001', 'GET', cookie))).json() as Trade;
  assert.equal(trade.candidates.length, 1); assert.equal(trade.sources.broker?.record.quantity, '1100'); assert.equal(trade.canonical, null);
  const audit = await (await send(request('/trades/TB-001/audit', 'GET', cookie))).json();
  assert.equal(audit.events.length, 3);
  assert.equal((await send(request('/trades/TB-001/proposals', 'POST', cookie, proposal, 'different-request'))).status, 409);
});
test('hosted workspaces are isolated and real imports, credentials and settlement are blocked', async () => {
  const storage = new MemoryBlobs(); const a = await start(storage); const b = await start(storage); const send = hostedHandler(storage);
  assert.equal((await send(request('/trades/TB-001/proposals', 'POST', a, proposal))).status, 200);
  assert.equal((await (await send(request('/trades/TB-001', 'GET', b))).json()).candidates.length, 0);
  assert.equal((await send(request('/session', 'POST', '', { token: 'x'.repeat(40) }))).status, 403);
  assert.equal((await send(request('/imports', 'POST', a, { csv: 'private data' }))).status, 403);
  assert.equal((await send(request('/trades/TB-001/settlement-instructions', 'POST', a, {}))).status, 403);
  assert.equal((await send(request('/trades/TB-001', 'GET', 'tb_hosted=forged'))).status, 401);
  const cross = request('/session/demo', 'POST'); cross.headers.set('origin', 'https://attacker.invalid');
  assert.equal((await send(cross)).status, 403);
});
test('storage write conflicts and outages never report successful saves', async () => {
  const storage = new MemoryBlobs(); const cookie = await start(storage); storage.conflict = true;
  assert.equal((await hostedHandler(storage)(request('/trades/TB-001/proposals', 'POST', cookie, proposal))).status, 409);
  storage.conflict = false;
  assert.equal((await (await hostedHandler(storage)(request('/trades/TB-001', 'GET', cookie))).json()).candidates.length, 0);
  storage.unavailable = true;
  assert.equal((await hostedHandler(storage)(request('/session', 'GET', cookie))).status, 503);
});
test('logout removes demo state and expired sessions cannot authorize requests', async () => {
  const storage = new MemoryBlobs(); const cookie = await start(storage);
  assert.equal((await hostedHandler(storage)(request('/session', 'DELETE', cookie))).status, 200);
  assert.equal(storage.rows.size, 0);
  assert.equal((await hostedHandler(storage)(request('/trades/TB-001', 'GET', cookie))).status, 401);
  const expired = await start(storage);
  const response = await hostedHandler(storage, () => new Date(Date.now() + 3601_000))(request('/trades/TB-001', 'GET', expired));
  assert.equal(response.status, 401); assert.equal(storage.rows.size, 0);
});
