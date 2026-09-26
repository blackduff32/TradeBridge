import { z } from 'zod';
import type { Principal } from './domain.js';

const principalSchema = z.strictObject({
  id: z.string().min(1), tenant: z.string().min(1), organisation: z.string().min(1),
  side: z.enum(['buyer', 'broker']), kind: z.enum(['agent', 'human']),
  tradeIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)).min(1), token: z.string().min(32),
});
export function readPrincipals(raw: string | undefined): Principal[] {
  if (!raw) throw new Error('Missing TRADEBRIDGE_PRINCIPALS. Run npm run setup to create local development credentials.');
  const principals = z.array(principalSchema).min(1).parse(JSON.parse(raw));
  if (new Set(principals.map(p => p.token)).size !== principals.length || new Set(principals.map(p => `${p.tenant}:${p.id}`)).size !== principals.length) {
    throw new Error('Principal tokens and tenant/account pairs must be unique.');
  }
  return principals;
}
