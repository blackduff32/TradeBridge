import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
// Versioned protocol: recursively sorted JSON keys, UTF-8, integer amounts as strings.
// No floats, undefined values, or arbitrary user objects enter the canonical schema.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new DomainError('INVALID_CANONICAL_VALUE', 'Undefined cannot be hashed.');
  return serialized;
}
const text = z.string().min(1).max(160).regex(/^[\x20-\x7E]+$/, 'Use printable ASCII identifiers.');
export const tradeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const u64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/).refine(v => BigInt(v) <= 18446744073709551615n, 'Exceeds u64.');
const positive = u64.refine(v => BigInt(v) > 0n, 'Must be positive.');
const address = z.string().regex(/^0x[0-9a-f]{64}$/).refine(v => !/^0x0+$/.test(v), 'Zero address is not allowed.');
const coinType = z.string().regex(/^0x[0-9a-f]{64}::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*$/);
const fields = {
  trade_id: tradeIdSchema,
  instrument_id: text,
  fill_id: text,
  buyer_address: address,
  broker_address: address,
  buyer_recipient: address,
  broker_recipient: address,
  bond_type: coinType,
  cash_type: coinType,
  quantity: positive,
  unit_price_base: positive,
  accrued_interest_base: u64,
  fees_base: u64,
  net_cash_base: positive,
  settlement_date: z.iso.date(),
  expires_at: z.iso.datetime({ precision: 0 }),
};
export const economicsSchema = z.strictObject(fields).superRefine((row, ctx) => {
  const net = BigInt(row.quantity) * BigInt(row.unit_price_base) + BigInt(row.accrued_interest_base) + BigInt(row.fees_base);
  if (net > 18446744073709551615n || net.toString() !== row.net_cash_base) {
    ctx.addIssue({ code: 'custom', path: ['net_cash_base'], message: 'Net cash must equal quantity × unit price + interest + fees within u64.' });
  }
  if (row.buyer_address === row.broker_address || row.buyer_recipient === row.broker_recipient) {
    ctx.addIssue({ code: 'custom', message: 'Buyer and broker must have separate addresses and recipients.' });
  }
  if (row.bond_type === row.cash_type) ctx.addIssue({ code: 'custom', message: 'Asset types must differ.' });
  if (row.settlement_date > row.expires_at.slice(0, 10)) ctx.addIssue({ code: 'custom', message: 'Settlement date must not follow expiry.' });
});
const sourceSchema = z.strictObject({ ...fields, account_ref: text, external_reference: text });
export type Economics = z.infer<typeof economicsSchema>;
export type Side = 'buyer' | 'broker';
export interface Principal { id: string; tenant: string; organisation: string; side: Side; kind: 'agent' | 'human'; tradeIds: string[]; token: string }
export interface Source {
  id: string; side: Side; file_hash: string; raw_row: string; record_number: number;
  line_end: number; imported_at: string; actor: string; organisation: string;
  record: z.infer<typeof sourceSchema>;
}
export interface Candidate {
  version: number; terms_hash: string; created_at: string; reason: string;
  terms: Economics & {
    schema_version: 1; version: number; tenant: string; chain_id: string; package_id: string; registry_id: string;
    quantity_decimals: 0; cash_decimals: 2; unit_price_convention: 'cash_base_per_bond_base'; gross_cash_base: string;
    buyer_source: string; broker_source: string; buyer_account_ref: string; broker_account_ref: string;
    buyer_external_reference: string; broker_external_reference: string;
  };
}
export interface Trade {
  id: string; tenant: string; revision: number; sources: Partial<Record<Side, Source>>;
  candidates: Candidate[]; canonical: Candidate | null;
}
export interface Environment { chain_id: string; package_id: string; registry_id: string; bond_type: string; cash_type: string }
export const DEMO_PACKAGE = '0x' + 'd'.repeat(64);
export const demoEnvironment: Environment = {
  chain_id: 'local-demo:not-connected', package_id: 'undeployed', registry_id: 'undeployed',
  bond_type: `${DEMO_PACKAGE}::demo_bond::DEMO_BOND`, cash_type: `${DEMO_PACKAGE}::demo_usd::DEMO_USD`,
};
export function validateEnvironment(record: Economics, environment: Environment, now: Date) {
  if (record.bond_type !== environment.bond_type || record.cash_type !== environment.cash_type) {
    throw new DomainError('UNSUPPORTED_ASSET', 'Only configured demo asset types are accepted.');
  }
  if (Date.parse(record.expires_at) <= now.getTime()) throw new DomainError('TRADE_EXPIRED', 'Trade expiry must be in the future.');
}
export function parseCsv(csv: string) {
  let parsed: { record: unknown; raw: string; info: { lines: number } }[];
  try {
    parsed = parse(csv, {
      bom: true, columns(headers: string[]) {
        const expected = Object.keys(sourceSchema.shape);
        if (new Set(headers).size !== headers.length || headers.length !== expected.length || !headers.every(h => expected.includes(h))) {
          throw new Error('CSV headers must match the documented schema exactly, with no duplicates.');
        }
        return headers;
      }, raw: true, info: true, skip_empty_lines: true, max_record_size: 16_384,
    });
  } catch (error) {
    throw new DomainError('INVALID_CSV', error instanceof Error ? error.message : 'Invalid CSV.');
  }
  if (parsed.length === 0 || parsed.length > 100) throw new DomainError('INVALID_CSV', 'Import between 1 and 100 records.');
  const records = parsed.map((row, index) => {
    const record = sourceSchema.parse(row.record);
    const { account_ref: _account, external_reference: _reference, ...economics } = record;
    economicsSchema.parse(economics);
    return { record, raw_row: row.raw, record_number: index + 1, line_end: row.info.lines };
  });
  if (new Set(records.map(r => r.record.trade_id)).size !== records.length) throw new DomainError('DUPLICATE_TRADE', 'One row per trade ID per source import. Use distinct trade IDs for fills.');
  return records;
}
export function compare(trade: Trade) {
  const buyer = trade.sources.buyer;
  const broker = trade.sources.broker;
  if (!buyer || !broker) return { status: buyer ? 'MISSING_BROKER' : 'MISSING_INTERNAL', differences: [], settlement_allowed: false };
  const differences = (Object.keys(fields) as (keyof Economics)[]).filter(key => buyer.record[key] !== broker.record[key]).map(field => ({
    field, buyer: buyer.record[field], broker: broker.record[field],
    code: field === 'quantity' ? 'QUANTITY_MISMATCH' : field === 'unit_price_base' ? 'PRICE_MISMATCH' : field === 'net_cash_base' ? 'CASH_MISMATCH' : 'TERMS_MISMATCH',
    delta: ['quantity', 'unit_price_base', 'accrued_interest_base', 'fees_base', 'net_cash_base'].includes(field)
      ? (BigInt(broker.record[field]) - BigInt(buyer.record[field])).toString() : null,
    evidence: { buyer: { source_id: buyer.id, record_number: buyer.record_number, file_hash: buyer.file_hash }, broker: { source_id: broker.id, record_number: broker.record_number, file_hash: broker.file_hash } },
  }));
  return { status: differences.length ? 'INTERVENTION_REQUIRED' : 'HUMAN_VERIFICATION_REQUIRED', differences, settlement_allowed: false };
}
export function createCandidate(trade: Trade, economics: Economics, reason: string, environment: Environment, now: Date): Candidate {
  const buyer = trade.sources.buyer;
  const broker = trade.sources.broker;
  if (!buyer || !broker) throw new DomainError('SOURCES_REQUIRED', 'Both source records are required before a proposal.', 409);
  if (economics.trade_id !== trade.id) throw new DomainError('TRADE_ID_MISMATCH', 'Proposal trade ID must match the path.');
  validateEnvironment(economics, environment, now);
  const version = (trade.candidates.at(-1)?.version ?? 1) + 1;
  const terms: Candidate['terms'] = {
    ...economics, schema_version: 1, version, tenant: trade.tenant,
    chain_id: environment.chain_id, package_id: environment.package_id, registry_id: environment.registry_id,
    quantity_decimals: 0, cash_decimals: 2, unit_price_convention: 'cash_base_per_bond_base',
    gross_cash_base: (BigInt(economics.quantity) * BigInt(economics.unit_price_base)).toString(),
    buyer_source: buyer.id, broker_source: broker.id, buyer_account_ref: buyer.record.account_ref, broker_account_ref: broker.record.account_ref,
    buyer_external_reference: buyer.record.external_reference, broker_external_reference: broker.record.external_reference,
  };
  return { version, terms, terms_hash: sha256('tradebridge:terms:v1\n' + canonicalJson(terms)), reason, created_at: now.toISOString() };
}
