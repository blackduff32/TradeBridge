import type { Candidate, Economics, Trade } from '../src/domain';
export type { Candidate, Economics, Trade };
export interface Session { principal: { id: string; kind: 'human' | 'agent'; side: 'buyer' | 'broker'; organisation: string; tradeIds: string[] } | null; demo?: boolean; demo_available?: boolean; hosted?: boolean }
export interface Difference { field: string; buyer: string; broker: string; code: string; delta: string | null }
export interface Reconciliation { status: string; differences: Difference[]; revision: number; candidate: Candidate | null; canonical: Candidate | null; commitment_status: string | null; chain_evidence: null; approvals: Record<string, string>; limitations: string[] }
export interface WorldStatus { configured: boolean; approvals_ready: boolean; trust: 'demo_static_roster' | null; environment: 'staging' | 'production' | null }
export interface Integrations { world_id: WorldStatus; agents: { configured: boolean; world_id_for_agents?: boolean }; sui: { deployed: boolean; network: string; package_id: string | null } }
export interface AuditEvent { sequence: number; actor: string; action: string; at: string; detail: { version?: number; terms_hash?: string; side?: string; source_id?: string } }
export interface ChainStep { key: string; digest: string; success: boolean; error: string | null; signer: string; checkpoint: string | null; at: string; expected_failure?: boolean; url: string | null }
export interface ChainLeg { funded: string; required: string }
export interface ChainState {
  network: string; chain_id: string; package_id: string; package_url: string | null;
  parties: Record<'buyer' | 'broker' | 'operator', { address: string; url: string | null }>;
  version: number | null; intent_id: string | null; agreement_id: string | null; agreement_url: string | null;
  escrow_id: string | null; escrow_url: string | null; escrow: { bond: ChainLeg; cash: ChainLeg; settled: boolean; cancelled: boolean } | null;
  settlement: { status: string; verified: boolean; digest: string } | null; steps: ChainStep[];
}
export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal; timeout?: number } = {}): Promise<T> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? 15_000)]) : AbortSignal.timeout(options.timeout ?? 15_000);
  const response = await fetch('/api' + path, {
    method: options.method ?? 'GET', credentials: 'same-origin', signal,
    headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error, data.message ?? data.issues?.map((i: { message: string }) => i.message).join(' ') ?? 'Check the request and try again.', response.status);
  return data as T;
}
export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return `${error.message} (${error.code})`;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'The response timed out. The outcome may be unknown. Refresh to check, or retry the same request.';
  return 'Could not reach TradeBridge. Your inputs are preserved. Check the connection and retry.';
}
