// Starts a rehearsal from clean books: deletes the local database so the next `npm run dev`
// re-seeds TB-001 with the live testnet parties. The audit log is append-only by design,
// so a reset replaces the whole local database rather than rewriting history.
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');
const port = Number(process.env.PORT ?? 3100);
const listening = await new Promise<boolean>(done => {
  const socket = createConnection({ host: '127.0.0.1', port }, () => { socket.destroy(); done(true); });
  socket.on('error', () => done(false));
});
if (listening) {
  console.error(`The API is still running on port ${port}. Stop npm run dev first, then reset.`);
  process.exit(1);
}
const db = resolve(process.env.TRADEBRIDGE_DB ?? 'data/tradebridge.db');
for (const file of [db, `${db}-wal`, `${db}-shm`]) rmSync(file, { force: true });
console.log(`Removed ${db}. Start npm run dev to seed fresh TB-001 books.`);
