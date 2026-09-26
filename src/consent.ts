import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, DomainError, sha256, type Principal, type Side } from './domain.js';
import type { Challenge, VerifiedHuman } from './world-id.js';
import { Store } from './store.js';

export interface StaffAuthority {
  assertCurrent(principal: Principal): Promise<void>;
  resolve(tenant: string, account: string): Principal | undefined;
}
export interface Consent {
  id: string; tenant: string; trade_id: string; version: number; terms_hash: string; side: Side;
  account: string; organisation: string; challenge_id: string; person_binding: string; identity_scope: string;
  receipt_hash: string; decision: 'approve' | 'reject'; decided_at: string; expires_at: string; consumed: boolean;
}
export interface Instruction {
  id: string; tenant: string; trade_id: string; version: number; terms_hash: string;
  buyer_consent: string; broker_consent: string; created_at: string;
  state: 'PENDING' | 'SUBMITTING' | 'UNKNOWN' | 'CONFIRMED' | 'FAILED'; digest: string | null; agreement_id: string | null;
  prepared: { bytes: string; expires_at: string } | null;
  lease: { owner: string; until: number } | null;
}
export const consentSchema = z.strictObject({ expected_revision: z.number().int(), challenge_id: z.uuid(), version: z.number().int(), terms_hash: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['approve', 'reject']) });
export class ConsentService {
  constructor(private store: Store, private authority?: StaffAuthority, private now: () => Date = () => new Date()) {}
  async record(principal: Principal, tradeId: string, raw: unknown, key: string) {
    const input = consentSchema.parse(raw);
    if (!this.authority) throw new DomainError('STAFF_AUTHORITY_NOT_CONNECTED', 'Verified organizational authority is required before human consent can be accepted.', 503);
    if (principal.kind !== 'human' || !principal.tradeIds.includes(tradeId)) throw new DomainError('CONSENT_FORBIDDEN', 'Only an authorized human may consent.', 403);
    await this.authority.assertCurrent(principal);
    return this.store.write(principal, key, sha256(canonicalJson({ tradeId, input })), () => {
      const trade = this.store.get(principal.tenant, tradeId); const candidate = trade?.candidates.at(-1);
      if (!trade || !candidate || candidate.version !== input.version || candidate.terms_hash !== input.terms_hash || trade.revision !== input.expected_revision) throw new DomainError('STALE_REVISION', 'Review the latest candidate before consenting.', 409);
      if (trade.canonical) throw new DomainError('CORRECTION_ALREADY_STAGED', 'An existing correction must be resolved before another consent.', 409);
      const challenge = this.store.getChallenge<Challenge>(input.challenge_id, principal.tenant);
      const verified = this.store.verification<VerifiedHuman>(input.challenge_id, principal.tenant);
      if (!challenge || challenge.state !== 'VERIFIED' || !verified || challenge.account !== principal.id || challenge.organisation !== principal.organisation || challenge.side !== principal.side || challenge.trade_id !== tradeId || challenge.terms_hash !== candidate.terms_hash || challenge.version !== candidate.version) throw new DomainError('VERIFIED_CHALLENGE_REQUIRED', 'A verified, unused challenge bound to this exact human and trade is required.', 403);
      if (Date.parse(verified.expires_at) <= this.now().getTime() || Date.parse(candidate.terms.expires_at) <= this.now().getTime()) throw new DomainError('APPROVAL_EXPIRED', 'Verification has expired. Request a fresh challenge.', 409);
      const existing = this.store.consents(principal.tenant, tradeId, candidate.version);
      if (existing.some(c => c.decision === 'reject')) throw new DomainError('APPROVAL_REJECTED', 'This candidate was rejected. Create a new version.', 409);
      if (existing.some(c => c.side === principal.side)) throw new DomainError('CONSENT_ALREADY_RECORDED', 'This side has already decided on this version.', 409);
      const other = existing.find(c => c.side !== principal.side);
      if (other && (other.identity_scope !== verified.identity_scope || other.person_binding === verified.person_binding || other.account === principal.id)) throw new DomainError('DISTINCT_HUMANS_REQUIRED', 'Buyer and broker must be distinct verified people in the same validated identity scope.', 403);
      const consent: Consent = { id: randomUUID(), tenant: principal.tenant, trade_id: tradeId, version: candidate.version, terms_hash: candidate.terms_hash, side: principal.side, account: principal.id, organisation: principal.organisation, challenge_id: challenge.id, person_binding: verified.person_binding, identity_scope: verified.identity_scope, receipt_hash: verified.receipt_hash, decision: input.decision, decided_at: this.now().toISOString(), expires_at: verified.expires_at, consumed: false };
      this.store.saveConsent(consent);
      this.store.finishChallenge(challenge.id, principal.tenant, 'CONSENT_RECORDED', verified);
      trade.revision++; this.store.save(trade);
      this.store.audit(principal, tradeId, input.decision === 'approve' ? 'HUMAN_APPROVED' : 'HUMAN_REJECTED', this.now(), { approval_id: consent.id, version: candidate.version, terms_hash: candidate.terms_hash, side: principal.side });
      return { approval_id: consent.id, decision: consent.decision, version: consent.version, revision: trade.revision };
    });
  }
  /** Internal correction-service operation. It is not an agent or human API permission. */
  async stage(tenant: string, tradeId: string, expectedRevision: number): Promise<Instruction> {
    if (!this.authority) throw new DomainError('STAFF_AUTHORITY_NOT_CONNECTED', 'Current staff authority must be checked before commitment.', 503);
    const initial = this.store.get(tenant, tradeId); const candidate = initial?.candidates.at(-1);
    if (!initial || !candidate) throw new DomainError('NOT_FOUND', 'Trade candidate not found.', 404);
    const existing = this.store.instruction(tenant, tradeId, candidate.version);
    if (existing) return existing;
    const consents = this.store.consents(tenant, tradeId, candidate.version);
    for (const consent of consents) {
      const principal = this.authority.resolve(tenant, consent.account);
      if (!principal || principal.kind !== 'human' || principal.side !== consent.side || principal.organisation !== consent.organisation || !principal.tradeIds.includes(tradeId)) throw new DomainError('STAFF_AUTHORITY_REVOKED', 'An approver no longer has the required authority.', 403);
      await this.authority.assertCurrent(principal);
    }
    const service: Principal = { id: 'correction-service', tenant, organisation: 'internal', side: 'buyer', kind: 'agent', tradeIds: [tradeId], token: '' };
    return this.store.write(service, `commit-${tradeId}-${candidate.version}`, candidate.terms_hash, () => {
      const trade = this.store.get(tenant, tradeId)!; const latest = trade.candidates.at(-1)!;
      if (trade.revision !== expectedRevision || latest.terms_hash !== candidate.terms_hash || trade.canonical) throw new DomainError('STALE_REVISION', 'The candidate changed before correction could be staged.', 409);
      const current = this.store.consents(tenant, tradeId, latest.version);
      const buyer = current.find(c => c.side === 'buyer'); const broker = current.find(c => c.side === 'broker');
      if (!buyer || !broker || current.length !== 2 || current.some(c => c.consumed || c.decision !== 'approve' || c.terms_hash !== latest.terms_hash || Date.parse(c.expires_at) <= this.now().getTime()) || Date.parse(latest.terms.expires_at) <= this.now().getTime()) throw new DomainError('BILATERAL_APPROVAL_REQUIRED', 'Two current, unconsumed approvals of the exact same trade are required.', 409);
      if (buyer.account === broker.account || buyer.person_binding === broker.person_binding || buyer.identity_scope !== broker.identity_scope) throw new DomainError('DISTINCT_HUMANS_REQUIRED', 'The approvals do not establish two distinct humans.', 403);
      const instruction: Instruction = { id: randomUUID(), tenant, trade_id: tradeId, version: latest.version, terms_hash: latest.terms_hash, buyer_consent: buyer.id, broker_consent: broker.id, created_at: this.now().toISOString(), state: 'PENDING', digest: null, agreement_id: null, prepared: null, lease: null };
      this.store.saveConsent({ ...buyer, consumed: true }); this.store.saveConsent({ ...broker, consumed: true });
      this.store.saveInstruction(instruction); trade.canonical = latest; trade.revision++; this.store.save(trade);
      this.store.audit(service, tradeId, 'CORRECTION_STAGED', this.now(), { instruction_id: instruction.id, version: latest.version, terms_hash: latest.terms_hash });
      return instruction;
    });
  }
}
