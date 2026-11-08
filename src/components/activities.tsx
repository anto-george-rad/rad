'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarCheck, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Activity } from '@/db/schema';
import { Avatar, Button, Empty, Panel, Segmented, Select } from './ui';
import { useApp } from './app-context';
import { useForms } from './forms';
import { ACT_ICON, ACT_LABEL, ActivityRow } from './records';
import { PageHeader } from './shell';
import { cn, fmtDate, todayISO } from '@/lib/utils';

type Item = Activity & { relLabel?: string };
const hrefOf = (a: Item) => a.relatedType && a.relatedId ? `/${{ deal: 'deals', lead: 'leads', contact: 'contacts', company: 'companies' }[a.relatedType]}/${a.relatedId}` : undefined;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ActivitiesView({ items }: { items: Item[] }) {
  const { me, users, team } = useApp(); const openForm = useForms();
  // Admins see everyone; managers see their reporting line; others see only their own tasks.
  const visibleUsers = users.filter((u) => !team || team.includes(u.id));
  const canSeeTeam = !team || team.length > 1;
  const [view, setView] = useState<'list' | 'calendar'>('list'); const [tab, setTab] = useState<'open' | 'done'>('open');
  // 'mine' | 'all' | a user id (admins and managers can pick any user)
  const sp = useSearchParams();
  const [scope, setScope] = useState<string>(() => { const u = sp.get('user'); if (!u || u === me.id) return 'mine'; if (u === 'all') return canSeeTeam ? 'all' : 'mine'; return visibleUsers.some((x) => x.id === u) ? u : 'mine'; });
  const who = (id: string | null) => users.find((u) => u.id === id)?.name || 'Unassigned';
  const tip = (a: Item) => [a.title, `${ACT_LABEL[a.type]} · ${fmtDate(a.dueDate)}${a.dueTime ? ` ${a.dueTime}` : ''}${a.durationMin ? ` · ${a.durationMin} min` : ''}`, a.relLabel && `Re: ${a.relLabel}`, a.location && `At: ${a.location}`, `Owner: ${who(a.ownerId)}`, a.outcome && `Outcome: ${a.outcome}`, a.done && 'Done'].filter(Boolean).join('\n');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const t = todayISO();
  const ownerOf = (a: Item) => a.ownerId || '';
  const all = items.filter((a) => scope === 'all' || ownerOf(a) === (scope === 'mine' ? me.id : scope));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const workload = useMemo(() => visibleUsers.filter((u) => u.active || items.some((a) => a.ownerId === u.id && !a.done)).map((u) => {
    const mine = items.filter((a) => a.ownerId === u.id);
    return { u, open: mine.filter((a) => !a.done).length, overdue: mine.filter((a) => !a.done && a.dueDate && a.dueDate < t).length, done7: mine.filter((a) => a.done && a.doneAt && +new Date(a.doneAt) >= weekAgo).length };
  }).sort((a, b) => b.overdue - a.overdue || b.open - a.open), [visibleUsers, items, t, weekAgo]);
  const scopeName = scope === 'mine' ? 'your' : scope === 'all' ? (team ? 'your team’s' : 'everyone’s') : `${users.find((u) => u.id === scope)?.name || 'this user'}’s`;
  const groups: [string, Item[], 'bad' | undefined][] = tab === 'done' ? [['Completed', all.filter((a) => a.done).sort((a, b) => +new Date(b.doneAt || 0) - +new Date(a.doneAt || 0)).slice(0, 200), undefined]]
    : [['Overdue', all.filter((a) => !a.done && a.dueDate && a.dueDate < t), 'bad'], ['Today', all.filter((a) => !a.done && a.dueDate === t), undefined], ['Upcoming', all.filter((a) => !a.done && a.dueDate && a.dueDate > t), undefined], ['No date', all.filter((a) => !a.done && !a.dueDate), undefined]];
  if (tab === 'open') groups.forEach((g) => g[1].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || (a.dueTime || '').localeCompare(b.dueTime || '')));
  const cells = useMemo(() => { const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7)); const c35 = new Date(start); c35.setDate(start.getDate() + 35); const n = c35.getMonth() === month.getMonth() ? 42 : 35; return Array.from({ length: n }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }); }, [month]);
  return <>
    <PageHeader title="Activities" sub="Calls, meetings, emails and tasks across every record." actions={<Button variant="primary" onClick={() => openForm('activity')}><Plus size={16} />New activity</Button>} />
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Segmented value={view} onChange={setView} options={[['list', 'List'], ['calendar', 'Calendar']]} />
      {view === 'list' && <Segmented value={tab} onChange={setTab} options={[['open', 'Open'], ['done', 'Completed']]} />}
      {canSeeTeam
        ? <label className="flex items-center gap-2 text-xs font-semibold text-muted">Showing
            <Select className="h-9 w-auto" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Whose activities">
              <option value="mine">My activities</option>
              <option value="all">{team ? 'My team' : 'All users'}</option>
              <optgroup label="Team member">{workload.map(({ u, open, overdue }) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (you)' : ''} · {open} open{overdue ? `, ${overdue} overdue` : ''}</option>)}</optgroup>
            </Select></label>
        : null}
    </div>
    {canSeeTeam && scope === 'all' && <div className="panel mb-4 overflow-x-auto">
      <table className="tbl min-w-[560px]"><thead><tr><th>Team member</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">Done · 7 days</th><th /></tr></thead>
        <tbody>{workload.map(({ u, open, overdue, done7 }) => <tr key={u.id} className="cursor-pointer" onClick={() => setScope(u.id)}>
          <td><span className="inline-flex items-center gap-2"><Avatar id={u.id} name={u.name} size={24} /><span className="font-semibold">{u.name}</span>{!u.active && <span className="text-xs text-muted">(deactivated)</span>}</span></td>
          <td className="num text-right">{open}</td><td className={cn('num text-right', overdue > 0 && 'font-semibold text-bad')}>{overdue}</td><td className="num text-right">{done7}</td>
          <td className="text-right text-xs font-semibold text-accent">View tasks →</td></tr>)}</tbody></table>
    </div>}
    {canSeeTeam && scope !== 'mine' && scope !== 'all' && <div className="mb-3 flex items-center gap-2 text-[13px] text-muted">Viewing {scopeName} activities.<Button size="sm" variant="ghost" onClick={() => setScope('all')}>{team ? 'Back to my team' : 'Back to all users'}</Button></div>}
    {view === 'list' ? <div className="flex flex-col gap-4">
      {groups.filter((g) => g[1].length).map(([n, l, tone]) => <Panel key={n} title={<span className={cn(tone === 'bad' && 'text-bad')}>{n}</span>} count={l.length}>{l.map((a) => <ActivityRow key={a.id} a={a} relLabel={a.relLabel} relHref={hrefOf(a)} />)}</Panel>)}
      {!groups.some((g) => g[1].length) && <div className="panel"><Empty icon={<CalendarCheck />} title={tab === 'done' ? 'Nothing completed yet' : 'Nothing scheduled'} action={<Button variant="primary" onClick={() => openForm('activity')}>Schedule an activity</Button>}>Activities you schedule line up here by due date.</Empty></div>}
    </div> : <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}><ChevronLeft size={16} /></Button>
        <b className="min-w-[150px] text-center font-display text-[17px]">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}><ChevronRight size={16} /></Button>
        <Button size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
        <span className="ml-auto hidden text-xs text-muted sm:block">Click a day to schedule</span>
      </div>
      <div className="overflow-x-auto"><div className="grid min-w-[640px] grid-cols-7 gap-px bg-line">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{d}</div>)}
        {cells.map((d) => { const ds = iso(d); const evs = all.filter((a) => a.dueDate === ds).sort((a, b) => (a.dueTime || '').localeCompare(b.dueTime || '')); const out = d.getMonth() !== month.getMonth();
          return <div key={ds} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) openForm('activity', { dueDate: ds }); }} className={cn('flex min-h-[112px] cursor-pointer flex-col gap-1 p-2 transition hover:bg-raised', out ? 'bg-sunken/60 text-faint' : 'bg-surface')}>
            <span className={cn('num self-start rounded-full px-1.5 text-xs', ds === t && 'bg-accent font-semibold text-accent-ink')}>{d.getDate()}</span>
            {evs.slice(0, 3).map((a) => { const I = ACT_ICON[a.type]; return <button key={a.id} onClick={() => openForm('activity', a as never)} title={tip(a)} className={cn('flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium', a.done ? 'bg-sunken text-faint line-through' : ds < t ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-ink')}><I size={10} className="flex-none" />{a.dueTime && <span className="num">{a.dueTime}</span>}<span className="truncate">{a.title}</span></button>; })}
            {evs.length > 3 && <span className="px-1 text-[11px] text-muted">+{evs.length - 3} more</span>}
          </div>; })}
      </div></div>
    </div>}
  </>;
}
