import { randomUUID } from 'node:crypto';
import { hashSignal } from '@worldcoin/idkit-core';
import { signRequest } from '@worldcoin/idkit-server';
import { z } from 'zod';
import { canonicalJson, DomainError, sha256, type Candidate, type Principal } from './domain.js';
import type { Store } from './store.js';

export const worldConfigSchema = z.strictObject({
  app_id: z.string().regex(/^app_[a-zA-Z0-9]+$/), rp_id: z.string().regex(/^rp_[a-zA-Z0-9]+$/),
  // Prefix only. Each candidate version gets its own action; see approvalAction.
  action: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), signing_key: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
  environment: z.enum(['production', 'staging']),
  // Fresh presence: when the World App confirms it, WorldHumanTrust records an honest boundary
  // reference; when a deployment cannot require it yet, it must say so rather than pretend it happened.
  require_presence: z.boolean().default(true),
  // Staging-only escape hatch. The public simulator issues every 4.0 proof from one shared test
  // identity, so it cannot demonstrate two distinct humans. Legacy (3.0) proofs, requested against
  // two different simulator test identities, are the only way to rehearse the two-approver flow
  // without a live World App and two phones. Never valid outside staging.
  allow_legacy_simulator: z.boolean().default(false),
  // Reported by a sibling project, not in World's docs yet: World's verify API accepts staging
  // proofs only inside a 24-hour staging verification window, opened in the Developer Portal. Its
  // one-time token is sent as x-staging-verification-token. Production proofs need no window.
  staging_verification_token: z.string().min(1).optional(),
}).superRefine((config, ctx) => {
  if (config.allow_legacy_simulator && config.environment !== 'staging') {
    ctx.addIssue({ code: 'custom', path: ['allow_legacy_simulator'], message: 'The legacy simulator path can only be enabled in the staging environment.' });
  }
  if (config.staging_verification_token && config.environment !== 'staging') {
    ctx.addIssue({ code: 'custom', path: ['staging_verification_token'], message: 'A staging verification token only applies to the staging environment.' });
  }
});
export type WorldConfig = z.infer<typeof worldConfigSchema>;
/** Reads the server-only World ID configuration from the environment. Returns undefined when WORLD_APP_ID is unset. */
export function worldConfigFromEnv(env: NodeJS.ProcessEnv): WorldConfig | undefined {
  if (!env.WORLD_APP_ID) return undefined;
  return worldConfigSchema.parse({
    app_id: env.WORLD_APP_ID, rp_id: env.WORLD_RP_ID, action: env.WORLD_ACTION ?? 'tradebridge-approval', signing_key: env.WORLD_SIGNING_KEY,
    environment: env.WORLD_ENVIRONMENT ?? 'staging', require_presence: (env.WORLD_REQUIRE_PRESENCE ?? 'true') !== 'false',
    allow_legacy_simulator: (env.WORLD_ALLOW_LEGACY_SIMULATOR ?? 'false') === 'true',
    ...(env.WORLD_STAGING_VERIFICATION_TOKEN ? { staging_verification_token: env.WORLD_STAGING_VERIFICATION_TOKEN } : {}),
  });
}
/** Short label describing the active trust posture, for UI and /integrations limitations reporting only. */
export function worldTrustMode(config: WorldConfig): 'world-app-presence' | 'presence-not-requested' | 'staging-legacy-simulator' {
  if (config.allow_legacy_simulator) return 'staging-legacy-simulator';
  return config.require_presence ? 'world-app-presence' : 'presence-not-requested';
}
// World ID 4.0 uniqueness proofs are one-time per person per action, and repeating one action
// for recurring checks is a documented anti-pattern. One action per exact candidate means each
// person can prove once per version, and buyer and broker nullifiers share one comparable scope.
export function approvalAction(prefix: string, candidate: Candidate) {
  return `${prefix}-${sha256(canonicalJson({ tenant: candidate.terms.tenant, trade: candidate.terms.trade_id, version: candidate.version, terms_hash: candidate.terms_hash })).slice(0, 32)}`;
}
export interface Challenge {
  id: string; tenant: string; account: string; organisation: string; side: string; action: string;
  trade_id: string; version: number; terms_hash: string; signal: string; signal_hash: string;
  nonce: string; created_at: number; expires_at: number; rp_expires_at: number; signature: string;
  state: 'ISSUED' | 'VERIFYING' | 'VERIFIED' | 'FAILED' | 'CONSENT_RECORDED';
}
export interface VerifiedHuman {
  challenge_id: string; receipt_hash: string; person_binding: string; presence_reference: string;
  verified_at: string; expires_at: string; identity_scope: string;
}
// Implementations must validate evidence from a supported, authenticated provider path.
// There is no browser flag or development bypass. The server injects WorldHumanTrust
// (human-trust.ts), or the labelled, staging-only demo roster in demo-trust.ts when configured.
export interface HumanTrustBoundary {
  validatePresence(proof: unknown, providerReceipt: unknown, challenge: Challenge): Promise<string>;
  validateEnrollment(principal: Principal, scope: string, nullifier: string): Promise<string>;
}
const proofResponseV4 = z.object({
  identifier: z.literal('proof_of_human'), signal_hash: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
  nullifier: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/), proof: z.array(z.string()).length(5),
  issuer_schema_id: z.literal(1), expires_at_min: z.number().int().positive(),
}).passthrough();
// World ID 3.0 (legacy) shape, per IDKitResultV3 / ResponseItemV3 in @worldcoin/idkit-core 4.3.0: a
// single ABI-encoded proof string plus a merkle_root, instead of the 4.0 five-element proof array;
// no issuer_schema_id or expires_at_min; action and user_presence_completed are optional there too.
const proofResponseV3 = z.object({
  identifier: z.literal('proof_of_human'), signal_hash: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
  proof: z.string().min(1), merkle_root: z.string().min(1), nullifier: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
}).passthrough();
const proofV4Schema = z.object({
  protocol_version: z.literal('4.0'), action: z.string(), environment: z.enum(['production', 'staging']),
  nonce: z.string(), user_presence_completed: z.boolean().optional(), responses: z.array(proofResponseV4).length(1),
}).passthrough();
const proofV3Schema = z.object({
  protocol_version: z.literal('3.0'), action: z.string().optional(), environment: z.enum(['production', 'staging']),
  nonce: z.string(), user_presence_completed: z.boolean().optional(), responses: z.array(proofResponseV3).length(1),
}).passthrough();
const proofSchema = z.discriminatedUnion('protocol_version', [proofV4Schema, proofV3Schema]);
const receiptSchema = z.object({
  // The verify API's own docs are inconsistent about echoing environment/action back; tolerate
  // their absence but never a mismatch when present, and always cross-check the nullifier, which
  // is never optional.
  success: z.literal(true), environment: z.enum(['production', 'staging']).optional(), action: z.string().optional(),
  results: z.array(z.object({ identifier: z.literal('proof_of_human'), success: z.literal(true), nullifier: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/) }).passthrough()).length(1),
}).passthrough();

