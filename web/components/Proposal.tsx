import { useId, useRef, useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api, errorMessage, type Economics, type Trade } from '../api';
import { amount, cashInput } from '../format';
import { Button, Field, Hash, Notice } from './ui';

export function Proposal({ trade, onSaved }: { trade: Trade; onSaved: () => Promise<void> }) {
  const baseline = trade.sources.buyer?.record ?? trade.sources.broker?.record;
  const [quantity, setQuantity] = useState(baseline?.quantity ?? '');
  const [price, setPrice] = useState(baseline ? amount(baseline.unit_price_base, 2).replaceAll(',', '') : '');
  const [reason, setReason] = useState('Align the broker confirmation with the original buyer order.');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [submitted, setSubmitted] = useState(false);
  const intent = useRef<{ signature: string; key: string } | null>(null); const quantityRef = useRef<HTMLInputElement>(null); const id = useId();
  const integer = /^(0|[1-9][0-9]{0,19})$/.test(quantity) && BigInt(quantity) > 0n && BigInt(quantity) <= 18446744073709551615n;
  const priceBase = cashInput(price); const validPrice = priceBase !== null && BigInt(priceBase) > 0n;
  const net = baseline && integer && validPrice ? BigInt(quantity) * BigInt(priceBase!) + BigInt(baseline.accrued_interest_base) + BigInt(baseline.fees_base) : null;
  const latest = trade.candidates.at(-1);
  // Once both humans approve, the correction is staged and further versions are refused server-side.
  if (trade.canonical) return <aside className="panel proposal"><header className="panel-heading"><div><h2>Correction v{trade.canonical.version} approved</h2><p>Both verified humans approved this exact version. New proposals are closed.</p></div></header>
    <section className="latest-proposal" role="status"><strong>Version {trade.canonical.version} · approval-bound terms</strong><p>{amount(trade.canonical.terms.quantity)} units · {amount(trade.canonical.terms.net_cash_base, 2)} DEMOUSD</p><Hash value={trade.canonical.terms_hash} /><small>Original economics remain unchanged.</small></section>
  </aside>;
  return <aside className="panel proposal"><header className="panel-heading"><div><h2>{latest ? 'Propose another version' : 'Propose a correction'}</h2><p>A proposal does not authorize settlement.</p></div></header>
    <form noValidate onSubmit={async event => {
      event.preventDefault(); setSubmitted(true); setError('');
      if (!integer || !validPrice || net === null || net > 18446744073709551615n || reason.trim().length < 10) { setError('Enter positive quantity and price, and a reason of at least 10 characters. Amounts must fit the supported limit.'); quantityRef.current?.focus(); return; }
      if (!trade.sources.buyer || !trade.sources.broker || !baseline) { setError('Import both source records before proposing a correction.'); return; }
      const { account_ref: _a, external_reference: _e, ...base } = baseline;
      const terms: Economics = { ...base, quantity, unit_price_base: priceBase!, net_cash_base: net.toString() };
      const body = { expected_revision: trade.revision, terms, reason: reason.trim() };
      const signature = JSON.stringify(body);
      if (intent.current?.signature !== signature) intent.current = { signature, key: crypto.randomUUID() };
      setBusy(true);
      try { await api(`/trades/${trade.id}/proposals`, { method: 'POST', body, key: intent.current.key }); await onSaved(); intent.current = null; }
      catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
    }}>
      <Field id={`${id}-quantity`} ref={quantityRef} label="Corrected quantity" value={quantity} inputMode="numeric" onChange={e => setQuantity(e.target.value)} error={submitted && !integer ? 'Use a positive whole number.' : undefined} help="DEMOBOND units" />
      <Field id={`${id}-price`} label="Unit price" value={price} inputMode="decimal" onChange={e => setPrice(e.target.value)} error={submitted && !validPrice ? 'Use a positive price with up to two decimal places.' : undefined} help="DEMOUSD per unit" />
      <section className="net-total"><span>Proposed net payment</span><strong>{net === null ? 'Enter terms' : amount(net.toString(), 2)}</strong><small>DEMOUSD · includes fees and interest</small></section>
      <label className="field" htmlFor={`${id}-reason`}><span>Reason for correction</span><textarea className="resize-none" id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} rows={3} style={{ resize: 'none' }} aria-invalid={submitted && reason.trim().length < 10} aria-describedby={`${id}-reason-help`} /><small id={`${id}-reason-help`}>{submitted && reason.trim().length < 10 ? 'Explain the correction in at least 10 characters.' : 'Recorded with this proposed version.'}</small></label>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" kind="primary" busy={busy} className="full">{latest ? `Propose v${latest.version + 1}` : 'Create proposal v2'}<ArrowRight size={16} /></Button>
      <p className="fine-print"><ShieldCheck size={15} />Both authorized humans must verify and approve the same version.</p>
    </form>
    {latest && <section className="latest-proposal" role="status"><strong>Version {latest.version} saved for review</strong><p>{amount(latest.terms.quantity)} units · {amount(latest.terms.net_cash_base, 2)} DEMOUSD</p><Hash value={latest.terms_hash} /><small>Original economics remain unchanged.</small></section>}
  </aside>;
}
