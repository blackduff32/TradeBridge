// Live check of World ID for Agents against the configured IdP, with no model involved. Run with
// `npm run agents:check`. It starts a device authorization, prints the link and code for a human
// to approve, polls at World's interval, then verifies the ID token with the same code the app
// uses before it writes a candidate. Secrets, device codes and tokens are never printed.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { agentIdpFromEnv, fetchJwks, pollDeviceToken, startDeviceAuthorization, verifyIdToken } from '../src/world-agents.js';

if (existsSync('.env')) loadEnvFile('.env');
const idp = agentIdpFromEnv(process.env);
if (!idp) throw new Error('Set WORLD_IDP_CLIENT_ID and WORLD_IDP_CLIENT_SECRET in .env first.');
const started = new Date();
const device = await startDeviceAuthorization(idp, fetch);
console.log(`Open ${device.verification_uri_complete ?? device.verification_uri}\nand approve code ${device.user_code}. It expires in ${Math.round(device.expires_in / 60)} minutes.`);
let interval = device.interval ?? 5;
const deadline = started.getTime() + device.expires_in * 1000;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, interval * 1000));
  const outcome = await pollDeviceToken(idp, device.device_code, fetch);
  if (outcome.outcome === 'pending') continue;
  if (outcome.outcome === 'slow_down') { interval += 5; continue; }
  if (outcome.outcome !== 'success') { console.log(`Result: ${outcome.outcome}. No token was issued.`); process.exit(1); }
  const claims = verifyIdToken(outcome.id_token, await fetchJwks(idp, fetch), idp, started, new Date());
  console.log('Verified ID token:', {
    iss: claims.iss, sub_sha256: createHash('sha256').update(claims.sub).digest('hex').slice(0, 16), acr: claims.acr,
    amr: (claims as { amr?: unknown }).amr ?? null, auth_time: new Date(claims.auth_time * 1000).toISOString(),
    seconds_to_success: Math.round((Date.now() - started.getTime()) / 1000),
  });
  process.exit(0);
}
console.log('Result: expired. No token was issued.');
process.exit(1);
