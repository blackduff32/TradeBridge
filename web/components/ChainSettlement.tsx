import { useState } from 'react';
import { ArrowUpRight, Check, CircleDashed, Layers3, ShieldAlert } from 'lucide-react';
import { api, errorMessage, type ChainLeg, type ChainState, type Session, type Trade } from '../api';
import { amount } from '../format';
import { Button, Notice } from './ui';

const labels: Record<string, string> = {
  propose: 'Intent proposed', attest: 'Both World ID approvals attested', approve_buyer: 'Buyer approved on-chain', approve_broker: 'Broker approved on-chain',
  commit: 'Immutable agreement committed', deposit_cash: 'Cash leg funded', deposit_bond: 'Bond leg delivered', settle_probe: 'Contract rejected underfunded settlement', settle: 'Settled atomically',
};
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-6)}`;
const full = (leg: ChainLeg) => BigInt(leg.funded) >= BigInt(leg.required);
function Explorer({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <a className="explorer-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} /></a> : <>{children}</>;
}

export function ChainSettlement({ trade, chain, session, approvals, onChanged }: { trade: Trade; chain: ChainState; session: Session; approvals?: Record<string, string>; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const principal = session.principal;
  const human = principal?.kind === 'human';
  const approved = (side: string) => ['HUMAN_APPROVED', 'CONSUMED'].includes(approvals?.[side] ?? '');
  const legs = chain.escrow;
  const settled = Boolean(chain.settlement?.verified || legs?.settled);
  const funded = Boolean(legs && full(legs.bond) && full(legs.cash));
  const partial = Boolean(legs && !funded && (BigInt(legs.bond.funded) > 0n || BigInt(legs.cash.funded) > 0n));
  const ownLeg = principal?.side === 'buyer' ? legs?.cash : legs?.bond;
  const signer = (address: string) => address === chain.parties.buyer.address ? 'buyer' : address === chain.parties.broker.address ? 'broker' : 'verifier';
  async function act(label: string, path: string, body: unknown = {}) {
    setBusy(label); setError('');
    try { await api(`/trades/${trade.id}/${path}`, { method: 'POST', body, timeout: 120_000 }); } catch (e) { setError(errorMessage(e)); } finally { await onChanged(); setBusy(''); }
  }
  const leg = (name: string, value: ChainLeg, decimals: number, unit: string, from: string) => {
    const pct = settled ? 100 : Number((BigInt(value.funded) * 100n) / BigInt(value.required));
    return <div className="escrow-leg"><div><span>{name}</span><strong>{settled ? `${amount(value.required, decimals)} paid out` : `${amount(value.funded, decimals)} / ${amount(value.required, decimals)}`} {unit}</strong></div><div className="leg-bar" role="progressbar" aria-label={`${name} funding`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} className={settled ? 'settled' : ''} /></div><small>{from}</small></div>;
  };
  return <section className="panel chain-panel" aria-labelledby="chain-title">
    <header className="panel-heading"><div><h2 id="chain-title">Settlement on Sui</h2><p><span className="live-dot" />Sui {chain.network} · package <Explorer href={chain.package_url}>{short(chain.package_id)}</Explorer></p></div><Layers3 size={21} /></header>
    <div className="chain-parties">{(['buyer', 'broker', 'operator'] as const).map(role => <div key={role}><span>{role === 'operator' ? 'Verifier service' : `${role[0]!.toUpperCase()}${role.slice(1)} wallet`}</span><Explorer href={chain.parties[role].url}><code>{short(chain.parties[role].address)}</code></Explorer></div>)}</div>
    {legs && <div className="escrow-legs">
      {leg('Cash leg', legs.cash, 2, 'DEMOUSD', settled ? 'Paid to the broker' : 'Buyer → escrow')}
      {leg('Bond leg', legs.bond, 0, 'DEMOBOND', settled ? 'Delivered to the buyer' : 'Broker → escrow')}
    </div>}
    {chain.steps.length > 0 ? <ol className="chain-steps">{chain.steps.map(step => <li key={step.digest} className={step.success ? 'ok' : 'rejected'}>
      {step.success ? <Check size={15} /> : <ShieldAlert size={15} />}
      <div><strong>{labels[step.key] ?? step.key}</strong>{!step.success && step.error && <small>{step.expected_failure ? `Expected: ${step.error}` : step.error}</small>}</div>
      <span className="signer-tag">{signer(step.signer)}</span>
      <Explorer href={step.url}><code>{short(step.digest)}</code></Explorer>
    </li>)}</ol> : <p className="chain-empty"><CircleDashed size={15} />Nothing is on-chain yet. Both humans must approve the same version first.</p>}
    {settled && chain.settlement && <Notice>Settled in one transaction and verified from finalized effects: the bond reached the buyer and the cash reached the broker, or neither would have moved.</Notice>}
    {error && <Notice error>{error}</Notice>}
    {human && !settled && <div className="chain-actions">
      {!chain.agreement_id && <Button kind="primary" className="full" busy={busy === 'commit'} disabled={!approved('buyer') || !approved('broker') || Boolean(busy)} onClick={() => void act('commit', 'agreement-commitments')}>{approved('buyer') && approved('broker') ? 'Commit agreement on Sui' : 'Awaiting both World ID approvals'}</Button>}
      {chain.agreement_id && ownLeg && !full(ownLeg) && <Button kind="primary" className="full" busy={busy === 'fund'} disabled={Boolean(busy)} onClick={() => void act('fund', 'funding-intents')}>{principal?.side === 'buyer' ? `Fund cash leg · ${amount(ownLeg.required, 2)} DEMOUSD` : `Deliver bond leg · ${amount(ownLeg.required)} DEMOBOND`}</Button>}
      {chain.agreement_id && funded && <Button kind="primary" className="full" busy={busy === 'settle'} disabled={Boolean(busy)} onClick={() => void act('settle', 'settlement-instructions')}>Settle both legs atomically</Button>}
      {partial && <Button className="full" busy={busy === 'probe'} disabled={Boolean(busy)} onClick={() => void act('probe', 'settlement-instructions', { onchain_probe: true })}>Prove the contract refuses a half-funded settlement</Button>}
      {chain.agreement_id && ownLeg && full(ownLeg) && !funded && <p className="chain-empty"><Check size={15} />Your leg is in escrow. Waiting for the counterparty.</p>}
    </div>}
  </section>;
}
