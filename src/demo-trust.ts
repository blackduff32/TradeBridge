import { canonicalJson, DomainError, sha256, type Principal } from './domain.js';
import type { StaffAuthority } from './consent.js';
import type { HumanTrustBoundary, WorldConfig } from './world-id.js';

/**
 * DEMO ONLY. Stands in for the two production adapters TradeBridge does not have yet, so a staging
 * World ID app can complete the approval path. It is opt-in (TRADEBRIDGE_DEMO_APPROVERS), refuses
 * any World environment but staging, and the API labels it wherever it is active.
 * - Staff enrollment: a static roster of exactly one buyer and one broker approver account. A real
 *   deployment checks the organisation's directory and a verified account-to-World ID binding.
 * - Fresh presence: IDKit reports `user_presence_completed` inside the client-submitted proof, and
 *   World's verify response carries no signed presence result, so this accepts the reported flag.
 */
export function demoTrust(principals: Principal[], raw: string, world: WorldConfig | undefined) {
  if (!world) throw new Error('TRADEBRIDGE_DEMO_APPROVERS needs a World ID app: set WORLD_APP_ID, WORLD_RP_ID and WORLD_SIGNING_KEY.');
  if (world.environment !== 'staging') throw new Error('The demo trust boundary only runs with WORLD_ENVIRONMENT=staging.');
  const roster = raw.split(',').map(id => id.trim()).filter(Boolean).map(id => {
    const matches = principals.filter(p => p.id === id);
    if (matches.length !== 1 || matches[0]!.kind !== 'human') throw new Error(`Demo approver ${id} must name exactly one human principal.`);
    return matches[0]!;
  });
  if (roster.length !== 2 || roster.filter(p => p.side === 'buyer').length !== 1 || roster.filter(p => p.side === 'broker').length !== 1) {
    throw new Error('TRADEBRIDGE_DEMO_APPROVERS must list exactly one buyer and one broker human approver.');
  }
  const enrolled = (p: Principal) => p.kind === 'human' && roster.some(r => r.tenant === p.tenant && r.id === p.id && r.side === p.side && r.organisation === p.organisation);
  const requireEnrolled = (p: Principal) => { if (!enrolled(p)) throw new DomainError('STAFF_NOT_ENROLLED', 'This account is not an enrolled approver.', 403); };
  const staffAuthority: StaffAuthority = {
    async assertCurrent(principal) { requireEnrolled(principal); },
    resolve: (tenant, account) => roster.find(r => r.tenant === tenant && r.id === account),
  };
  const humanTrust: HumanTrustBoundary = {
    async validatePresence(proof, _receipt, challenge) {
      if ((proof as { user_presence_completed?: unknown }).user_presence_completed !== true) throw new DomainError('PRESENCE_NOT_REPORTED', 'The proof does not report a completed presence check.', 403);
      return `demo-client-reported:${sha256(canonicalJson({ challenge: challenge.id, nonce: challenge.nonce }))}`;
    },
    async validateEnrollment(principal, scope, nullifier) {
      requireEnrolled(principal);
      return `person:${sha256(`${scope}\n${nullifier}`)}`;
    },
  };
  return { staffAuthority, humanTrust, approvers: roster.map(p => ({ id: p.id, side: p.side })) };
}
