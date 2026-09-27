import { coinWithBalance, Transaction } from '@mysten/sui/transactions';
import { isValidSuiObjectId, normalizeSuiAddress } from '@mysten/sui/utils';
import { z } from 'zod';
import { DomainError, sha256, type Candidate } from './domain.js';

const objectId = z.string().refine(isValidSuiObjectId, 'Expected a full Sui object ID.');
export const suiConfigSchema = z.strictObject({
  chain_id: z.string().min(1), package_id: objectId, registry_id: objectId,
  bond_type: z.string().min(1), cash_type: z.string().min(1),
});
export type SuiConfig = z.infer<typeof suiConfigSchema>;
function bytes(hex: string) { if (!/^[a-f0-9]{64}$/.test(hex)) throw new DomainError('INVALID_HASH', 'A SHA-256 hex digest is required.'); return Array.from(Buffer.from(hex, 'hex')); }
function bound(config: SuiConfig, candidate: Candidate, allowExpired = false) {
  suiConfigSchema.parse(config);
  for (const key of ['chain_id', 'package_id', 'registry_id', 'bond_type', 'cash_type'] as const) {
    if (candidate.terms[key] !== config[key]) throw new DomainError('CHAIN_CONTEXT_MISMATCH', 'Candidate must bind the configured chain, package, registry and assets.', 409);
  }
  if (!allowExpired && Date.parse(candidate.terms.expires_at) <= Date.now()) throw new DomainError('TRADE_EXPIRED', 'Expired candidates cannot create chain transactions.', 409);
}
/** A trade instance is its tenant, ID and the two immutable source records, so amendments share
 * the key while a re-imported workspace gets a fresh one instead of colliding in the registry. */
