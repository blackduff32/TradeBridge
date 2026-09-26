import { DomainError, type Principal } from './domain.js';
import type { StaffAuthority } from './consent.js';

/**
 * Development-only staff authority backed by the static TRADEBRIDGE_PRINCIPALS roster.
 *
 * This answers exactly one question: "is this still a configured human account?" It has no
 * connection to HR systems, no revocation workflow, and no notion of role changes over time.
 * It exists so the two-approval path can be exercised end to end in development. A real
 * deployment must replace it with an adapter backed by actual staff/IdP records before it
 * handles anything that isn't a demo.
 */
export class DevelopmentStaffDirectory implements StaffAuthority {
  constructor(private principals: Principal[]) {}
  resolve(tenant: string, account: string): Principal | undefined {
    return this.principals.find(p => p.tenant === tenant && p.id === account);
  }
  async assertCurrent(principal: Principal): Promise<void> {
    const current = this.resolve(principal.tenant, principal.id);
    if (!current || current.kind !== 'human') throw new DomainError('STAFF_AUTHORITY_REVOKED', 'This account no longer has current staff authority.', 403);
  }
}
