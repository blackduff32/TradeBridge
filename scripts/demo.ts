import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { exampleCsv, examplePrincipals, exampleTerms } from './fixtures.js';

const now = new Date();
const store = new Store();
const principals = examplePrincipals();
const app = createApp({ store, principals, now: () => now });
const headers = (id: string, key: string) => ({ authorization: `Bearer ${principals.find(p => p.id === id)!.token}`, 'idempotency-key': key });
try {
  console.log('TradeBridge local API demo | synthetic assets | no World ID or chain simulation');
  for (const [side, revision] of [['buyer', 0], ['broker', 1]] as const) {
    const response = await app.inject({ method: 'POST', url: '/imports', headers: headers(`${side}-agent`, `import-${side}`), payload: { csv: exampleCsv(side, now), expected_revisions: { 'TB-001': revision } } });
    assert.equal(response.statusCode, 200, response.body);
  }
  const comparison = await app.inject({ method: 'POST', url: '/trades/TB-001/compare', headers: headers('buyer-agent', 'compare-001') });
  const mismatch = comparison.json().differences.find((d: { field: string }) => d.field === 'quantity');
  assert.equal(mismatch.delta, '100');
  console.log(`1. Imported both books: buyer ${mismatch.buyer}, broker ${mismatch.broker}. Delta: ${mismatch.delta} DEMOBOND.`);
  const proposed = await app.inject({ method: 'POST', url: '/trades/TB-001/proposals', headers: headers('broker-agent', 'proposal-v2'), payload: { expected_revision: 2, terms: exampleTerms('buyer', now), reason: 'Align the broker confirmation with the original buyer order.' } });
  assert.equal(proposed.statusCode, 200, proposed.body);
  const candidate = proposed.json().candidate;
  console.log(`2. Proposed v${candidate.version}: 1,000 DEMOBOND at 10.00 DEMOUSD; net 10,000.00 DEMOUSD.`);
  console.log(`   SHA-256: ${candidate.terms_hash}`);
  const blocked = await app.inject({ method: 'POST', url: '/trades/TB-001/settlement-instructions', headers: headers('broker-agent', 'settle-v2'), payload: {} });
  assert.equal(blocked.statusCode, 403);
  console.log(`3. Agent settlement refused: ${blocked.json().error}.`);
  const human = await app.inject({ method: 'POST', url: '/trades/TB-001/approvals', headers: headers('buyer-human', 'approve-v2'), payload: { face_verified: true } });
  assert.equal(human.statusCode, 503);
  console.log(`4. Browser-supplied face flag refused: ${human.json().error}.`);
  const trade = store.get('demo-workspace', 'TB-001')!;
  assert.equal(trade.canonical, null);
  assert.equal(trade.sources.broker?.record.quantity, '1100');
  console.log('5. Original source records preserved. Canonical correction, funding, and settlement remain blocked.');
} finally { await app.close(); store.close(); }
