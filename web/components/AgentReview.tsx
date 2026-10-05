import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ExternalLink, Fingerprint, X } from 'lucide-react';
import { api, errorMessage, type Trade } from '../api';
import { amount } from '../format';
import { Button, Notice } from './ui';

// Economic fields a proposal can change, with their display decimals.
const FIELDS = [['quantity', 'Quantity', 0], ['unit_price_base', 'Unit price', 2], ['accrued_interest_base', 'Accrued interest', 2], ['fees_base', 'Fees', 2], ['net_cash_base', 'Net payment', 2]] as const;
// Model replies may use Markdown emphasis; the notice shows plain text.
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

// Mirrors the safe (non-secret) fields src/world-agents.ts's safeView() returns. device_code, client
// credentials and raw World ID tokens never appear here — the server keeps those.
interface SafeAuthorization {
  id: string; trade_id: string; side: 'buyer' | 'broker'; state: string; reason: string;
  envelope: { changed_fields: string[]; proposed_fix: Record<string, string> };
  created_at: string; human_account: string | null; agent_account: string;
  user_code: string | null; verification_uri: string | null; verification_uri_complete: string | null;
  expires_in: number | null; interval: number | null;
  decided_at: string | null; candidate_version: number | null; failure_reason: string | null;
}
interface AuthorizationsResponse { idp_configured: boolean; authorizations: SafeAuthorization[] }
interface AgentRunResult { text?: string; status?: string }

const STATUS_LABEL: Record<string, string> = {
  PENDING_HUMAN: 'Awaiting your World ID authorization', AUTHORIZED: 'Authorized with World ID',
  DENIED: 'Denied', EXPIRED: 'Expired', FAILED: 'Could not be authorized', CANCELLED: 'Cancelled',
};
const STATUS_CLASS: Record<string, string> = { PENDING_HUMAN: 'status-warning', AUTHORIZED: 'status-ready' };

