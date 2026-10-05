import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createApp } from './app.js';
import { readPrincipals } from './config.js';
import { Store } from './store.js';
import fastifyStatic from '@fastify/static';
import { worldConfigFromEnv } from './world-id.js';
import { agentIdpFromEnv } from './world-agents.js';
import { WorldHumanTrust } from './human-trust.js';
import { DevelopmentStaffDirectory } from './staff-directory.js';
import { OpenAIResponsesDriver, reasoningEffortSchema } from './agents.js';
import { suiLiveFromEnv } from './sui-live.js';
import { seedSandbox } from './seed.js';
import { demoTrust } from './demo-trust.js';

if (existsSync('.env')) loadEnvFile('.env');
const principals = readPrincipals(process.env.TRADEBRIDGE_PRINCIPALS);
const port = Number(process.env.PORT ?? 3100);
// TRADEBRIDGE_WEB_PORT lets a second checkout run its Vite server beside the default one.
const webPort = Number(process.env.TRADEBRIDGE_WEB_PORT ?? 5173);
for (const value of [port, webPort]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('PORT and TRADEBRIDGE_WEB_PORT must be valid TCP ports.');
const path = resolve(process.env.TRADEBRIDGE_DB ?? 'data/tradebridge.db');
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
process.umask(0o077);
const store = new Store(path);
const world = worldConfigFromEnv(process.env);
// Opt-in and staging-only demo roster. Otherwise WorldHumanTrust binds each verified person, and the
// development directory answers "is this still a configured human account?" and nothing more.
const roster = process.env.TRADEBRIDGE_DEMO_APPROVERS ? demoTrust(principals, process.env.TRADEBRIDGE_DEMO_APPROVERS, world) : undefined;
const humanTrust = roster?.humanTrust ?? (world ? new WorldHumanTrust(store, world) : undefined);
const staffAuthority = roster?.staffAuthority ?? new DevelopmentStaffDirectory(principals);
const model = process.env.OPENAI_API_KEY && process.env.TRADEBRIDGE_MODEL ? new OpenAIResponsesDriver(process.env.OPENAI_API_KEY, process.env.TRADEBRIDGE_MODEL, fetch, reasoningEffortSchema.parse(process.env.TRADEBRIDGE_REASONING_EFFORT ?? 'low')) : undefined;
const sui = suiLiveFromEnv();
if (sui) {
  await sui.assertChain();
  // Live workspaces start from books that name the real testnet parties; `npm run live:reset` re-seeds them.
  const parties = { buyer: sui.address('buyer'), broker: sui.address('broker') };
  for (const principal of principals.filter(p => p.kind === 'agent' && p.side === 'buyer' && p.tradeIds.includes('TB-001'))) {
    if (!store.get(principal.tenant, 'TB-001')) seedSandbox(store, principal, new Date(), sui.environment(), parties);
  }
}
const app = createApp({ store, principals, browser: true, demo: process.env.TRADEBRIDGE_DEMO !== 'false', world, model, idp: agentIdpFromEnv(process.env), sui, humanTrust, staffAuthority, demoTrust: Boolean(roster), ports: { api: port, web: webPort } });
if (existsSync('web-dist')) await app.register(fastifyStatic, { root: resolve('web-dist'), wildcard: false });
app.addHook('onClose', async () => { store.close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: '127.0.0.1', port });
const worldLabel = !world ? 'World ID not configured' : roster ? `DEMO trust boundary: World ID ${world.environment} approvals for ${roster.approvers.map(a => `${a.id} (${a.side})`).join(' and ')}` : `World ID ${world.environment}`;
console.log(`TradeBridge API: http://127.0.0.1:${port} (local prototype; ${worldLabel}; Sui ${sui ? `testnet package ${sui.config.package_id}` : 'not connected'})`);
