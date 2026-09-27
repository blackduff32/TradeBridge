import { normalizeSuiAddress } from '@mysten/sui/utils';
import { DomainError, type Candidate, type Principal, type Trade } from './domain.js';
import type { ConsentService, Instruction } from './consent.js';
import { CommitWorker, type CommitDriver, type CommitObservation } from './outbox.js';
import { approveTransaction, attestationTransaction, commitmentTransaction, depositTransaction, proposeTransaction, settlementTransaction, verifySettlementEffects, type SuiConfig } from './sui.js';
import type { Execution, Signer, SuiLive } from './sui-live.js';
import type { Store } from './store.js';

export type StepKey = 'propose' | 'attest' | 'approve_buyer' | 'approve_broker' | 'commit' | 'deposit_cash' | 'deposit_bond' | 'settle_probe' | 'settle';
export interface ChainStep { key: StepKey; digest: string; success: boolean; error: string | null; signer: string; checkpoint: string | null; at: string; expected_failure?: boolean }
export interface ChainRun {
  version: number; terms_hash: string; intent_id: string | null; agreement_id: string | null; escrow_id: string | null;
  approval_expires_at: string | null; steps: ChainStep[]; settlement: { status: string; verified: boolean; digest: string } | null;
}

const hex = (value: unknown): string => {
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString('hex');
  if (typeof value === 'string') return /^(0x)?[0-9a-f]+$/i.test(value) && value.replace(/^0x/, '').length % 2 === 0 ? value.replace(/^0x/, '').toLowerCase() : Buffer.from(value, 'base64').toString('hex');
  return '';
};
const amount = (value: unknown): bigint => {
  const raw = value !== null && typeof value === 'object' ? (value as { value?: unknown }).value : value;
  return /^[0-9]+$/.test(String(raw)) ? BigInt(String(raw)) : 0n;
};

