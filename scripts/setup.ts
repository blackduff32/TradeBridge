import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { exampleCsv, examplePrincipals } from './fixtures.js';

if (existsSync('.env')) throw new Error('.env already exists; existing credentials were left untouched.');
const now = new Date();
writeFileSync('.env', `TRADEBRIDGE_PRINCIPALS='${JSON.stringify(examplePrincipals())}'\nPORT=3100\nTRADEBRIDGE_DB=data/tradebridge.db\n`, { mode: 0o600, flag: 'wx' });
mkdirSync('data', { recursive: true, mode: 0o700 });
for (const side of ['buyer', 'broker'] as const) writeFileSync(`data/${side}.csv`, exampleCsv(side, now), { mode: 0o600 });
console.log('Created private .env credentials and synthetic CSVs in data/. Start with npm run dev. Credentials are development-only and permit TB-001 only.');