export class WorldIdService {
  constructor(private store: Store, readonly config: WorldConfig, private trust?: HumanTrustBoundary, private request: typeof fetch = fetch, private now: () => Date = () => new Date()) {}
  begin(principal: Principal, candidate: Candidate): Challenge {
    if (principal.kind !== 'human') throw new DomainError('AGENT_AUTHORITY_DENIED', 'Only a human account can request World ID verification.', 403);
    if (!principal.tradeIds.includes(candidate.terms.trade_id) || principal.tenant !== candidate.terms.tenant) throw new DomainError('NOT_FOUND', 'Candidate is outside your scope.', 404);
    const action = approvalAction(this.config.action, candidate);
    const signed = signRequest({ signingKeyHex: this.config.signing_key, action, ttl: 300 });
    const expiry = Math.min(signed.expiresAt, Math.floor(Date.parse(candidate.terms.expires_at) / 1000));
    if (expiry <= this.now().getTime() / 1000) throw new DomainError('TRADE_EXPIRED', 'Candidate has expired.', 409);
    const id = randomUUID();
    const signal = sha256(canonicalJson({ id, tenant: principal.tenant, account: principal.id, organisation: principal.organisation, side: principal.side, action, trade: candidate.terms.trade_id, version: candidate.version, terms_hash: candidate.terms_hash, chain: candidate.terms.chain_id, package: candidate.terms.package_id, registry: candidate.terms.registry_id, nonce: signed.nonce, expires: expiry, environment: this.config.environment }));
    const challenge: Challenge = { id, tenant: principal.tenant, account: principal.id, organisation: principal.organisation, side: principal.side, action, trade_id: candidate.terms.trade_id, version: candidate.version, terms_hash: candidate.terms_hash, signal, signal_hash: hashSignal(signal), nonce: signed.nonce, created_at: signed.createdAt, expires_at: expiry, rp_expires_at: signed.expiresAt, signature: signed.sig, state: 'ISSUED' };
    this.store.saveChallenge(challenge.id, principal.tenant, challenge);
    return challenge;
  }
  publicRequest(challenge: Challenge) {
    return { challenge_id: challenge.id, app_id: this.config.app_id, action: challenge.action, action_description: `Approve ${challenge.trade_id} version ${challenge.version} as ${challenge.side}`, environment: this.config.environment, signal: challenge.signal, require_user_presence: this.config.require_presence, allow_legacy_proofs: this.config.allow_legacy_simulator, rp_context: { rp_id: this.config.rp_id, nonce: challenge.nonce, created_at: challenge.created_at, expires_at: challenge.rp_expires_at, signature: challenge.signature }, expires_at: new Date(challenge.expires_at * 1000).toISOString(), terms_hash: challenge.terms_hash, version: challenge.version };
  }
  async verify(principal: Principal, challengeId: string, raw: unknown, currentCandidate: () => Candidate | undefined): Promise<VerifiedHuman> {
    const challenge = this.store.getChallenge<Challenge>(challengeId, principal.tenant);
    if (!challenge || challenge.account !== principal.id || challenge.side !== principal.side || principal.kind !== 'human' || challenge.organisation !== principal.organisation || !principal.tradeIds.includes(challenge.trade_id)) throw new DomainError('VERIFICATION_FORBIDDEN', 'Challenge is not authorized for this account.', 403);
    const checkCurrent = () => {
      const current = currentCandidate();
      if (!current || current.terms_hash !== challenge.terms_hash || current.version !== challenge.version) throw new DomainError('STALE_CHALLENGE', 'The trade changed. Both parties need fresh verification.', 409);
      if (this.now().getTime() >= challenge.expires_at * 1000) throw new DomainError('CHALLENGE_EXPIRED', 'Request a fresh verification challenge.', 409);
    };
    checkCurrent();
    const proof = proofSchema.parse(raw);
    const response = proof.responses[0]!;
    if (proof.protocol_version === '3.0' && !(this.config.allow_legacy_simulator && this.config.environment === 'staging')) {
      throw new DomainError('LEGACY_PROOF_NOT_ALLOWED', 'This deployment only accepts current World ID 4.0 proofs.', 400);
    }
    if (this.config.require_presence && proof.user_presence_completed !== true) {
      throw new DomainError('PROOF_CONTEXT_MISMATCH', 'Fresh World App presence was required but this proof does not confirm it.', 400);
    }
    // 4.0 proofs always echo the action; legacy 3.0 proofs may omit it, but never contradict it.
    const actionMismatch = proof.protocol_version === '4.0' ? proof.action !== challenge.action : proof.action !== undefined && proof.action !== challenge.action;
    // Nonces are field elements; World App and the signer may format the same value differently.
    const sameField = (a: string, b: string) => { try { return BigInt(a) === BigInt(b); } catch { return a === b; } };
    // expires_at_min is the minimum credential expiry the proof attests, a request constraint that
    // World App may set to about the moment of proving, not the credential's own expiry. Reject only
    // an attestation that ends before this challenge was issued.
    const attestedUntil = proof.protocol_version === '4.0' ? proof.responses[0]!.expires_at_min : undefined;
    const mismatches = [
      ...(actionMismatch ? ['action'] : []),
      ...(proof.environment !== this.config.environment ? ['environment'] : []),
      ...(!sameField(proof.nonce, challenge.nonce) ? ['nonce'] : []),
      ...(BigInt(response.signal_hash) !== BigInt(challenge.signal_hash) ? ['signal'] : []),
      ...(attestedUntil !== undefined && attestedUntil < challenge.created_at - 60 ? ['credential expiry'] : []),
    ];
    if (mismatches.length) {
      // Public request context only: no nullifier or proof material.
      console.warn(`World ID proof context mismatch (${mismatches.join(', ')}) for challenge ${challenge.id}`, { action: [proof.action, challenge.action], environment: [proof.environment, this.config.environment], nonce: [proof.nonce, challenge.nonce], signal_hash: [response.signal_hash, challenge.signal_hash], expires_at_min: attestedUntil, challenge_created_at: challenge.created_at, now: Math.floor(this.now().getTime() / 1000) });
      throw new DomainError('PROOF_CONTEXT_MISMATCH', `Proof does not match the required challenge and credential policy (${mismatches.join(', ')}).`, 400);
    }
    if (!this.store.claimChallenge(challenge.id, challenge.tenant)) throw new DomainError('CHALLENGE_ALREADY_USED', 'This challenge has already been submitted. Request a new challenge.', 409);
    try {
      const stagingWindow: Record<string, string> = this.config.environment === 'staging' && this.config.staging_verification_token ? { 'x-staging-verification-token': this.config.staging_verification_token } : {};
      const verified = await this.request(`https://developer.world.org/api/v4/verify/${this.config.rp_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...stagingWindow }, body: JSON.stringify(raw), signal: AbortSignal.timeout(12_000) });
      if (verified.status === 403 && this.config.environment === 'staging') {
        const refusal: unknown = await verified.json().catch(() => ({}));
        const code = typeof refusal === 'object' && refusal !== null ? (refusal as { code?: unknown; error?: unknown }).code ?? (refusal as { error?: unknown }).error : undefined;
        if (code === 'environment_not_allowed') throw new DomainError('WORLD_STAGING_WINDOW_CLOSED', 'World accepts staging proofs only while a staging verification window is open. Open one in the Developer Portal and set WORLD_STAGING_VERIFICATION_TOKEN, or use the production app.', 503);
      }
      if (!verified.ok) throw new DomainError('WORLD_ID_FAILED', 'World rejected the proof. Request a fresh challenge.', 400);
      const receipt = receiptSchema.parse(await verified.json());
      if ((receipt.environment !== undefined && receipt.environment !== this.config.environment) || (receipt.action !== undefined && receipt.action !== challenge.action) || BigInt(receipt.results[0]!.nullifier) !== BigInt(response.nullifier)) throw new DomainError('VERIFIER_CONTEXT_MISMATCH', 'World verification response does not match the request.', 400);
      if (!this.trust) throw new DomainError('PRESENCE_AND_ENROLLMENT_UNCONFIRMED', 'The proof is valid, but trusted fresh-presence evidence and organizational enrollment have not been integrated. Approval remains blocked.', 503);
      // 3.0 and 4.0 nullifiers are never comparable identities; scoping by protocol version keeps them apart.
      const scope = `${this.config.rp_id}:${challenge.action}:${this.config.environment}:${proof.protocol_version}`;
      const nullifier = BigInt(response.nullifier).toString();
      const presence = await this.trust.validatePresence(raw, receipt, challenge);
      const person = await this.trust.validateEnrollment(principal, scope, nullifier);
      if (!presence || !person) throw new DomainError('HUMAN_TRUST_CHECK_FAILED', 'Presence and staff enrollment are mandatory.', 403);
      // The same person proving this version's action again yields the same nullifier. The first
      // account it verifies for keeps it, so one person cannot verify for both sides of a version.
      const owner = this.store.claimNullifier(challenge.tenant, challenge.action, nullifier, principal.id, principal.side);
      if (owner.account !== principal.id) throw new DomainError('SAME_PERSON_BOTH_SIDES', `This World ID already verified as the ${owner.side} approver for version ${challenge.version}. Buyer and broker must be two different people.`, 403);
      checkCurrent();
      const result: VerifiedHuman = { challenge_id: challenge.id, receipt_hash: sha256(canonicalJson({ receipt, challenge: challenge.signal, presence })), person_binding: person, presence_reference: presence, identity_scope: scope, verified_at: this.now().toISOString(), expires_at: new Date(Math.min(this.now().getTime() + 900_000, Date.parse(currentCandidate()!.terms.expires_at))).toISOString() };
      this.store.finishChallenge(challenge.id, challenge.tenant, 'VERIFIED', result);
      return result;
    } catch (error) {
      this.store.finishChallenge(challenge.id, challenge.tenant, 'FAILED', null);
      throw error;
    }
  }
}
