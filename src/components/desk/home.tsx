'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { AlertTriangle, Clock, Inbox, Plus, Smile, Timer, UserX } from 'lucide-react';
import type { TicketDS } from '@/lib/insights-data';
import type { DS } from '@/lib/insights-data';
import { Avatar, Button, Kpi, Panel } from '../ui';
import { useApp } from '../app-context';
import { useForms } from '../forms';
import { aggregate, sources, type Ctx } from '../insights/engine';
import { TileBody } from '../insights/tile-view';
import { useColorIdx } from '../insights/insights';
import type { Tile } from '@/lib/insights-defaults';
import { cn } from '@/lib/utils';
import { PriorityChip, SlaChip, useTag } from './bits';

type Mine = { id: string; number: number; subject: string; priority: string; statusCategory: string; dueAt: Date | null; firstResponseDueAt: Date | null; firstRespondedAt: Date | null; breachedAt: Date | null; frBreachedAt: Date | null; requesterName: string | null };
type Stat = { id: string; name: string; open: number; resolved: number; frtHrs: number | null; sla: number | null; csat: number | null; minutes: number };
export const deskDS = (rows: TicketDS[]): DS => ({ stageOrder: {}, deals: [], leads: [], activities: [], contacts: [], companies: [], pipelines: [], tickets: rows }) as unknown as DS;

