import { canonicalJson, DomainError, sha256, type Principal } from './domain.js';
import type { Store } from './store.js';
import type { Challenge, HumanTrustBoundary, WorldConfig } from './world-id.js';

/**
 * Production trust adapter. It turns a verified World ID proof into two separate, honest facts:
 *
 * 1. Presence — did the World App confirm a fresh, live user-presence check for *this* request?
 *    If the deployment does not require presence yet, this says so plainly; it never fabricates
 *    a presence claim that did not happen.
 * 2. Enrollment — is this the same verified person who has always operated this TradeBridge
 *    account for this credential scope? First use binds the account to that person; a different
 *    person on the same account, or the same person on a second account, is rejected by
 *    Store.bindEnrollment (ENROLLMENT_MISMATCH / IDENTITY_ALREADY_ENROLLED).
 */
export class WorldHumanTrust implements HumanTrustBoundary {
  constructor(private store: Store, private config: WorldConfig, private now: () => Date = () => new Date()) {}

  async validatePresence(proof: unknown, providerReceipt: unknown, challenge: Challenge): Promise<string> {
    if (!this.config.require_presence) return `presence-not-requested:${this.config.environment}`;
    const completed = typeof proof === 'object' && proof !== null && (proof as { user_presence_completed?: unknown }).user_presence_completed === true;
    if (!completed) throw new DomainError('HUMAN_TRUST_CHECK_FAILED', 'Fresh World App presence was required but the proof does not confirm it.', 403);
    const reference = sha256(canonicalJson({ receipt: providerReceipt, signal: challenge.signal }));
    return `world-app:user-presence:${reference}`;
  }

  async validateEnrollment(principal: Principal, scope: string, nullifier: string): Promise<string> {
    const binding = sha256(`tradebridge:person:v1\n${scope}\n${nullifier}`);
    this.store.bindEnrollment(principal.tenant, principal.id, scope, binding, this.now());
    return binding;
  }
}
