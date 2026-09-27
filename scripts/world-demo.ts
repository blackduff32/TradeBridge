// Drives the local World ID approval path without a browser, against a running `npm run dev`
// configured with a staging World ID app and TRADEBRIDGE_DEMO_APPROVERS (docs/INTEGRATIONS.md).
//
//   npm run world:demo -- prepare                     import both synthetic records and propose v2
//   npm run world:demo -- approve <buyer|broker> [reject] [--manual]
//   npm run world:demo -- status
//
// `approve` asks the TradeBridge server for a signed challenge, opens the IDKit request that the
// browser widget would, and has World's simulator complete it through its MCP endpoint with a real
// staging Proof of Human. The TradeBridge server then verifies the proof with World itself. The MCP
// always proves as one default simulator identity, so approving both sides this way demonstrates the
// same-person refusal. --manual prints the connector URL instead: paste it into
// https://simulator.worldcoin.org and choose another identity to act as a second person.
// Tokens come from .env and are never printed.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readPrincipals } from '../src/config.js';
import type { Principal, Trade } from '../src/domain.js';
import { exampleCsv, exampleTerms } from './fixtures.js';

if (existsSync('.env')) loadEnvFile('.env');
const base = `http://127.0.0.1:${process.env.PORT ?? 3100}/api`;
const principals = readPrincipals(process.env.TRADEBRIDGE_PRINCIPALS);
const log = '.tools/world-demo.log';

// IDKit loads its WASM with fetch(), which Node cannot do for file: URLs; serve those from disk.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof URL ? input : typeof input === 'string' && input.startsWith('file:') ? new URL(input) : null;
  if (url?.protocol === 'file:') return new Response(readFileSync(fileURLToPath(url)), { headers: { 'Content-Type': 'application/wasm' } });
  return nativeFetch(input, init);
}) as typeof fetch;

function principal(id: string): Principal {
  const found = principals.find(p => p.id === id);
  if (!found) throw new Error(`No ${id} principal in TRADEBRIDGE_PRINCIPALS. Run npm run setup first.`);
  return found;
}
async function call<T>(who: Principal, path: string, body?: unknown, key?: string): Promise<{ status: number; data: T }> {
  const response = await nativeFetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${who.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key ?? randomUUID() }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() as T };
}
function record(event: Record<string, unknown>) { appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); }

async function prepare() {
  const now = new Date();
  const buyer = principal('buyer-agent'); const broker = principal('broker-agent');
  const existing = await call<Trade>(buyer, '/trades/TB-001');
  if (existing.status === 200) throw new Error('TB-001 already exists in this database. Stop the server, move TRADEBRIDGE_DB aside, restart and prepare again.');
  for (const [who, side, revision] of [[buyer, 'buyer', 0], [broker, 'broker', 1]] as const) {
    const imported = await call(who, '/imports', { csv: exampleCsv(side, now), expected_revisions: { 'TB-001': revision } });
    if (imported.status !== 200) throw new Error(`${side} import failed: ${JSON.stringify(imported.data)}`);
  }
  const proposed = await call<{ candidate: { version: number; terms_hash: string } }>(broker, '/trades/TB-001/proposals', { expected_revision: 2, terms: exampleTerms('buyer', now), reason: 'Align the broker confirmation with the original buyer order.' });
  if (proposed.status !== 200) throw new Error(`Proposal failed: ${JSON.stringify(proposed.data)}`);
  console.log(`Imported buyer 1,000 and broker 1,100 DEMOBOND; proposed v${proposed.data.candidate.version} ${proposed.data.candidate.terms_hash}.`);
}

