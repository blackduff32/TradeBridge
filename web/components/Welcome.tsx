import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Plus } from 'lucide-react';
import { api, errorMessage, type Session } from '../api';
import { Button, Notice } from './ui';

export function Welcome({ onSession, demoAvailable, hosted }: { onSession: (value: Session) => void; demoAvailable: boolean; hosted?: boolean }) {
  const [token, setToken] = useState(''); const [reveal, setReveal] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [errorArea, setErrorArea] = useState<'demo' | 'access'>('demo');
  async function signIn(event: FormEvent) {
    event.preventDefault(); setErrorArea('access'); setError(''); setBusy(true);
    try { onSession(await api<Session>('/session', { method: 'POST', body: { token } })); setToken(''); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <div className="welcome">
    <section className="welcome-hero">
      <div className="hero-copy">
        <p className="welcome-label"><span className="signal-dot" />BILATERAL TRADE RECONCILIATION</p>
        <h1>Bring both sides<br />to the <span>same record.</span></h1>
        <p className="hero-description">Find the difference before it becomes a settlement. Compare the evidence. Propose the terms. Keep people in control.</p>
        {demoAvailable && <Button kind="primary" busy={busy} onClick={async () => {
          setBusy(true); setErrorArea('demo'); setError('');
          try { onSession(await api<Session>('/session/demo', { method: 'POST' })); }
          catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>Explore the 100-unit mismatch<ArrowRight size={18} /></Button>}
        <p className="demo-caption">Synthetic trade. Real comparison. No wallet required.</p>
        {error && errorArea === 'demo' && <Notice error>{error}</Notice>}
      </div>
      <figure className="bridge-figure" aria-label="Synthetic example: buyer record of 1,000 units and broker record of 1,100 units require reconciliation.">
        <span className="figure-coordinate">FIG. 01 / THE AGREEMENT GAP</span>
        <img src="/brand/bridge-field.svg" width="600" height="490" alt="" />
        <div className="figure-book buyer-book"><span>BUYER RECORD</span><strong>1,000<span> units</span></strong></div>
        <div className="figure-book broker-book"><span>BROKER RECORD</span><strong>1,100<span> units</span></strong></div>
        <figcaption><span className="figure-cross">+</span><span>100 units apart.<br /><strong>One agreement to reach.</strong></span><span className="figure-index">TB—001</span></figcaption>
      </figure>
    </section>
    <section id="review-method" className="method-section" aria-labelledby="method-title">
      <header><p className="eyebrow">THE REVIEW SEQUENCE</p><h2 id="method-title">Evidence before execution.</h2><Plus size={20} aria-hidden="true" /></header>
      <div className="method-grid">{[
        ['01', 'Compare the originals.', 'Read buyer and broker records side by side. Every discrepancy points back to its source.'],
        ['02', 'Propose precise terms.', 'Create a versioned correction with exact quantities, prices and an auditable terms hash.'],
        ['03', 'Keep consent explicit.', 'Both authorized humans must approve the same version before any commitment can proceed.'],
      ].map(([number, title, text]) => <article key={number}><span className="method-number">{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
    {!hosted && <section id="access" className="access-section"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Already have access?</h2><p>Open your scoped buyer or broker workspace.</p></div>
      <details className="sign-in"><summary>Use a development access token <ArrowRight size={16} aria-hidden="true" /></summary>
        <form noValidate onSubmit={signIn}><label htmlFor="access-token">Development token</label><div className="token-input"><input id="access-token" type={reveal ? 'text' : 'password'} autoComplete="current-password" value={token} onChange={e => setToken(e.target.value)} /><Button kind="ghost" type="button" aria-label={reveal ? 'Hide token' : 'Show token'} onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff size={17} /> : <Eye size={17} />}</Button></div><Button type="submit" busy={busy}>Open workspace</Button></form>
        {error && errorArea === 'access' && <Notice error>{error}</Notice>}
        <p>Generated locally with npm run setup. Development tokens are not production staff authentication.</p>
      </details>
    </section>}
  </div>;
}
