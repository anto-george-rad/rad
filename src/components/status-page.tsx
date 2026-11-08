'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Wrench, XCircle } from 'lucide-react';
import type { StatusIncident } from '@/db/schema';
import { Button, Chip, ConfirmButton, Field, Input, Modal, Panel, Select, Textarea, useToast } from './ui';
import { useApp } from './app-context';
import * as DX from '@/lib/desk-ext-actions';
import { STATUS_LABEL } from '@/lib/options';
import { cn } from '@/lib/utils';

const fmt = (d: Date | string) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
const open = (i: Pick<StatusIncident, 'status'>) => !['resolved', 'completed'].includes(i.status);
const impactTone = (i: Pick<StatusIncident, 'impact' | 'kind'>) => (i.kind === 'maintenance' ? 'accent' : i.impact === 'critical' ? 'bad' : i.impact === 'major' ? 'bad' : 'warn') as 'accent' | 'bad' | 'warn';
/** Pure (unit-tested): the state a component shows, from the incidents affecting it right now. */
export function componentState(name: string, list: Pick<StatusIncident, 'status' | 'impact' | 'kind' | 'components' | 'startsAt'>[], now = new Date()) {
  const live = list.filter((i) => open(i) && i.components.includes(name) && (i.kind !== 'maintenance' || (i.status === 'in_progress' || +new Date(i.startsAt) <= +now)));
  if (live.some((i) => i.kind === 'incident' && i.impact === 'critical')) return 'Major outage';
  if (live.some((i) => i.kind === 'incident' && i.impact === 'major')) return 'Partial outage';
  if (live.some((i) => i.kind === 'incident')) return 'Degraded performance';
  if (live.some((i) => i.kind === 'maintenance')) return 'Under maintenance';
  return 'Operational';
}
const STATE_ICON: Record<string, JSX.Element> = { Operational: <CheckCircle2 size={16} className="text-good" />, 'Degraded performance': <AlertTriangle size={16} className="text-warn" />, 'Partial outage': <AlertTriangle size={16} className="text-bad" />, 'Major outage': <XCircle size={16} className="text-bad" />, 'Under maintenance': <Wrench size={16} className="text-accent" /> };

