import { randomBytes } from 'node:crypto';
import { demoEnvironment, type Economics, type Principal, type Side } from '../src/domain.js';

export function exampleTerms(side: Side, now = new Date()): Economics {
  return {
    trade_id: 'TB-001', instrument_id: 'SIMULATED-BOND-001', fill_id: 'FILL-001',
    buyer_address: '0x' + '1'.repeat(64), broker_address: '0x' + '2'.repeat(64),
    buyer_recipient: '0x' + '1'.repeat(64), broker_recipient: '0x' + '2'.repeat(64),
    bond_type: demoEnvironment.bond_type, cash_type: demoEnvironment.cash_type,
    quantity: side === 'buyer' ? '1000' : '1100', unit_price_base: '1000',
    accrued_interest_base: '0', fees_base: '0', net_cash_base: side === 'buyer' ? '1000000' : '1100000',
    settlement_date: now.toISOString().slice(0, 10), expires_at: new Date(now.getTime() + 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}
export function exampleCsv(side: Side, now = new Date(), overrides: Partial<Economics> = {}) {
  const row = { ...exampleTerms(side, now), ...overrides, account_ref: `${side}-demo-account`, external_reference: `${side}-demo-order` };
  return Object.keys(row).join(',') + '\n' + Object.values(row).join(',') + '\n';
}
export function examplePrincipals(): Principal[] {
  return (['buyer', 'broker'] as const).flatMap(side => (['agent', 'human'] as const).map(kind => ({
    id: `${side}-${kind}`, tenant: 'demo-workspace', organisation: `${side}-demo-org`, side, kind,
    tradeIds: ['TB-001'], token: randomBytes(32).toString('hex'),
  })));
}
