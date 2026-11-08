'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Flame, Plus, Target, TrendingUp, Trophy, Wallet, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Activity } from '@/db/schema';
import type { DS } from '@/lib/insights-data';
import type { Tile } from '@/lib/insights-defaults';
import { Avatar, Button, Chip, IconButton, Kpi, Panel, Segmented, Select } from './ui';
import { useApp } from './app-context';
import { useForms } from './forms';
import { ActivityRow, Owner } from './records';
import { aggregate, sources, type Ctx } from './insights/engine';
import { TileBody } from './insights/tile-view';
import { useColorIdx } from './insights/insights';
import { cn, fmtMoney, fmtShort } from '@/lib/utils';
import { saveOrg } from '@/lib/actions';

type K = { open: number; openCount: number; weighted: number; commit: number; bestCase: number; wonMonth: number; wonCount: number; target: number; winRate: number | null; closed90: number; newLeads: number; uncontacted: number; overdue: number; dueToday: number };
type TeamRow = { id: string; name: string; target: number | null; open: number; won: number; overdue: number; today: number };
type SetupItem = { key: string; label: string; href: string; done: boolean };
export default function Home({ data, kpis, attention, hot, myDay, pipelines, defaultPipe, team, setup }: {
  team: TeamRow[] | null; setup: SetupItem[] | null;
  data: DS; kpis: K; pipelines: { id: string; name: string }[]; defaultPipe?: string;
  attention: { id: string; name: string; ownerId: string | null; stage: string; amount: number | null; currency: string; idle: number; stale: boolean; noNext: boolean }[];
  hot: { id: string; name: string; sub: string; score: number; ownerId: string | null }[];
  myDay: (Activity & { relLabel?: string })[];
}) {
  const { me } = useApp(); const openForm = useForms();
  const [pipe, setPipe] = useState(defaultPipe || pipelines[0]?.id || ''); const [scope, setScope] = useState<'all' | 'mine'>('all');
  const S = useMemo(() => sources(data), [data]); const colorIdx = useColorIdx(S, data);
  const ctx: Ctx = useMemo(() => ({ range: null, mine: scope === 'mine' ? me.id : null, pipe: '', cross: [] }), [scope, me.id]);
  const pname = pipelines.find((p) => p.id === pipe)?.name || '';
  const t1: Tile = useMemo(() => ({ id: 'h1', ds: 'deals', visual: 'column', measure: 'sum', groupBy: 'stage', dateField: 'none', topN: 0, filters: [{ dim: 'status', op: 'is', value: 'Open' }, { dim: 'pipeline', op: 'is', value: pname }] }), [pname]);
  const t2: Tile = useMemo(() => ({ id: 'h2', ds: 'deals', visual: 'area', measure: 'sum', groupBy: 'closedMonth', months: 6, dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Won' }] }), []);
  const a1 = useMemo(() => aggregate(S, data, t1, ctx), [S, data, t1, ctx]); const a2 = useMemo(() => aggregate(S, data, t2, ctx), [S, data, t2, ctx]);
  const hr = new Date().getHours(); const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  return <div className="flex flex-col gap-4">
    <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card md:p-7">
      <div className="pointer-events-none absolute -right-24 -top-32 h-[340px] w-[340px] rounded-full bg-accent opacity-[.14] blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-40 left-1/3 h-[260px] w-[260px] rounded-full bg-[#1BAF7A] opacity-[.08] blur-[90px]" />
      <div className="relative flex flex-wrap items-end gap-4">
        <div className="w-full min-w-0 md:w-auto md:flex-1">
          <p className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-1 font-display text-[26px] md:text-[32px] font-bold leading-tight tracking-tight">{greet}, {me.name.split(' ')[0]}</h1>
          <p className="mt-1 text-[14px] text-muted">{kpis.dueToday ? `${kpis.dueToday} ${kpis.dueToday === 1 ? 'activity' : 'activities'} due today` : 'Nothing due today'}{kpis.overdue > 0 && <> · <b className="text-bad">{kpis.overdue} overdue</b></>}{attention.length > 0 && <> · {attention.length} deals need attention</>}</p>
        </div>
        <Segmented value={scope} onChange={setScope} options={[['all', 'Everyone'], ['mine', 'Mine']]} />
        <Button onClick={() => openForm('lead')}><Plus size={15} />Lead</Button>
        <Button variant="primary" onClick={() => openForm('deal')}><Plus size={15} />Deal</Button>
      </div>
    </section>
    {setup && <SetupChecklist items={setup} />}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Kpi label="Open pipeline" value={fmtMoney(kpis.open)} sub={`${kpis.openCount} open ${kpis.openCount === 1 ? 'deal' : 'deals'}`} icon={<Wallet size={16} />} />
      <Kpi label="Weighted forecast" value={fmtMoney(kpis.weighted)} sub={kpis.commit || kpis.bestCase ? `Commit ${fmtShort(kpis.commit)} · Best case ${fmtShort(kpis.bestCase)}` : 'value × stage probability'} icon={<TrendingUp size={16} />} />
      <Kpi label="Won this month" value={fmtMoney(kpis.wonMonth)} sub={kpis.target ? `${Math.round((kpis.wonMonth / kpis.target) * 100)}% of ${fmtShort(kpis.target)} target` : `${kpis.wonCount} ${kpis.wonCount === 1 ? 'deal' : 'deals'} won`} meter={kpis.target ? (kpis.wonMonth / kpis.target) * 100 : undefined} icon={<Trophy size={16} />} />
      <Kpi label="Win rate · 90 days" value={kpis.winRate == null ? '—' : `${kpis.winRate}%`} sub={`${kpis.closed90} closed`} icon={<Target size={16} />} />
      <Kpi label="New leads · 7 days" value={kpis.newLeads} sub={`${kpis.uncontacted} not contacted yet`} icon={<Flame size={16} />} />
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <Panel title="Open value by stage" actions={<Select className="h-8 w-auto py-1" value={pipe} onChange={(e) => setPipe(e.target.value)} aria-label="Pipeline">{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>} bodyClass="p-5"><TileBody t={t1} agg={a1} ctx={ctx} colorIdx={colorIdx} /></Panel>
      <Panel title="Won revenue" actions={<Link href="/insights" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">Open Insights<ArrowRight size={13} /></Link>} bodyClass="p-5"><p className="-mt-1 mb-2 text-xs text-muted">Last 6 months, AED</p><TileBody t={t2} agg={a2} ctx={ctx} colorIdx={colorIdx} /></Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="My day" count={myDay.length} actions={<Link href="/activities" className="text-xs font-semibold text-accent hover:underline">All activities</Link>}>
        {myDay.length ? myDay.map((a) => <ActivityRow key={a.id} a={a} relLabel={a.relLabel} relHref={a.relatedType && a.relatedId ? `/${a.relatedType === 'deal' ? 'deals' : a.relatedType === 'lead' ? 'leads' : a.relatedType === 'contact' ? 'contacts' : 'companies'}/${a.relatedId}` : undefined} />)
          : <p className="px-5 py-8 text-center text-[13px] text-muted">You are all caught up.</p>}
      </Panel>
      <Panel title="Needs attention" count={attention.length}>
        {attention.length ? attention.map((x) => <Link key={x.id} href={`/deals/${x.id}`} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-raised">
          <Owner id={x.ownerId} withName={false} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-semibold">{x.name}</div><div className="truncate text-xs text-muted">{x.stage} · {fmtMoney(x.amount, x.currency)}</div></div>
          {x.stale && <Chip tone="warn">{x.idle}d idle</Chip>}{x.noNext && <Chip tone="bad"><AlertTriangle size={11} />No next step</Chip>}
        </Link>) : <p className="px-5 py-8 text-center text-[13px] text-muted">Every open deal has a next step and is moving.</p>}
      </Panel>
    </div>
    {team && team.length > 0 && <TeamPanel rows={team} />}
    {hot.length > 0 && <Panel title="Hot leads" actions={<Link href="/leads" className="text-xs font-semibold text-accent hover:underline">All leads</Link>}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5">{hot.map((l) => <Link key={l.id} href={`/leads/${l.id}`} className="flex items-center gap-3 border-b border-line p-4 hover:bg-raised sm:border-r"><Owner id={l.ownerId} withName={false} /><div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-semibold">{l.name}</div><div className="truncate text-xs text-muted">{l.sub}</div></div><Chip tone="bad">{l.score}</Chip></Link>)}</div>
    </Panel>}
  </div>;
}

function SetupChecklist({ items }: { items: SetupItem[] }) {
  const router = useRouter(); const left = items.filter((i) => !i.done).length;
  const dismiss = async () => { await saveOrg({ setupDismissed: true }); router.refresh(); };
  return <Panel title="Get set up" count={left ? `${items.length - left} of ${items.length} done` : 'All done'} actions={<IconButton label="Hide this checklist" onClick={dismiss}><X size={16} /></IconButton>}>
    <div className="h-1 bg-sunken"><i className="block h-full bg-good transition-all" style={{ width: `${((items.length - left) / items.length) * 100}%` }} /></div>
    <div className="grid sm:grid-cols-2 xl:grid-cols-4">{items.map((i) => <Link key={i.key} href={i.href} className="flex items-center gap-3 border-b border-line px-5 py-3 hover:bg-raised sm:border-r">
      <span className={cn('grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px]', i.done ? 'border-good bg-good text-white' : 'border-faint')}>{i.done && <Check size={12} strokeWidth={3} />}</span>
      <span className={cn('text-[13px]', i.done ? 'text-muted line-through' : 'font-medium')}>{i.label}</span></Link>)}</div>
    {!left && <div className="px-5 py-3"><Button size="sm" onClick={dismiss}>Hide checklist</Button></div>}
  </Panel>;
}
function TeamPanel({ rows }: { rows: TeamRow[] }) {
  const anyTarget = rows.some((r) => r.target);
  return <Panel title="Team this month" count={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`} actions={<Link href="/activities?user=all" className="text-xs font-semibold text-accent hover:underline">Team tasks</Link>}>
    <div className="overflow-x-auto"><table className="tbl min-w-[640px]"><thead><tr><th className="w-8">#</th><th>Person</th><th className="text-right">Won this month</th>{anyTarget && <th className="w-[180px]">Target</th>}<th className="text-right">Open pipeline</th><th className="text-right">Due today</th><th className="text-right">Overdue</th></tr></thead>
      <tbody>{rows.map((r, i) => { const pct = r.target ? Math.round((r.won / r.target) * 100) : null;
        return <tr key={r.id}><td className="num text-muted">{i + 1}</td>
          <td><Link href={`/activities?user=${r.id}`} className="inline-flex items-center gap-2 font-semibold hover:text-accent"><Avatar id={r.id} name={r.name} size={24} />{r.name}{i === 0 && r.won > 0 && <Trophy size={13} className="text-warn" />}</Link></td>
          <td className="num text-right font-semibold">{fmtMoney(r.won)}</td>
          {anyTarget && <td>{pct == null ? <span className="text-xs text-faint">No target</span> : <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"><i className={cn('block h-full rounded-full', pct >= 100 ? 'bg-good' : 'bg-accent')} style={{ width: `${Math.min(100, pct)}%` }} /></div><span className="num w-10 text-right text-xs text-muted">{pct}%</span></div>}</td>}
          <td className="num text-right">{fmtShort(r.open)}</td><td className="num text-right">{r.today}</td><td className={cn('num text-right', r.overdue > 0 && 'font-semibold text-bad')}>{r.overdue}</td></tr>; })}</tbody></table></div>
  </Panel>;
}