export function chainTradeKey(candidate: Candidate) {
  const t = candidate.terms;
  return sha256(`tradebridge:trade:v2\n${t.tenant}\n${t.trade_id}\n${t.buyer_source}\n${t.broker_source}`);
}
export function proposeTransaction(config: SuiConfig, candidate: Candidate, sender: string) {
  bound(config, candidate); const t = candidate.terms;
  if (![t.buyer_address, t.broker_address].includes(normalizeSuiAddress(sender))) throw new DomainError('PARTY_REQUIRED', 'Only a trade party can propose the on-chain intent.', 403);
  const tx = new Transaction(); tx.setSender(sender);
  tx.moveCall({ target: `${config.package_id}::settlement::propose`, typeArguments: [config.bond_type, config.cash_type], arguments: [
    tx.object(config.registry_id), tx.pure.vector('u8', bytes(chainTradeKey(candidate))), tx.pure.u64(candidate.version), tx.pure.vector('u8', bytes(candidate.terms_hash)),
    tx.pure.address(t.buyer_address), tx.pure.address(t.broker_address), tx.pure.address(t.buyer_recipient), tx.pure.address(t.broker_recipient),
    tx.pure.u64(t.quantity), tx.pure.u64(t.unit_price_base), tx.pure.u64(t.accrued_interest_base), tx.pure.u64(t.fees_base), tx.pure.u64(t.net_cash_base), tx.pure.u64(Date.parse(t.expires_at)), tx.object('0x6'),
  ] });
  return tx;
}
export function approveTransaction(config: SuiConfig, candidate: Candidate, intentId: string, side: 'buyer' | 'broker') {
  bound(config, candidate); objectId.parse(intentId);
  const tx = new Transaction(); tx.setSender(side === 'buyer' ? candidate.terms.buyer_address : candidate.terms.broker_address);
  tx.moveCall({ target: `${config.package_id}::settlement::approve_${side}`, typeArguments: [config.bond_type, config.cash_type], arguments: [tx.object(intentId), tx.object('0x6')] });
  return tx;
}
export function settlementTransaction(config: SuiConfig, candidate: Candidate, agreementId: string, escrowId: string) {
  bound(config, candidate); objectId.parse(agreementId); objectId.parse(escrowId);
  const tx = new Transaction();
  tx.moveCall({ target: `${config.package_id}::settlement::settle`, typeArguments: [config.bond_type, config.cash_type], arguments: [tx.object(config.registry_id), tx.object(agreementId), tx.object(escrowId), tx.object('0x6')] });
  return tx;
}
/** Restricted service builder. The caller must verify both consumed consent records before signing. */
export function attestationTransaction(config: SuiConfig, candidate: Candidate, intentId: string, verifierCap: string, receipts: { buyer: string; broker: string; expires_at: string }) {
  bound(config, candidate); objectId.parse(intentId); objectId.parse(verifierCap);
  const expiry = Date.parse(receipts.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.parse(candidate.terms.expires_at) || receipts.buyer === receipts.broker) throw new DomainError('INVALID_ATTESTATION', 'Two distinct receipt commitments and a fresh bounded expiry are required.', 409);
  const tx = new Transaction();
  tx.moveCall({ target: `${config.package_id}::settlement::attest`, typeArguments: [config.bond_type, config.cash_type], arguments: [tx.object(verifierCap), tx.object(config.registry_id), tx.object(intentId), tx.pure.vector('u8', bytes(receipts.buyer)), tx.pure.vector('u8', bytes(receipts.broker)), tx.pure.u64(expiry), tx.object('0x6')] });
  return tx;
}
export function commitmentTransaction(config: SuiConfig, candidate: Candidate, intentId: string, prior?: { agreement_id: string; escrow_id: string }) {
  bound(config, candidate); objectId.parse(intentId);
  const tx = new Transaction();
  const args = [tx.object(config.registry_id)];
  if (prior) { objectId.parse(prior.agreement_id); objectId.parse(prior.escrow_id); args.push(tx.object(prior.agreement_id), tx.object(prior.escrow_id)); }
  args.push(tx.object(intentId), tx.object('0x6'));
  tx.moveCall({ target: `${config.package_id}::settlement::${prior ? 'amend' : 'commit'}`, typeArguments: [config.bond_type, config.cash_type], arguments: args });
  return tx;
}
/** Each party funds only its own leg; coinWithBalance splits exactly the remaining amount from the party's coins. */
export function depositTransaction(config: SuiConfig, candidate: Candidate, agreementId: string, escrowId: string, amount: bigint, side: 'buyer' | 'broker') {
  bound(config, candidate); [agreementId, escrowId].forEach(id => objectId.parse(id));
  const cap = BigInt(side === 'buyer' ? candidate.terms.net_cash_base : candidate.terms.quantity);
  if (amount <= 0n || amount > cap) throw new DomainError('INVALID_DEPOSIT', 'A deposit must be positive and within the approved leg amount.', 409);
  const tx = new Transaction(); tx.setSender(side === 'buyer' ? candidate.terms.buyer_address : candidate.terms.broker_address);
  const coin = coinWithBalance({ type: side === 'buyer' ? config.cash_type : config.bond_type, balance: amount });
  tx.moveCall({ target: `${config.package_id}::settlement::deposit_${side === 'buyer' ? 'cash' : 'bond'}`, typeArguments: [config.bond_type, config.cash_type], arguments: [tx.object(config.registry_id), tx.object(agreementId), tx.object(escrowId), coin, tx.object('0x6')] });
  return tx;
}
export function refundTransaction(config: SuiConfig, candidate: Candidate, agreementId: string, escrowId: string, side: 'buyer' | 'broker') {
  bound(config, candidate, true); [agreementId, escrowId].forEach(id => objectId.parse(id));
  const tx = new Transaction(); tx.setSender(side === 'buyer' ? candidate.terms.buyer_address : candidate.terms.broker_address);
  tx.moveCall({ target: `${config.package_id}::settlement::refund_${side === 'buyer' ? 'cash' : 'bond'}`, typeArguments: [config.bond_type, config.cash_type], arguments: [tx.object(agreementId), tx.object(escrowId), tx.object('0x6')] });
  return tx;
}
export function cancellationTransaction(config: SuiConfig, candidate: Candidate, agreementId: string, escrowId: string, side: 'buyer' | 'broker') {
  bound(config, candidate, true); [agreementId, escrowId].forEach(id => objectId.parse(id));
  const tx = new Transaction(); tx.setSender(side === 'buyer' ? candidate.terms.buyer_address : candidate.terms.broker_address);
  tx.moveCall({ target: `${config.package_id}::settlement::cancel`, typeArguments: [config.bond_type, config.cash_type], arguments: [tx.object(agreementId), tx.object(escrowId)] });
  return tx;
}
export interface SettlementEffects {
  digest: string; chain_id: string; checkpoint: string | null; status: 'success' | 'failure';
  calls: { package_id: string; module: string; function: string; object_ids: string[] }[];
  balance_changes: { owner: string; coin_type: string; amount: string }[];
}
/** Input must be decoded from trusted finalized RPC effects, never a client/event body. */
export function verifySettlementEffects(config: SuiConfig, candidate: Candidate, expected: { digest: string; agreement_id: string; escrow_id: string }, effects: SettlementEffects) {
  // Settlement can be observed after expiry, so do not apply transaction creation's time check.
  for (const key of ['chain_id', 'package_id', 'registry_id', 'bond_type', 'cash_type'] as const) if (candidate.terms[key] !== config[key]) throw new DomainError('CHAIN_CONTEXT_MISMATCH', 'Evidence configuration differs from approved terms.');
  if (effects.digest !== expected.digest || effects.chain_id !== config.chain_id || !effects.checkpoint) return { status: 'UNKNOWN_OUTCOME', verified: false };
  if (effects.status === 'failure') return { status: 'ABORTED', verified: false };
  const call = effects.calls.find(c => c.package_id === config.package_id && c.module === 'settlement' && c.function === 'settle' && c.object_ids.includes(expected.agreement_id) && c.object_ids.includes(expected.escrow_id) && c.object_ids.includes(config.registry_id));
  if (!call) return { status: 'TRANSFER_MISMATCH', verified: false };
  const expectedTransfers = [{ type: config.bond_type, recipient: candidate.terms.buyer_recipient, amount: candidate.terms.quantity }, { type: config.cash_type, recipient: candidate.terms.broker_recipient, amount: candidate.terms.net_cash_base }];
  for (const leg of expectedTransfers) {
    const changes = effects.balance_changes.filter(c => c.coin_type === leg.type);
    if (changes.some(c => !/^-?(0|[1-9][0-9]*)$/.test(c.amount))) return { status: 'TRANSFER_MISMATCH', verified: false };
    const received = changes.filter(c => c.owner === leg.recipient).reduce((sum, c) => sum + BigInt(c.amount), 0n);
    if (received !== BigInt(leg.amount) || changes.some(c => BigInt(c.amount) > 0n && c.owner !== leg.recipient)) return { status: 'TRANSFER_MISMATCH', verified: false };
  }
  return { status: 'CONFIRMED', verified: true, digest: effects.digest, checkpoint: effects.checkpoint };
}
