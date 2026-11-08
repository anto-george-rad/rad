'use client';
import { useRouter } from 'next/navigation';
import { Medal, Trophy } from 'lucide-react';
import { Avatar, Segmented } from './ui';
import { cn, fmtMoney } from '@/lib/utils';
import type { AgentRow, Period, SalesRow } from '@/lib/leaderboard';

const PERIODS: [Period, string][] = [['month', 'This month'], ['last_month', 'Last month'], ['quarter', 'This quarter'], ['year', 'This year']];
const medal = (i: number) => i < 3 ? <Medal size={18} className={['text-[#D4A017]', 'text-[#9AA3B2]', 'text-[#B87333]'][i]} aria-label={['1st', '2nd', '3rd'][i]} /> : <span className="num w-[18px] text-center text-[13px] text-muted">{i + 1}</span>;
function Head({ title, sub, period, base }: { title: string; sub: string; period: Period; base: string }) {
  const router = useRouter();
  return <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><p className="eyebrow">{sub}</p><h1 className="flex items-center gap-2 font-display text-[28px] font-bold tracking-tight"><Trophy size={24} className="text-accent" />{title}</h1></div>
    <Segmented value={period} onChange={(v) => router.replace(`${base}?period=${v}`)} options={PERIODS} /></div>;
}
export function SalesLeaderboard({ rows, period, label, meId }: { rows: SalesRow[]; period: Period; label: string; meId: string }) {
  const top = Math.max(1, ...rows.map((r) => r.won));
  return <div className="flex flex-col gap-4"><Head title="Sales leaderboard" sub={`CRM · ${label}`} period={period} base="/leaderboard" />
    <p className="text-[13.5px] text-muted">Ranked by won value (AED). Points: 50 per deal won, 20 per lead converted, 2 per completed activity, plus 1 per AED 10,000 won.</p>
    <div className="panel overflow-x-auto"><table className="tbl min-w-[860px]"><thead><tr><th className="w-10" /><th>Rep</th><th>Won</th><th className="text-right">Deals won</th><th className="text-right">Win rate</th><th className="text-right">New pipeline</th><th className="text-right">Activities</th><th className="text-right">Leads converted</th><th>Target</th><th className="text-right">Points</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.userId} className={cn(r.userId === meId && 'bg-accent-soft/50')}>
        <td>{medal(i)}</td><td><span className="flex items-center gap-2 font-semibold"><Avatar id={r.userId} name={r.name} size={26} />{r.name}{r.userId === meId && <span className="text-xs font-normal text-muted">(you)</span>}</span></td>
        <td className="min-w-[180px]"><div className="num text-[13px] font-semibold">{fmtMoney(r.won)}</div><div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((r.won / top) * 100)}%` }} /></div></td>
        <td className="num text-right">{r.wonCount}</td><td className="num text-right">{r.winRate != null ? `${r.winRate}%` : '—'}</td><td className="num text-right">{fmtMoney(r.pipelineAdded)}</td>
        <td className="num text-right">{r.activities}</td><td className="num text-right">{r.converted}</td>
        <td className="min-w-[120px]">{r.target ? <><div className="num text-[12.5px]">{r.attainment}% of {fmtMoney(r.target)}</div><div className="mt-1 h-1.5 rounded-full bg-sunken"><div className={cn('h-full rounded-full', (r.attainment || 0) >= 100 ? 'bg-good' : (r.attainment || 0) >= 70 ? 'bg-warn' : 'bg-bad')} style={{ width: `${Math.min(100, r.attainment || 0)}%` }} /></div></> : <span className="text-faint">No target</span>}</td>
        <td className="num text-right font-semibold">{r.points}</td></tr>)}
        {!rows.length && <tr><td colSpan={10} className="py-10 text-center text-muted">Nothing closed or logged in this period yet.</td></tr>}</tbody></table></div></div>;
}
export function AgentLeaderboard({ rows, period, label, meId }: { rows: AgentRow[]; period: Period; label: string; meId: string }) {
  return <div className="flex flex-col gap-4"><Head title="Agent leaderboard" sub={`Helpdesk · ${label}`} period={period} base="/desk/leaderboard" />
    <p className="text-[13.5px] text-muted">Points: 10 per resolved ticket (+2 when first replies average under an hour), +5 per “great” rating, −5 per “not good” rating, −8 per SLA breach.</p>
    <div className="panel overflow-x-auto"><table className="tbl min-w-[820px]"><thead><tr><th className="w-10" /><th>Agent</th><th className="text-right">Resolved</th><th className="text-right">Avg first reply</th><th className="text-right">Avg resolution</th><th className="text-right">Satisfaction</th><th className="text-right">SLA met</th><th className="text-right">Breaches</th><th className="text-right">Points</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.userId} className={cn(r.userId === meId && 'bg-accent-soft/50')}>
        <td>{medal(i)}</td><td><span className="flex items-center gap-2 font-semibold"><Avatar id={r.userId} name={r.name} size={26} />{r.name}{r.userId === meId && <span className="text-xs font-normal text-muted">(you)</span>}</span></td>
        <td className="num text-right">{r.resolved}</td><td className="num text-right">{r.frtMins == null ? '—' : r.frtMins < 60 ? `${r.frtMins} min` : `${Math.round(r.frtMins / 6) / 10} h`}</td>
        <td className="num text-right">{r.resolveHrs == null ? '—' : r.resolveHrs < 48 ? `${r.resolveHrs} h` : `${Math.round(r.resolveHrs / 2.4) / 10} days`}</td>
        <td className="num text-right">{r.csat != null ? <span className={r.csat >= 85 ? 'text-good' : r.csat >= 70 ? 'text-warn' : 'text-bad'}>{r.csat}%<span className="text-xs text-muted"> ({r.rated})</span></span> : '—'}</td>
        <td className="num text-right">{r.slaMet != null ? `${r.slaMet}%` : '—'}</td><td className={cn('num text-right', r.breaches && 'text-bad')}>{r.breaches}</td><td className="num text-right font-semibold">{r.points}</td></tr>)}
        {!rows.length && <tr><td colSpan={9} className="py-10 text-center text-muted">No tickets resolved or rated in this period yet.</td></tr>}</tbody></table></div></div>;
}
