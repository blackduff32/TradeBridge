import { randomUUID } from 'node:crypto';
import { demoEnvironment, parseCsv, sha256, type Environment, type Principal, type Trade } from './domain.js';
import { Store } from './store.js';

export interface Parties { buyer: string; broker: string }
const placeholderParties: Parties = { buyer: '0x' + '1'.repeat(64), broker: '0x' + '2'.repeat(64) };

/** Synthetic TB-001 books. With a deployed package, both books name the real testnet party addresses and asset types. */
export function seedSandbox(store: Store, principal: Principal, now: Date, environment: Environment = demoEnvironment, parties: Parties = placeholderParties) {
  const common = {
    trade_id: 'TB-001', instrument_id: 'SIMULATED-BOND-001', fill_id: 'FILL-001',
    buyer_address: parties.buyer, broker_address: parties.broker,
    buyer_recipient: parties.buyer, broker_recipient: parties.broker,
    bond_type: environment.bond_type, cash_type: environment.cash_type,
    quantity: '1000', unit_price_base: '1000', accrued_interest_base: '0', fees_base: '0', net_cash_base: '1000000',
    settlement_date: now.toISOString().slice(0, 10), expires_at: new Date(now.getTime() + 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  store.write(principal, 'seed-sandbox', 'seed-v1', () => {
    const trade: Trade = { id: 'TB-001', tenant: principal.tenant, revision: 2, sources: {}, candidates: [], canonical: null };
    for (const side of ['buyer', 'broker'] as const) {
      const row = { ...common, quantity: side === 'buyer' ? '1000' : '1100', net_cash_base: side === 'buyer' ? '1000000' : '1100000', account_ref: `${side}-demo-account`, external_reference: `${side}-demo-order` };
      const csv = Object.keys(row).join(',') + '\n' + Object.values(row).join(',') + '\n';
      const source = { ...parseCsv(csv)[0]!, id: randomUUID(), side, file_hash: sha256(csv), imported_at: now.toISOString(), actor: `${side}-sample-import`, organisation: `${side}-demo-org` };
      trade.sources[side] = source;
      store.saveSourceFile(principal.tenant, source.file_hash, csv);
      store.audit({ ...principal, id: source.actor }, trade.id, 'SOURCE_IMPORTED', now, { source_id: source.id, side, synthetic: true });
    }
    store.save(trade);
    return { seeded: true };
  });
}