/** Drives one approved correction from human consent to atomic settlement on Sui testnet. */
export class ChainFlow {
  private locks = new Map<string, Promise<unknown>>();
  constructor(private store: Store, readonly sui: SuiLive, private consent: ConsentService, private now: () => Date = () => new Date()) {}
  private get config(): SuiConfig { return this.sui.environment(); }
  private exclusive<T>(trade: Trade, work: () => Promise<T>): Promise<T> {
    const key = `${trade.tenant}:${trade.id}`;
    const next = (this.locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.locks.set(key, next);
    return next;
  }
  private current(trade: Trade) {
    const fresh = this.store.get(trade.tenant, trade.id)!;
    const candidate = fresh.canonical ?? fresh.candidates.at(-1);
    return { fresh, candidate, run: candidate ? this.store.chainRun<ChainRun>(trade.tenant, trade.id, candidate.version) : undefined };
  }
  private record(principal: Principal, trade: Trade, run: ChainRun, key: StepKey, execution: Execution, expectedFailure = false) {
    const step: ChainStep = { key, digest: execution.digest, success: execution.success, error: execution.error, signer: execution.signer, checkpoint: execution.checkpoint, at: this.now().toISOString(), ...(expectedFailure ? { expected_failure: true } : {}) };
    run.steps.push(step);
    this.store.saveChainRun(trade.tenant, trade.id, run.version, run);
    this.store.audit(principal, trade.id, execution.success ? 'CHAIN_STEP_CONFIRMED' : 'CHAIN_STEP_REJECTED', this.now(), { step: key, digest: execution.digest, signer: execution.signer, version: run.version, error: execution.error });
    if (!execution.success && !expectedFailure) throw new DomainError('CHAIN_STEP_FAILED', `Sui rejected ${key}: ${execution.error ?? 'unknown error'}.`, 502);
    return execution;
  }
  private done(run: ChainRun, key: StepKey) { return run.steps.some(s => s.key === key && s.success); }
  private created(execution: Execution, struct: string) {
    return execution.created.find(o => o.type.includes(`::settlement::${struct}<`) && normalizeSuiAddress(o.type.split('::')[0]!) === this.config.package_id)?.id;
  }

  /** Stages the bilaterally approved version, then proposes, attests, approves and commits it on Sui. Safe to retry. */
  commit(principal: Principal, trade: Trade): Promise<ChainRun> {
    return this.exclusive(trade, async () => {
      let { fresh, candidate } = this.current(trade);
      if (!candidate) throw new DomainError('NOT_FOUND', 'Create a proposal before committing.', 404);
      if (!fresh.canonical) {
        await this.consent.stage(fresh.tenant, fresh.id, fresh.revision);
        ({ fresh, candidate } = this.current(trade));
      }
      const version = candidate!.version;
      const instruction = this.store.instruction(fresh.tenant, fresh.id, version);
      if (!instruction || instruction.terms_hash !== candidate!.terms_hash) throw new DomainError('BILATERAL_APPROVAL_REQUIRED', 'Two current approvals of this exact version are required.', 409);
      const consents = this.store.consents(fresh.tenant, fresh.id, version);
      const buyer = consents.find(c => c.id === instruction.buyer_consent); const broker = consents.find(c => c.id === instruction.broker_consent);
      if (!buyer || !broker) throw new DomainError('BILATERAL_APPROVAL_REQUIRED', 'The approved consent records are missing.', 409);
      const run: ChainRun = this.store.chainRun<ChainRun>(fresh.tenant, fresh.id, version) ?? { version, terms_hash: candidate!.terms_hash, intent_id: null, agreement_id: null, escrow_id: null, approval_expires_at: null, steps: [], settlement: null };
      const terms = candidate!;
      if (!run.intent_id) {
        const execution = this.record(principal, fresh, run, 'propose', await this.sui.execute('buyer', proposeTransaction(this.config, terms, this.sui.address('buyer'))));
        run.intent_id = this.created(execution, 'Intent') ?? null;
        if (!run.intent_id) throw new DomainError('CHAIN_EVIDENCE_MISSING', 'The proposal transaction did not create an intent.', 502);
        this.store.saveChainRun(fresh.tenant, fresh.id, version, run);
      }
      if (!this.done(run, 'attest')) {
        const expiry = new Date(Math.min(Date.parse(buyer.expires_at), Date.parse(broker.expires_at), Date.parse(terms.terms.expires_at))).toISOString();
        this.record(principal, fresh, run, 'attest', await this.sui.execute('operator', attestationTransaction(this.config, terms, run.intent_id, this.sui.config.verifier_cap_id, { buyer: buyer.receipt_hash, broker: broker.receipt_hash, expires_at: expiry })));
        run.approval_expires_at = expiry;
        this.store.saveChainRun(fresh.tenant, fresh.id, version, run);
      }
      for (const side of ['buyer', 'broker'] as const) {
        if (!this.done(run, `approve_${side}`)) this.record(principal, fresh, run, `approve_${side}`, await this.sui.execute(side, approveTransaction(this.config, terms, run.intent_id, side)));
      }
      if (!run.agreement_id) {
        const committed = await new CommitWorker(this.store, this.driver(terms, run), () => this.now().getTime()).run(fresh.tenant, fresh.id, version);
        if (committed.state !== 'CONFIRMED' || !committed.digest) throw new DomainError('COMMIT_PENDING', `Commitment is ${committed.state.toLowerCase()}. Retry to resume from the recorded digest.`, 409);
        const executed = await this.sui.transaction(committed.digest);
        run.agreement_id = committed.agreement_id;
        run.escrow_id = executed?.effects?.changedObjects.find(o => o.idOperation === 'Created' && (executed.objectTypes?.[o.objectId] ?? '').includes('::settlement::Escrow<'))?.objectId ?? null;
        run.steps.push({ key: 'commit', digest: committed.digest, success: true, error: null, signer: this.sui.address('operator'), checkpoint: executed?.checkpoint ?? null, at: this.now().toISOString() });
        this.store.saveChainRun(fresh.tenant, fresh.id, version, run);
        this.store.audit(principal, fresh.id, 'AGREEMENT_COMMITTED', this.now(), { digest: committed.digest, agreement_id: run.agreement_id, escrow_id: run.escrow_id, version, terms_hash: terms.terms_hash });
      }
      return run;
    });
  }

  /** Durable commitment: signed bytes and digest are persisted before broadcast; retries reuse them. */
  private driver(candidate: Candidate, run: ChainRun): CommitDriver {
    const observe = async (digest: string, instruction: Instruction): Promise<CommitObservation> => {
      const executed = await this.sui.transaction(digest);
      if (!executed) return { status: 'not_found' };
      if (!executed.status.success) return { status: 'failed', digest };
      const agreementId = executed.effects?.changedObjects.find(o => o.idOperation === 'Created' && (executed.objectTypes?.[o.objectId] ?? '').includes('::settlement::Agreement<'))?.objectId;
      if (!agreementId) return { status: 'failed', digest };
      const fields = await this.sui.fields(agreementId);
      return { status: 'confirmed', digest, agreement_id: agreementId, terms_hash: hex(fields.terms_hash), version: Number(fields.version), instruction_id: instruction.id };
    };
    return {
      preflight: async instruction => {
        if (!run.intent_id || !this.done(run, 'approve_buyer') || !this.done(run, 'approve_broker')) throw new DomainError('CHAIN_APPROVALS_MISSING', 'Both party approvals must be confirmed on-chain first.', 409);
        if (instruction.terms_hash !== candidate.terms_hash) throw new DomainError('CHAIN_CONTEXT_MISMATCH', 'Instruction and candidate differ.', 409);
      },
      prepare: async () => ({ ...(await this.sui.prepare('operator', commitmentTransaction(this.config, candidate, run.intent_id!))), expires_at: run.approval_expires_at ?? candidate.terms.expires_at }),
      lookup: observe,
      broadcast: async (bytes, instruction) => observe((await this.sui.broadcast(bytes)).digest, instruction),
    };
  }

  /** Each human funds only their own leg with exactly the remaining approved amount. */
  fund(principal: Principal, trade: Trade): Promise<ChainRun> {
    return this.exclusive(trade, async () => {
      const { fresh, candidate, run } = this.current(trade);
      if (!candidate || !run?.agreement_id || !run.escrow_id) throw new DomainError('AGREEMENT_NOT_COMMITTED', 'Funding opens only after the agreement is committed on Sui.', 409);
      const escrow = await this.sui.fields(run.escrow_id);
      const side = principal.side;
      const required = BigInt(side === 'buyer' ? candidate.terms.net_cash_base : candidate.terms.quantity);
      const remaining = required - amount(side === 'buyer' ? escrow.cash : escrow.bond);
      if (remaining <= 0n) return run;
      const signer: Signer = side;
      this.record(principal, fresh, run, side === 'buyer' ? 'deposit_cash' : 'deposit_bond', await this.sui.execute(signer, depositTransaction(this.config, candidate, run.agreement_id, run.escrow_id, remaining, side)));
      return run;
    });
  }

  /** The backend refuses an underfunded settlement before signing. A probe submits it anyway to show Move rejects it too. */
  settle(principal: Principal, trade: Trade, probe = false): Promise<ChainRun> {
    return this.exclusive(trade, async () => {
      const { fresh, candidate, run } = this.current(trade);
      if (!candidate || !run?.agreement_id || !run.escrow_id) throw new DomainError('AGREEMENT_NOT_COMMITTED', 'Settlement opens only after the agreement is committed on Sui.', 409);
      if (run.settlement?.verified) return run;
      const escrow = await this.sui.fields(run.escrow_id);
      const funded = amount(escrow.bond) === BigInt(candidate.terms.quantity) && amount(escrow.cash) === BigInt(candidate.terms.net_cash_base);
      const tx = settlementTransaction(this.config, candidate, run.agreement_id, run.escrow_id);
      if (!funded) {
        if (!probe) throw new DomainError('ESCROW_NOT_FUNDED', 'Both legs must be fully funded. TradeBridge refused to sign this settlement.', 409);
        const call = { target: `${this.config.package_id}::settlement::settle`, typeArguments: [this.config.bond_type, this.config.cash_type], objects: [{ id: this.config.registry_id, mutable: false }, { id: run.agreement_id, mutable: false }, { id: run.escrow_id, mutable: true }, { id: '0x6', mutable: false }] };
        this.record(principal, fresh, run, 'settle_probe', await this.sui.probe('operator', call), true);
        return run;
      }
      if (probe) throw new DomainError('PROBE_NOT_NEEDED', 'The escrow is fully funded; settle it instead.', 409);
      const execution = this.record(principal, fresh, run, 'settle', await this.sui.execute('operator', tx));
      const verdict = verifySettlementEffects(this.config, candidate, { digest: execution.digest, agreement_id: run.agreement_id, escrow_id: run.escrow_id }, await this.sui.settlementEffects(execution.digest));
      run.settlement = { status: verdict.status, verified: verdict.verified, digest: execution.digest };
      this.store.saveChainRun(fresh.tenant, fresh.id, run.version, run);
      this.store.audit(principal, fresh.id, verdict.verified ? 'SETTLEMENT_CONFIRMED' : 'SETTLEMENT_UNVERIFIED', this.now(), { digest: execution.digest, status: verdict.status, version: run.version });
      return run;
    });
  }

  async state(trade: Trade) {
    const { candidate, run } = this.current(trade);
    const explorer = (kind: 'tx' | 'object' | 'account', id: string | null) => id ? this.sui.explorer(kind, id) : null;
    const parties = Object.fromEntries((['buyer', 'broker', 'operator'] as const).map(s => [s, { address: this.sui.address(s), url: explorer('account', this.sui.address(s)) }]));
    let escrow = null;
    if (run?.escrow_id && candidate) {
      const fields = await this.sui.fields(run.escrow_id);
      escrow = { bond: { funded: amount(fields.bond).toString(), required: candidate.terms.quantity }, cash: { funded: amount(fields.cash).toString(), required: candidate.terms.net_cash_base }, settled: Boolean(fields.settled), cancelled: Boolean(fields.cancelled) };
    }
    return {
      network: 'testnet', chain_id: this.config.chain_id, package_id: this.config.package_id, package_url: explorer('object', this.config.package_id), parties,
      version: candidate?.version ?? null, intent_id: run?.intent_id ?? null, agreement_id: run?.agreement_id ?? null, agreement_url: explorer('object', run?.agreement_id ?? null),
      escrow_id: run?.escrow_id ?? null, escrow_url: explorer('object', run?.escrow_id ?? null), escrow, settlement: run?.settlement ?? null,
      steps: (run?.steps ?? []).map(s => ({ ...s, url: explorer('tx', s.digest) })),
    };
  }
}