export default function DeskHome({ counts, mine, rows, stats, hasDept }: { counts: Record<string, number>; mine: Mine[]; rows: TicketDS[]; stats: Stat[]; hasDept: boolean }) {
  const { me } = useApp(); const openForm = useForms(); const tag = useTag();
  const data = useMemo(() => deskDS(rows), [rows]); const S = useMemo(() => sources(data), [data]); const colorIdx = useColorIdx(S, data);
  const ctx: Ctx = useMemo(() => ({ range: [Date.now() - 30 * 86_400_000, Date.now()], mine: null, pipe: '', cross: [] }), []);
  const open: Ctx = useMemo(() => ({ range: null, mine: null, pipe: '', cross: [] }), []);
  const t1: Tile = { id: 'd1', ds: 'tickets', visual: 'donut', measure: 'count', groupBy: 'priority', dateField: 'none', filters: [{ dim: 'status', op: 'not', value: 'Closed' }] };
  const t2: Tile = { id: 'd2', ds: 'tickets', visual: 'column', measure: 'count', groupBy: 'channel', dateField: 'createdAt', filters: [] };
  const k = (m: string) => aggregate(S, data, { id: 'k' + m, ds: 'tickets', visual: 'kpi', measure: m, dateField: m === 'csat' || m === 'sla' ? 'resolvedAt' : 'createdAt' }, ctx).kpi ?? 0;
  const hr = new Date().getHours();
  return <div className="flex flex-col gap-4">
    <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card md:p-7">
      <div className="pointer-events-none absolute -right-24 -top-32 h-[320px] w-[320px] rounded-full bg-accent opacity-[.12] blur-[90px]" />
      <div className="relative flex flex-wrap items-end gap-4">
        <div className="min-w-[min(100%,280px)] flex-1"><p className="eyebrow">Helpdesk</p>
          <h1 className="mt-1 font-display text-[28px] font-bold leading-tight md:text-[32px]">{hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}, {me.name.split(' ')[0]}</h1>
          <p className="mt-1 text-[14px] text-muted">{me.deskRole === 'light' ? 'You can read tickets in your departments and leave private notes for the team.' : `${counts.mine || 0} open ${counts.mine === 1 ? 'ticket is' : 'tickets are'} yours${counts.overdue ? ` · ${counts.overdue} overdue in your queues` : ''}.`}</p></div>
        {me.deskRole !== 'light' && <Button variant="primary" onClick={() => openForm('ticket')}><Plus size={15} />New ticket</Button>}
      </div>
    </section>
    {!hasDept && <div className="rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-warn">You aren’t in a helpdesk department yet, so no tickets are shown. Ask an admin to add you under Settings → Departments.</div>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      {([['mine', 'My open', Inbox], ['unassigned', 'Unassigned', UserX], ['overdue', 'Overdue', AlertTriangle], ['today', 'Due today', Clock], ['onhold', 'On hold', Timer], ['escalated', 'Escalated', AlertTriangle]] as const)
        .filter(([v]) => me.deskRole !== 'light' || v !== 'mine').map(([v, l, I]) => <Link key={v} href={`/desk/tickets?v=${v}`} className="rounded-2xl outline-offset-2"><Kpi label={l} value={counts[v] || 0} tone={(v === 'overdue' || v === 'escalated') && counts[v] ? 'bad' : undefined} icon={<I size={16} />} /></Link>)}
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <Panel title={me.deskRole === 'light' ? 'Open tickets in your departments' : 'My queue'} count={mine.length} actions={<Link href={`/desk/tickets?v=${me.deskRole === 'light' ? 'open' : 'mine'}`} className="text-xs font-semibold text-accent hover:underline">Open list</Link>}>
        {mine.length ? mine.map((t) => <Link key={t.id} href={`/desk/tickets/${t.id}`} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-raised">
          <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-semibold"><span className="num mr-2 text-[11.5px] font-normal text-muted">{tag(t.number)}</span>{t.subject}</div><div className="truncate text-xs text-muted">{t.requesterName || 'No requester'}</div></div>
          <PriorityChip p={t.priority} /><SlaChip due={t.firstRespondedAt || !t.firstResponseDueAt ? t.dueAt : t.firstResponseDueAt} label={t.firstRespondedAt || !t.firstResponseDueAt ? 'Due' : 'Reply'} breached={t.breachedAt || t.frBreachedAt} category={t.statusCategory} /></Link>)
          : <p className="px-5 py-8 text-center text-[13px] text-muted">Nothing waiting on you.</p>}
      </Panel>
      <div className="grid grid-cols-2 gap-3 content-start">
        <Kpi label="Created · 30 days" value={k('count')} icon={<Inbox size={16} />} />
        <Kpi label="First response" value={`${k('frt')}h`} sub="avg business hours" icon={<Clock size={16} />} />
        <Kpi label="SLA met" value={`${k('sla')}%`} sub="resolved, last 30 days" icon={<Timer size={16} />} tone={k('sla') < 80 && k('sla') > 0 ? 'bad' : 'good'} />
        <Kpi label="Satisfaction" value={`${k('csat')}%`} sub="rated “great”" icon={<Smile size={16} />} />
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Open tickets by priority" bodyClass="p-5"><TileBody t={t1} agg={aggregate(S, data, t1, open)} ctx={open} colorIdx={colorIdx} /></Panel>
      <Panel title="Where tickets come from · 30 days" bodyClass="p-5"><TileBody t={t2} agg={aggregate(S, data, t2, ctx)} ctx={ctx} colorIdx={colorIdx} /></Panel>
    </div>
    {stats.length > 0 && <AgentTable stats={stats} />}
  </div>;
}
export function AgentTable({ stats, days = 30 }: { stats: Stat[]; days?: number }) {
  return <Panel title={`Agents · last ${days} days`} count={stats.length}><div className="overflow-x-auto"><table className="tbl min-w-[680px]"><thead><tr><th>Agent</th><th className="text-right">Open now</th><th className="text-right">Resolved</th><th className="text-right">Avg first response</th><th className="text-right">SLA met</th><th className="text-right">Satisfaction</th><th className="text-right">Time logged</th></tr></thead>
    <tbody>{stats.map((s) => <tr key={s.id}><td><Link href={`/desk/tickets?v=all&assignee=${s.id}`} className="inline-flex items-center gap-2 font-semibold hover:text-accent"><Avatar id={s.id} name={s.name} size={22} />{s.name}</Link></td>
      <td className="num text-right">{s.open}</td><td className="num text-right">{s.resolved}</td><td className="num text-right">{s.frtHrs == null ? '—' : `${s.frtHrs}h`}</td>
      <td className={cn('num text-right', s.sla != null && s.sla < 80 && 'text-bad')}>{s.sla == null ? '—' : `${s.sla}%`}</td><td className="num text-right">{s.csat == null ? '—' : `${s.csat}%`}</td><td className="num text-right">{s.minutes ? `${Math.floor(s.minutes / 60)}h ${s.minutes % 60}m` : '—'}</td></tr>)}</tbody></table></div></Panel>;
}
