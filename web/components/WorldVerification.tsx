import { useRef, useState } from 'react';
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from '@worldcoin/idkit';
import { Fingerprint } from 'lucide-react';
import { api, ApiError, errorMessage, type Trade } from '../api';
import { Button, Notice } from './ui';

interface Request { challenge_id: string; terms_hash: string; app_id: `app_${string}`; action: string; environment: 'production' | 'staging'; signal: string; rp_context: RpContext; require_user_presence: boolean; allow_legacy_proofs: boolean }

// Server-side rejection codes get a specific, actionable message; anything else falls back to errorMessage().
const SERVER_ERRORS: Record<string, string> = {
  DISTINCT_HUMANS_REQUIRED: 'Buyer and broker must be two different verified people. The other side cannot reuse this identity.',
  ENROLLMENT_MISMATCH: 'This TradeBridge account is already bound to a different verified World ID. Sign in as the person originally enrolled, or contact an operator.',
  IDENTITY_ALREADY_ENROLLED: 'This World ID already verified for a different TradeBridge account on this version. Buyer and broker must be two different people.',
  WORLD_STAGING_WINDOW_CLOSED: 'World is not accepting staging proofs because no staging verification window is open. The trade stays blocked.',
  SAME_PERSON_BOTH_SIDES: 'This World ID already verified for the other side of this version. Buyer and broker must be two different people.',
  STALE_CHALLENGE: 'The trade changed since this challenge was issued. Request a fresh verification.',
  CHALLENGE_EXPIRED: 'This verification challenge expired. Request a new one.',
  WORLD_ID_FAILED: 'World rejected the proof. Request a fresh challenge and try again.',
  PROOF_CONTEXT_MISMATCH: 'The proof did not match this exact trade and policy. Request a fresh challenge.',
  VERIFIED_CHALLENGE_REQUIRED: 'A fresh, verified World ID challenge bound to this exact trade is required before approval.',
};
function friendlyError(e: unknown): string {
  if (e instanceof ApiError && SERVER_ERRORS[e.code]) {
    // Keep the server's note on which check failed, such as "(nonce)".
    const detail = e.code === 'PROOF_CONTEXT_MISMATCH' ? /\(([^)]+)\)\.?$/.exec(e.message)?.[1] : undefined;
    return SERVER_ERRORS[e.code]! + (detail ? ` Failed check: ${detail}.` : '');
  }
  return errorMessage(e);
}
// World App-side outcomes (declined, no eligible credential, timed out). Closing the widget without
// finishing raises none of these — that path is handled separately via onOpenChange.
function widgetErrorMessage(code: string): string {
  if (code === 'user_rejected' || code === 'verification_rejected') return 'You declined the verification in World App. The trade stays blocked.';
  if (code === 'credential_unavailable' || code === 'world_id_4_not_available' || code === 'world_id_3_not_available') return 'Your World ID does not have the required Proof of Human credential yet. Verify at an Orb, then retry.';
  if (code === 'timeout') return 'The verification request timed out. Request a new challenge and try again.';
  return 'World ID verification did not complete. The trade remains blocked; request a new challenge to retry.';
}
export default function WorldVerification({ trade, onSaved }: { trade: Trade; onSaved: () => Promise<void> }) {
  const [request, setRequest] = useState<Request | null>(null); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [verified, setVerified] = useState<{ challenge: string; hash: string } | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [consentKey] = useState(() => crypto.randomUUID());
  // Tracks whether the current widget attempt already reached a definite outcome (success or a
  // specific error), so a plain close (no callback fires for that on its own) isn't mislabeled.
  const outcome = useRef<'success' | 'error' | null>(null);
  const latest = trade.candidates.at(-1);
  async function consent(value: 'approve' | 'reject') {
    if (!latest || !verified || verified.hash !== latest.terms_hash) return;
    setBusy(true); setError('');
    try {
      await api(`/trades/${trade.id}/approvals`, { method: 'POST', key: `${consentKey}-${value}`, body: { expected_revision: trade.revision, version: latest.version, terms_hash: latest.terms_hash, challenge_id: verified.challenge, decision: value } });
      setDecision(value); await onSaved();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  if (decision) return <Notice>{decision === 'approve' ? 'Approved. This exact version now has your recorded, verified approval.' : 'You rejected this candidate. A new version needs fresh verification from both sides.'}</Notice>;
  if (verified && verified.hash === latest?.terms_hash) return <>
    <Notice>Human verification complete. Review every approval-bound field in Agreement before deciding.</Notice>
    <Button className="full" kind="primary" busy={busy} onClick={() => void consent('approve')}>Approve this corrected trade</Button>
    <Button className="full" disabled={busy} onClick={() => void consent('reject')}>Reject</Button>
    {error && <Notice error>{error}</Notice>}
  </>;
  return <><Button className="full" disabled={!latest} busy={busy} onClick={async () => {
    if (!latest) return; setBusy(true); setError(''); outcome.current = null;
    try { const result = await api<Request>(`/trades/${trade.id}/verification-challenges`, { method: 'POST', key: crypto.randomUUID(), body: { expected_revision: trade.revision, terms_hash: latest.terms_hash } }); setRequest(result); setOpen(true); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }}><Fingerprint size={16} />Verify with World ID</Button>
    {request && <IDKitRequestWidget open={open} onOpenChange={next => { setOpen(next); if (!next && outcome.current === null) setError('Verification cancelled. The trade stays blocked.'); }} app_id={request.app_id} action={request.action} rp_context={request.rp_context} environment={request.environment} allow_legacy_proofs={request.allow_legacy_proofs} require_user_presence={request.require_user_presence} preset={proofOfHuman({ signal: request.signal })}
      handleVerify={async (proof: IDKitResult) => { try { await api(`/trades/${trade.id}/world-id-verifications`, { method: 'POST', body: { challenge_id: request.challenge_id, proof } }); setVerified({ challenge: request.challenge_id, hash: request.terms_hash }); outcome.current = 'success'; } catch (e) { outcome.current = 'error'; setError(friendlyError(e)); throw e; } }}
      onSuccess={() => { setOpen(false); setError(''); }} onError={code => { outcome.current = 'error'; setError(widgetErrorMessage(code)); }} />}
    {error && <Notice error>{error}</Notice>}
  </>;
}
