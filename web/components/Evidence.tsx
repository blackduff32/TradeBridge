import { FileCheck2, LockKeyhole } from 'lucide-react';
import type { Reconciliation, Trade } from '../api';
import { amount, dateTime } from '../format';
import { Hash } from './ui';

export function Evidence({ trade, reconciliation }: { trade: Trade; reconciliation: Reconciliation }) {
  const buyer = trade.sources.buyer?.record; const broker = trade.sources.broker?.record;
  const rows = [
    { field: 'quantity', label: 'Quantity', unit: 'DEMOBOND', a: buyer?.quantity, b: broker?.quantity, decimals: 0 },
    { field: 'unit_price_base', label: 'Unit price', unit: 'DEMOUSD', a: buyer?.unit_price_base, b: broker?.unit_price_base, decimals: 2 },
    { field: 'accrued_interest_base', label: 'Accrued interest', unit: 'DEMOUSD', a: buyer?.accrued_interest_base, b: broker?.accrued_interest_base, decimals: 2 },
    { field: 'fees_base', label: 'Fees', unit: 'DEMOUSD', a: buyer?.fees_base, b: broker?.fees_base, decimals: 2 },
    { field: 'net_cash_base', label: 'Net payment', unit: 'DEMOUSD', a: buyer?.net_cash_base, b: broker?.net_cash_base, decimals: 2 },
  ];
  return <section className="panel evidence"><header className="panel-heading"><div><h2>Compare source records</h2><p>Original records stay unchanged as you resolve differences.</p></div><LockKeyhole size={18} aria-label="Original records are read-only" /></header>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Source comparison, scroll horizontally for all columns"><table><caption className="sr-only">Buyer and broker economics, with mismatches highlighted</caption><thead><tr><th scope="col">Trade terms</th><th scope="col"><span className="party-marker">B</span> Buyer book</th><th scope="col"><span className="party-marker broker">B</span> Broker book</th><th scope="col">Comparison</th></tr></thead><tbody>{rows.map(row => <tr key={row.field} className={row.a && row.b && row.a !== row.b ? 'mismatch-row' : ''}><th scope="row">{row.label}<small>{row.unit}</small></th><td className="numeric">{amount(row.a, row.decimals)}</td><td className="numeric">{amount(row.b, row.decimals)}</td><td>{!row.a || !row.b ? <span className="muted">Awaiting source</span> : row.a === row.b ? <span className="match">Matched</span> : <span className="difference">Difference</span>}</td></tr>)}</tbody></table></div>
    {reconciliation.differences.filter(d => !rows.some(r => r.field === d.field)).map(d => <p className="extra-difference" key={d.field}>{d.field}: buyer <code>{d.buyer}</code>, broker <code>{d.broker}</code></p>)}
    <footer className="source-footer">{(['buyer', 'broker'] as const).map(side => <details key={side}><summary><FileCheck2 size={16} />{side === 'buyer' ? 'Buyer evidence' : 'Broker evidence'}</summary>{trade.sources[side] ? <section className="source-detail"><p>Record {trade.sources[side]!.record_number} · {trade.sources[side]!.actor}</p><p>{dateTime(trade.sources[side]!.imported_at)}</p><p>SHA-256 source file</p><Hash value={trade.sources[side]!.file_hash} /><pre>{trade.sources[side]!.raw_row}</pre></section> : <p>Import this side's CSV to inspect the original evidence.</p>}</details>)}</footer>
  </section>;
}
