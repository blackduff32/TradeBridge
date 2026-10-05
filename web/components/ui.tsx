import { useState, type ButtonHTMLAttributes, type ComponentPropsWithRef, type ReactNode } from 'react';
import { AlertCircle, Check, Copy, LoaderCircle } from 'lucide-react';

export function Button({ children, kind = 'secondary', busy = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'ghost'; busy?: boolean }) {
  return <button {...props} className={`button ${kind} ${className}`} disabled={props.disabled || busy} aria-busy={busy || undefined}>{busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}{children}</button>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <section className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><AlertCircle size={18} aria-hidden="true" /><div>{children}</div></section>;
}
export function Field({ label, error, help, ...props }: ComponentPropsWithRef<'input'> & { label: string; error?: string; help?: string }) {
  return <section className="field"><label htmlFor={props.id}>{label}</label><input {...props} aria-invalid={Boolean(error)} aria-describedby={error || help ? `${props.id}-help` : undefined} /><small id={`${props.id}-help`} className={error ? 'field-error' : ''}>{error || help}</small></section>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="empty"><h2>{title}</h2><p>{children}</p>{action}</section>;
}
export function Hash({ value }: { value: string }) {
  const [copied, setCopied] = useState(false); const [error, setError] = useState(false);
  return <section className="hash"><code>{value}</code><Button kind="ghost" aria-label={copied ? 'Hash copied' : 'Copy full terms hash'} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setError(false); } catch { setError(true); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}</Button>{error && <small role="status">Copy unavailable. Select the full hash above to copy it.</small>}</section>;
}
