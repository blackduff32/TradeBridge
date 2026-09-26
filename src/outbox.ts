import { randomUUID } from 'node:crypto';
import { DomainError } from './domain.js';
import type { Instruction } from './consent.js';
import type { Store } from './store.js';

export type CommitObservation = { status: 'unknown' } | { status: 'not_found' } | { status: 'failed'; digest: string } | {
  status: 'confirmed'; digest: string; agreement_id: string; terms_hash: string; version: number; instruction_id: string;
};
/** A trusted adapter must decode finalized effects and validate network/package/registry and
 * immutable agreement contents before returning confirmed. No browser accepts this role. */
export interface CommitDriver {
  preflight(instruction: Instruction): Promise<void>;
  prepare(instruction: Instruction): Promise<{ digest: string; bytes: string; expires_at: string }>;
  lookup(digest: string, instruction: Instruction): Promise<CommitObservation>;
  broadcast(bytes: string, instruction: Instruction): Promise<CommitObservation>;
}

/** One leased attempt. Persist signed bytes and their digest BEFORE any broadcast.
 * After ambiguous outcomes, query that digest and only retry those exact bytes. */
export class CommitWorker {
  constructor(private store: Store, private driver: CommitDriver, private now: () => number = Date.now) {}
  async run(tenant: string, tradeId: string, version: number): Promise<Instruction> {
    const initial = this.store.instruction(tenant, tradeId, version);
    if (!initial) throw new DomainError('INSTRUCTION_NOT_FOUND', 'No approved correction instruction exists.', 404);
    if (initial.state === 'CONFIRMED' || initial.state === 'FAILED' || (initial.lease && initial.lease.until > this.now())) return initial;
    let current: Instruction = { ...initial, state: 'SUBMITTING', lease: { owner: randomUUID(), until: this.now() + 60_000 } };
    if (!this.store.replaceInstruction(initial, current)) return this.store.instruction(tenant, tradeId, version)!;
    const save = (next: Instruction) => {
      if (!this.store.replaceInstruction(current, next)) throw new DomainError('WORKER_LEASE_LOST', 'Another worker recovered the instruction. Resolve its existing digest.', 409);
      current = next;
    };
    const observe = (result: CommitObservation): boolean => {
      if (result.status === 'unknown' || result.status === 'not_found') return false;
      if (result.digest !== current.digest) throw new DomainError('CHAIN_EVIDENCE_MISMATCH', 'Transaction digest does not match the persisted instruction.', 409);
      if (result.status === 'confirmed' && (!result.agreement_id || result.terms_hash !== current.terms_hash || result.version !== current.version || result.instruction_id !== current.id)) throw new DomainError('CHAIN_EVIDENCE_MISMATCH', 'Confirmed agreement does not match the approved instruction.', 409);
      save({ ...current, state: result.status === 'confirmed' ? 'CONFIRMED' : 'FAILED', agreement_id: result.status === 'confirmed' ? result.agreement_id : null, prepared: null, lease: null });
      return true;
    };
    try {
      if (current.digest) {
        const observed = await this.driver.lookup(current.digest, current);
        if (observe(observed)) return current;
        if (observed.status === 'unknown') { save({ ...current, state: 'UNKNOWN', lease: null }); return current; }
      }
      await this.driver.preflight(current);
      if (!current.digest) {
        const prepared = await this.driver.prepare(current);
        if (!prepared.digest || !prepared.bytes || !Number.isFinite(Date.parse(prepared.expires_at)) || Date.parse(prepared.expires_at) <= this.now()) throw new DomainError('INVALID_PREPARED_TRANSACTION', 'Signed transaction must have a digest, bytes and future expiry.', 409);
        save({ ...current, digest: prepared.digest, prepared: { bytes: prepared.bytes, expires_at: prepared.expires_at } });
      }
      if (!current.prepared || Date.parse(current.prepared.expires_at) <= this.now()) {
        // Expiry does not prove that a previously broadcast transaction failed.
        save({ ...current, state: 'UNKNOWN', lease: null }); return current;
      }
      // A slow signer/preflight must not broadcast after this worker's lease expires.
      if (current.lease!.until <= this.now()) throw new DomainError('WORKER_LEASE_EXPIRED', 'Resolve the persisted digest with a fresh worker lease.', 409);
      if (!observe(await this.driver.broadcast(current.prepared.bytes, current))) save({ ...current, state: 'UNKNOWN', lease: null });
      return current;
    } catch (error) {
      // No new transaction is prepared once a digest exists, including timeout/crash recovery.
      if (this.store.replaceInstruction(current, { ...current, state: current.digest ? 'UNKNOWN' : 'PENDING', lease: null })) {
        current = this.store.instruction(tenant, tradeId, version)!;
      }
      throw error;
    }
  }
}
