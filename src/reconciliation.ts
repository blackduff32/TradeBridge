import { z } from 'zod';
import type { Candidate, Side } from './domain.js';
import { verifySettlementEffects, type SettlementEffects, type SuiConfig } from './sui.js';

export const postingSchema = z.strictObject({
  trade_id: z.string().min(1), version: z.number().int().positive(), terms_hash: z.string().regex(/^[a-f0-9]{64}$/),
  transaction_digest: z.string().min(1), bond_type: z.string().min(1), cash_type: z.string().min(1),
  quantity: z.string().regex(/^[1-9][0-9]*$/), net_cash_base: z.string().regex(/^[1-9][0-9]*$/),
  buyer_recipient: z.string().min(1), broker_recipient: z.string().min(1),
  posting_reference: z.string().min(1), posted_at: z.iso.datetime(),
});
export type BookPosting = z.infer<typeof postingSchema>;
/** Chain input is normalized by a trusted RPC adapter, never accepted from a browser. */
export function reconcileFourWay(input: {
  approved: Candidate | null; config: SuiConfig; expected: { digest: string; agreement_id: string; escrow_id: string } | null;
  effects: SettlementEffects | null; books: Partial<Record<Side, BookPosting>>;
}) {
  if (!input.approved) return { status: 'NO_APPROVED_TERMS', reconciled: false, adjustments: [] };
  if (!input.expected || !input.effects) return { status: 'UNKNOWN_CHAIN_OUTCOME', reconciled: false, adjustments: [] };
  const chain = verifySettlementEffects(input.config, input.approved, input.expected, input.effects);
  if (!chain.verified) return { status: chain.status, reconciled: false, adjustments: [] };
  const terms = input.approved.terms;
  const expected = { trade_id: terms.trade_id, version: input.approved.version, terms_hash: input.approved.terms_hash, transaction_digest: input.expected.digest, bond_type: terms.bond_type, cash_type: terms.cash_type, quantity: terms.quantity, net_cash_base: terms.net_cash_base, buyer_recipient: terms.buyer_recipient, broker_recipient: terms.broker_recipient };
  const adjustments = (['buyer', 'broker'] as const).flatMap(side => {
    const book = input.books[side];
    if (!book) return [{ side, reason: 'MISSING_POSTING', fields: Object.keys(expected), suggested: expected }];
    const parsed = postingSchema.safeParse(book);
    const fields = parsed.success ? Object.keys(expected).filter(key => book[key as keyof typeof expected] !== expected[key as keyof typeof expected]) : ['INVALID_POSTING'];
    return fields.length ? [{ side, reason: 'POSTING_MISMATCH', fields, suggested: expected }] : [];
  });
  return { status: adjustments.some(a => a.reason === 'MISSING_POSTING') ? 'SETTLED_BOOK_MISSING' : adjustments.length ? 'SETTLED_BOOK_MISMATCH' : 'BOOK_RECONCILED', reconciled: adjustments.length === 0, digest: input.expected.digest, adjustments };
}
