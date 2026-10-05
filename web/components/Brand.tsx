export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand-lockup"><img src="/brand/mark.svg" width="30" height="30" alt="" />{!compact && <span>TradeBridge</span>}</span>;
}