export function PublicStatus({ title, components, incidents }: { title: string; components: string[]; incidents: StatusIncident[] }) {
  const states = components.map((c) => [c, componentState(c, incidents)] as const); const allOk = states.every(([, s]) => s === 'Operational');
  const live = incidents.filter(open); const past = incidents.filter((i) => !open(i));
  return <div className="mx-auto flex max-w-3xl flex-col gap-5">
    <div><p className="eyebrow">{title}</p><h1 className="font-display text-[28px] font-bold tracking-tight">System status</h1></div>
    <div className={cn('flex items-center gap-3 rounded-2xl p-4 text-[15px] font-semibold', allOk ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn')}>{allOk ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}{allOk ? 'All systems operational' : 'Some systems are affected'}</div>
    {live.map((i) => <IncidentCard key={i.id} i={i} />)}
    <div className="panel">{states.map(([c, s]) => <div key={c} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0"><span className="flex-1 text-[14px] font-medium">{c}</span><span className="flex items-center gap-1.5 text-[13px]">{STATE_ICON[s]}{s}</span></div>)}</div>
    {past.length > 0 && <><h2 className="font-display text-[17px] font-bold">Recently resolved</h2>{past.map((i) => <IncidentCard key={i.id} i={i} />)}</>}
  </div>;
}
function IncidentCard({ i, children }: { i: StatusIncident; children?: React.ReactNode }) {
  return <div className="panel p-5"><div className="flex flex-wrap items-center gap-2"><Chip tone={open(i) ? impactTone(i) : 'good'}>{i.kind === 'maintenance' ? 'Maintenance' : `${i.impact[0].toUpperCase()}${i.impact.slice(1)} incident`}</Chip><b className="text-[15px]">{i.title}</b><span className="flex-1" />{children}</div>
    <p className="mt-0.5 text-xs text-muted">{i.components.join(', ')} · {i.kind === 'maintenance' ? `${fmt(i.startsAt)}${i.endsAt ? ` – ${fmt(i.endsAt)}` : ''}` : `since ${fmt(i.startsAt)}`} (Gulf time)</p>
    <ol className="mt-3 flex flex-col gap-2 border-l-2 border-line pl-4">{i.updates.map((u, k) => <li key={k} className="text-[13.5px]"><b>{STATUS_LABEL[u.status] || u.status}</b> <span className="text-xs text-muted">· {fmt(u.at)}</span><div className="whitespace-pre-wrap">{u.text}</div></li>)}</ol></div>;
}
/** Portal banner for anything live. */
export function IncidentBanner({ incidents }: { incidents: Pick<StatusIncident, 'id' | 'title' | 'kind' | 'impact' | 'status' | 'startsAt'>[] }) {
  const live = incidents.filter(open).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'incident' ? -1 : 1)); if (!live.length) return null;
  return <div className="border-b border-warn/30 bg-warn-soft"><div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2.5 text-[13.5px] md:px-6"><AlertTriangle size={16} className="text-warn" />
    <b>{live[0].kind === 'maintenance' ? 'Planned maintenance' : 'Service issue'}:</b> {live[0].title}{live.length > 1 ? ` (+${live.length - 1} more)` : ''}<a href="/status" className="ml-auto font-semibold text-accent hover:underline">Status page</a></div></div>;
}

/** Desk: post and update incidents and maintenance. */
export function StatusAdmin({ incidents }: { incidents: StatusIncident[] }) {
  const { settings, me } = useApp(); const toast = useToast(); const router = useRouter();
  const [edit, setEdit] = useState<{ id?: string; title: string; kind: StatusIncident['kind']; status: StatusIncident['status']; impact: StatusIncident['impact']; components: string[]; message: string; startsAt: string; endsAt: string } | null>(null);
  const local = (d: Date | null) => d ? new Date(+d + 4 * 3600_000).toISOString().slice(0, 16) : '';
  const statuses = (k: string) => (k === 'maintenance' ? ['scheduled', 'in_progress', 'completed'] : ['investigating', 'identified', 'monitoring', 'resolved']) as StatusIncident['status'][];
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><p className="eyebrow">Helpdesk</p><h1 className="font-display text-[28px] font-bold tracking-tight">Status page</h1>
      <p className="text-[13.5px] text-muted">Tell every customer about outages and maintenance at once. Live items show as a banner in the portal and on <a href="/status" target="_blank" className="text-accent hover:underline">the public status page</a>.{!settings.statusPageEnabled && ' The public page is switched off in Helpdesk settings.'}</p></div>
      {me.deskRole !== 'light' && <Button variant="primary" onClick={() => setEdit({ title: '', kind: 'incident', status: 'investigating', impact: 'minor', components: [], message: '', startsAt: local(new Date()), endsAt: '' })}><Plus size={15} />Post incident</Button>}</div>
    {incidents.map((i) => <IncidentCard key={i.id} i={i}>{me.deskRole !== 'light' && <><Button size="sm" variant="ghost" onClick={() => setEdit({ id: i.id, title: i.title, kind: i.kind, status: i.status, impact: i.impact, components: i.components, message: '', startsAt: local(i.startsAt), endsAt: local(i.endsAt) })}>Post update</Button>
      {me.deskRole === 'admin' && <ConfirmButton size="sm" variant="ghost" confirmText="Delete?" onConfirm={async () => { const r = await DX.deleteStatusIncident(i.id); if (!r.ok) return toast(r.error, 'bad'); router.refresh(); }}>Delete</ConfirmButton>}</>}</IncidentCard>)}
    {!incidents.length && <Panel><p className="px-5 py-10 text-center text-[13px] text-muted">Nothing posted in the last 30 days. All systems show as operational.</p></Panel>}
    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Post an update' : 'New incident or maintenance'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
      const toIso = (v: string) => v ? new Date(new Date(v + ':00Z').getTime() - 4 * 3600_000).toISOString() : '';
      const r = await DX.saveStatusIncident({ ...edit, startsAt: toIso(edit.startsAt), endsAt: toIso(edit.endsAt) || null }); if (!r.ok) return toast(r.error, 'bad'); toast('Posted'); setEdit(null); router.refresh(); }}>Post</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Title" required className="col-span-full"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Management console slow to load" /></Field>
        <Field label="Type"><Select value={edit.kind} disabled={!!edit.id} onChange={(e) => { const k = e.target.value as 'incident'; setEdit({ ...edit, kind: k, status: statuses(k)[0] }); }}><option value="incident">Incident</option><option value="maintenance">Planned maintenance</option></Select></Field>
        <Field label="Status"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as 'resolved' })}>{statuses(edit.kind).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
        {edit.kind === 'incident' && <Field label="Impact"><Select value={edit.impact} onChange={(e) => setEdit({ ...edit, impact: e.target.value as 'minor' })}><option value="minor">Minor — degraded</option><option value="major">Major — partial outage</option><option value="critical">Critical — full outage</option></Select></Field>}
        <Field label="Starts (Gulf time)"><Input type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></Field>
        {edit.kind === 'maintenance' && <Field label="Ends (Gulf time)"><Input type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} /></Field>}
        <Field label="Affected services" className="col-span-full"><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-line p-3">{settings.statusComponents.map((c) => <label key={c} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={edit.components.includes(c)} onChange={(e) => setEdit({ ...edit, components: e.target.checked ? [...edit.components, c] : edit.components.filter((x) => x !== c) })} className="h-4 w-4 accent-[rgb(var(--accent))]" />{c}</label>)}</div></Field>
        <Field label="Message to customers" required className="col-span-full"><Textarea className="min-h-[110px]" value={edit.message} onChange={(e) => setEdit({ ...edit, message: e.target.value })} placeholder="What’s happening, who is affected and when we’ll update next." /></Field>
      </div></Modal>}
  </div>;
}