export function AgentReview({ trade, side, kind, configured, hosted, onSaved }: { trade: Trade; side: 'buyer' | 'broker'; kind: string; configured: boolean; hosted: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [runText, setRunText] = useState('');
  const [idpConfigured, setIdpConfigured] = useState(true);
  const [authorizations, setAuthorizations] = useState<SafeAuthorization[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const intent = useRef<{ key: string; revision: number } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refreshAuthorizations = useCallback(async () => {
    try {
      const response = await api<AuthorizationsResponse>(`/trades/${trade.id}/agent-authorizations`);
      setIdpConfigured(response.idp_configured); setAuthorizations(response.authorizations);
    } catch (e) { setError(errorMessage(e)); }
  }, [trade.id]);
  useEffect(() => { void refreshAuthorizations(); }, [refreshAuthorizations, trade.revision]);

  // Polling with backoff: each response carries the interval to wait before the next attempt (World's own
  // interval, extended on slow_down). Only the side's human can poll or cancel; that is enforced server-side too.
  const schedulePoll = useCallback((authorization: SafeAuthorization) => {
    if (timers.current[authorization.id]) return;
    timers.current[authorization.id] = setTimeout(async () => {
      delete timers.current[authorization.id];
      try {
        const updated = await api<SafeAuthorization>(`/trades/${trade.id}/agent-authorizations/${authorization.id}/poll`, { method: 'POST' });
        setAuthorizations(previous => previous.map(item => item.id === updated.id ? updated : item));
        if (updated.state === 'AUTHORIZED') await onSaved();
        if (updated.state === 'PENDING_HUMAN') schedulePoll(updated);
      } catch (e) { setActionError(previous => ({ ...previous, [authorization.id]: errorMessage(e) })); }
    }, Math.max(1, authorization.interval ?? 5) * 1000);
  }, [trade.id, onSaved]);
  useEffect(() => {
    if (kind === 'human') { for (const authorization of authorizations) if (authorization.state === 'PENDING_HUMAN' && authorization.side === side) schedulePoll(authorization); }
    const activeTimers = timers.current;
    return () => { for (const id of Object.keys(activeTimers)) { clearTimeout(activeTimers[id]); delete activeTimers[id]; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizations.map(a => `${a.id}:${a.state}:${a.interval}`).join('|'), side, kind, schedulePoll]);

  async function dispatch() {
    intent.current ??= { key: crypto.randomUUID(), revision: trade.revision };
    setBusy(true); setError(''); setRunText('');
    try {
      const response = await api<AgentRunResult>(`/trades/${trade.id}/agent-runs`, { method: 'POST', key: intent.current.key, body: { expected_revision: intent.current.revision }, timeout: 195_000 });
      setRunText(response.text || response.status || ''); intent.current = null;
      await refreshAuthorizations();
    } catch (e) { setError(errorMessage(e)); } finally { await onSaved(); setBusy(false); }
  }
  async function cancel(id: string) {
    setActionBusy(id); setActionError(previous => ({ ...previous, [id]: '' }));
    try {
      const updated = await api<SafeAuthorization>(`/trades/${trade.id}/agent-authorizations/${id}/cancel`, { method: 'POST' });
      setAuthorizations(previous => previous.map(item => item.id === updated.id ? updated : item));
    } catch (e) { setActionError(previous => ({ ...previous, [id]: errorMessage(e) })); } finally { setActionBusy(null); }
  }

  const blocked = !configured ? (hosted ? 'The hosted demo makes no model calls. Agent runs need a server-side OpenAI key in the local app.' : 'Set OPENAI_API_KEY and TRADEBRIDGE_MODEL on the server to enable agent runs.')
    : !trade.sources.buyer || !trade.sources.broker ? 'Both source records are needed first.'
    : trade.canonical ? 'A correction is already staged for this trade.' : '';
  return <section className="panel"><header className="panel-heading"><div><h2>Agent review</h2><p>{configured ? "Your scoped agent can inspect evidence and propose terms. A human authorizes any draft with World ID before it becomes a candidate." : 'Connect a model provider to enable buyer and broker agents.'}</p></div><Bot size={21} /></header><div className="agreement-content">
    <Button disabled={Boolean(blocked)} busy={busy} onClick={() => void dispatch()}><Bot size={16} />Ask {side} agent to propose a fix</Button>
    {blocked && <p className="demo-caption">{blocked}</p>}
    {!blocked && !idpConfigured && <p className="demo-caption">Connect World ID for Agents (WORLD_IDP_CLIENT_ID) so a human can authorize the agent's drafts.</p>}
    {!blocked && idpConfigured && <p className="demo-caption">Sends this trade's scoped evidence to the configured model provider. The agent can only draft a proposal — it can never approve, fund or settle.</p>}
    {runText && <Notice>{plain(runText)}</Notice>}{error && <Notice error>{error}</Notice>}
    {authorizations.length > 0 && <ol className="agent-authorizations">{authorizations.map(authorization => {
      // A proposal is reviewed against the other side's book, so show what it would change there.
      const counterparty = authorization.side === 'buyer' ? 'broker' : 'buyer';
      const theirs = trade.sources[counterparty]?.record as Record<string, string> | undefined;
      const changes = FIELDS.filter(([field]) => authorization.envelope.proposed_fix[field] !== undefined && authorization.envelope.proposed_fix[field] !== theirs?.[field]);
      const mine = kind === 'human' && authorization.side === side;
      return <li key={authorization.id} className="agent-authorization">
        <header><strong>{authorization.side === 'buyer' ? 'Buyer' : 'Broker'} agent proposal</strong><span className={STATUS_CLASS[authorization.state] ?? 'status-neutral'}>{STATUS_LABEL[authorization.state] ?? authorization.state}</span></header>
        {changes.length > 0 && <dl className="terms-list">{changes.map(([field, label, decimals]) => <div key={field}><dt>{label}</dt><dd>{counterparty === 'buyer' ? 'Buyer' : 'Broker'} book {amount(theirs?.[field], decimals)} → {amount(authorization.envelope.proposed_fix[field], decimals)}</dd></div>)}</dl>}
        <p className="demo-caption">{authorization.reason}</p>
        {authorization.state === 'PENDING_HUMAN' && (authorization.user_code ? <>
          <code className="agent-authorization-code">{authorization.user_code}</code>
          {authorization.expires_in != null && <small>Code expires in {Math.max(0, Math.round(authorization.expires_in / 60))} min</small>}
          {authorization.verification_uri_complete && <p><a href={authorization.verification_uri_complete} target="_blank" rel="noreferrer"><Fingerprint size={14} />Open World ID authorization <ExternalLink size={14} /></a></p>}
          {mine && <Button kind="ghost" busy={actionBusy === authorization.id} onClick={() => void cancel(authorization.id)}><X size={14} />Cancel</Button>}
        </> : <p className="demo-caption">{idpConfigured ? 'Starting World ID authorization…' : 'Connect World ID for Agents to authorize this draft.'}</p>)}
        {authorization.state === 'AUTHORIZED' && <p className="demo-caption">Saved as candidate v{authorization.candidate_version}. Both sides must still approve it with World ID before it can be committed.</p>}
        {(authorization.state === 'DENIED' || authorization.state === 'EXPIRED' || authorization.state === 'FAILED' || authorization.state === 'CANCELLED') && <p className="demo-caption">No candidate was created.{authorization.failure_reason ? ` (${authorization.failure_reason})` : ''}</p>}
        {actionError[authorization.id] && <Notice error>{actionError[authorization.id]}</Notice>}
      </li>;
    })}</ol>}
  </div></section>;
}