interface VerificationRequest { challenge_id: string; app_id: `app_${string}`; action: string; action_description: string; environment: 'staging' | 'production'; signal: string; rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string }; terms_hash: string; version: number }
async function simulatorProve(connectUrl: string) {
  // World's MCP answers JSON-RPC with a server-sent event. The URL carries the bridge key: never log it.
  const response = await nativeFetch('https://simulator.worldcoin.org/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'complete_test_request', arguments: { connect_url: connectUrl } } }), signal: AbortSignal.timeout(90_000) });
  const text = await response.text();
  const line = text.split('\n').find(l => l.startsWith('data: '));
  const message = JSON.parse(line ? line.slice(6) : text) as { error?: { message: string }; result?: { isError?: boolean; structuredContent?: Record<string, unknown> } };
  if (message.error || !message.result) throw new Error(`Simulator MCP error: ${message.error?.message ?? text.slice(0, 200)}`);
  if (message.result.isError) throw new Error(`The simulator did not complete the request: ${JSON.stringify(message.result.structuredContent)}`);
  return message.result.structuredContent;
}

async function approve(side: string, decision: string | undefined, manual: boolean) {
  if (side !== 'buyer' && side !== 'broker') throw new Error('Choose buyer or broker.');
  const human = principal(`${side}-human`);
  const trade = await call<Trade>(human, '/trades/TB-001');
  const latest = trade.data.candidates?.at(-1);
  if (trade.status !== 200 || !latest) throw new Error('No proposal to approve. Run: npm run world:demo -- prepare');
  const started = Date.now();
  const challenge = await call<VerificationRequest>(human, '/trades/TB-001/verification-challenges', { expected_revision: trade.data.revision, terms_hash: latest.terms_hash });
  if (challenge.status !== 200) throw new Error(`Challenge refused: ${JSON.stringify(challenge.data)}`);
  const request = challenge.data;
  const { IDKit, proofOfHuman } = await import('@worldcoin/idkit-core');
  const idkit = await IDKit.request({ app_id: request.app_id, action: request.action, action_description: request.action_description, rp_context: request.rp_context, allow_legacy_proofs: false, require_user_presence: true, environment: request.environment }).preset(proofOfHuman({ signal: request.signal }));
  const completion = idkit.pollUntilCompletion({ timeout: manual ? 600_000 : 120_000 });
  if (manual) console.log(`Paste this into https://simulator.worldcoin.org and pick an identity:\n${idkit.connectorURI}\nWaiting for the proof...`);
  else console.log(`Simulator MCP: ${JSON.stringify(await simulatorProve(idkit.connectorURI))}`);
  const done = await completion;
  if (!done.success) { record({ side, event: 'idkit_failed', error: done.error }); throw new Error(`IDKit did not complete: ${done.error}`); }
  const presence = (done.result as { user_presence_completed?: unknown }).user_presence_completed;
  console.log(`IDKit result: protocol ${(done.result as { protocol_version?: string }).protocol_version}, environment ${done.result.environment}, user_presence_completed ${String(presence)}`);
  const verified = await call<Record<string, unknown>>(human, '/trades/TB-001/world-id-verifications', { challenge_id: request.challenge_id, proof: done.result });
  record({ side, event: 'server_verification', http: verified.status, result: verified.data, action: request.action, environment: request.environment, seconds: Math.round((Date.now() - started) / 1000) });
  console.log(`TradeBridge verification: HTTP ${verified.status} ${JSON.stringify(verified.data)}`);
  if (verified.status !== 200 || decision === 'verify-only') return;
  const after = await call<Trade>(human, '/trades/TB-001');
  const choice = decision === 'reject' ? 'reject' : 'approve';
  const consent = await call<Record<string, unknown>>(human, '/trades/TB-001/approvals', { expected_revision: after.data.revision, challenge_id: request.challenge_id, version: request.version, terms_hash: request.terms_hash, decision: choice });
  record({ side, event: 'decision', decision: choice, http: consent.status, result: consent.data });
  console.log(`Decision (${choice}): HTTP ${consent.status} ${JSON.stringify(consent.data)}`);
}

async function status() {
  const { data } = await call<{ approvals: Record<string, string>; canonical: { version: number } | null; commitment_status: string | null; limitations: string[] }>(principal('buyer-human'), '/trades/TB-001/reconciliation');
  console.log(JSON.stringify({ approvals: data.approvals, canonical_version: data.canonical?.version ?? null, commitment_status: data.commitment_status, limitations: data.limitations }, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'prepare') await prepare();
else if (command === 'approve') await approve(rest[0] ?? '', rest.find(a => ['approve', 'reject', 'verify-only'].includes(a)), rest.includes('--manual'));
else if (command === 'status') await status();
else { console.error('Usage: npm run world:demo -- <prepare | approve <buyer|broker> [reject|verify-only] [--manual] | status>'); process.exit(1); }
process.exit(0);
