export function amount(value: string | undefined, decimals = 0) {
  if (value === undefined) return 'Not imported';
  const n = BigInt(value); const scale = 10n ** BigInt(decimals);
  const whole = (n / scale).toLocaleString('en-US');
  return decimals ? `${whole}.${(n % scale).toString().padStart(decimals, '0')}` : whole;
}
export function cashInput(value: string): string | null {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value));
}
