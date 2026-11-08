'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, Copy, KeyRound, LogOut, Mail, Monitor, Plus, RotateCcw, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import type { CannedResponse, Department, SlaPolicy, Team, TicketStatus } from '@/db/schema';
import { Button, Chip, ConfirmButton, Field, IconButton, Input, Modal, Panel, Segmented, Select, Textarea, useToast } from './ui';
import { useApp } from './app-context';
import * as A from '@/lib/actions';
import * as D from '@/lib/desk-actions';
import { cn, timeAgo } from '@/lib/utils';
import { PRIORITIES, TIERS } from '@/lib/options';

export type DeptRow = Omit<Department, 'imap'> & { imap: { host: string; port: number; secure: boolean; user: string; folder?: string } | null; memberIds: string[] };
export type TeamRow = Team & { memberIds: string[] };
export type DeskSetup = { departments: DeptRow[]; teams: TeamRow[]; statuses: TicketStatus[]; slas: SlaPolicy[]; canned: CannedResponse[] };
export type SessionRow = { id: string; userAgent: string | null; ip: string | null; createdAt: Date; lastSeenAt: Date; current: boolean };
export type TrashRow = { id: string; entity: string; label: string; deletedBy: string | null; deletedAt: Date };

function useRun() {
  const toast = useToast(); const router = useRouter();
  return async (p: Promise<{ ok: boolean; error?: string }>, ok?: string) => { const r = await p; if (!r.ok) { toast(r.error || 'Something went wrong', 'bad'); return false; } if (ok) toast(ok); router.refresh(); return true; };
}
const Intro = ({ children }: { children: ReactNode }) => <p className="mb-4 max-w-[70ch] text-[13.5px] text-muted">{children}</p>;
const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) =>
  <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />{children}</label>;
const Empty = ({ children }: { children: ReactNode }) => <p className="px-5 py-8 text-center text-[13px] text-muted">{children}</p>;
const ASSIGN: [string, string][] = [['manual', 'Manual — agents pick tickets'], ['round_robin', 'Round robin — next available agent'], ['load', 'Least busy — fewest open tickets']];

/* ---------- departments & teams ---------- */
type DEdit = { id?: string; name: string; email: string; active: boolean; assignMode: 'manual' | 'round_robin' | 'load'; autoAck: boolean; signature: string; memberIds: string[]; useImap: boolean; host: string; port: string; secure: boolean; user: string; password: string; folder: string };
export function DepartmentsTab({ desk }: { desk: DeskSetup }) {
  const { users } = useApp(); const run = useRun(); const toast = useToast();
  const [edit, setEdit] = useState<DEdit | null>(null); const [team, setTeam] = useState<{ id?: string; departmentId: string; name: string; memberIds: string[]; leadId?: string | null } | null>(null);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || 'Former user';
  const deskPeople = useApp().desk?.agents.filter((a) => a.active && a.deskRole !== 'none') || [];
  const open = (d?: DeptRow) => setEdit(d ? { id: d.id, name: d.name, email: d.email || '', active: d.active, assignMode: d.assignMode, autoAck: d.autoAck, signature: d.signature || '', memberIds: d.memberIds, useImap: !!d.imap, host: d.imap?.host || '', port: String(d.imap?.port || 993), secure: d.imap?.secure ?? true, user: d.imap?.user || '', password: '', folder: d.imap?.folder || 'INBOX' }
    : { name: '', email: '', active: true, assignMode: 'round_robin', autoAck: true, signature: '', memberIds: [], useImap: false, host: '', port: '993', secure: true, user: '', password: '', folder: 'INBOX' });
  const save = async () => { if (!edit) return; const r = await run(D.saveDepartment({ id: edit.id, name: edit.name, email: edit.email, active: edit.active, assignMode: edit.assignMode, autoAck: edit.autoAck, signature: edit.signature, memberIds: edit.memberIds,
    imap: edit.useImap ? { host: edit.host, port: +edit.port || 993, secure: edit.secure, user: edit.user, password: edit.password || undefined, folder: edit.folder } : null }), 'Department saved'); if (r) setEdit(null); };
  return <>
    <Intro>Departments own tickets: each has its own support address, agents and assignment rule. Agents see tickets in their departments (or wider, per their ticket scope under Users). Teams are optional groups inside a department, such as “L1” and “L2”.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => open()}><Plus size={15} />Department</Button></div>
    <div className="grid gap-4">{desk.departments.map((d) => <Panel key={d.id} title={<span className="flex items-center gap-2">{d.name}{!d.active && <Chip>Off</Chip>}</span>}
      actions={<><Button size="sm" variant="ghost" onClick={() => open(d)}>Edit</Button><ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(D.deleteDepartment(d.id), 'Department deleted')}>Delete</ConfirmButton></>} bodyClass="grid gap-3 p-5 text-[13.5px]">
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-muted">
        <span className="flex items-center gap-1.5"><Mail size={14} />{d.email || 'No support address'}</span>
        <span>{ASSIGN.find((a) => a[0] === d.assignMode)?.[1].split(' — ')[0]} assignment</span>
        <span>{d.autoAck ? 'Sends an acknowledgement' : 'No acknowledgement'}</span>
        {d.imap ? <span className={cn(d.imapStatus && d.imapStatus !== 'ok' && !d.imapStatus.startsWith('OK') ? 'text-bad' : '')}>Mailbox {d.imap.user}{d.imapCheckedAt ? ` · checked ${timeAgo(d.imapCheckedAt)}` : ''}{d.imapStatus ? ` · ${d.imapStatus}` : ''}</span> : <span>No mailbox connected</span>}
      </div>
      <div><span className="eyebrow mr-2">Agents</span>{d.memberIds.length ? d.memberIds.map((id) => <Chip key={id} className="mr-1 mb-1">{nameOf(id)}</Chip>) : <span className="text-muted">None yet — add agents so tickets can be assigned.</span>}</div>
      <div className="flex flex-wrap items-center gap-2"><span className="eyebrow mr-1">Teams</span>
        {desk.teams.filter((t) => t.departmentId === d.id).map((t) => <button key={t.id} title={t.leadId ? `Lead: ${nameOf(t.leadId)}` : undefined} onClick={() => setTeam({ id: t.id, departmentId: d.id, name: t.name, memberIds: t.memberIds, leadId: t.leadId })} className="rounded-full border border-line px-2.5 py-0.5 text-[12.5px] hover:border-accent">{t.name} · {t.memberIds.length}</button>)}
        <Button size="sm" variant="ghost" onClick={() => setTeam({ departmentId: d.id, name: '', memberIds: [] })}><Plus size={13} />Team</Button>
        {d.imap && <Button size="sm" variant="ghost" onClick={async () => { const r = await D.testMailbox(d.id); toast(r.ok ? `Mailbox: ${r.result}` : r.error, r.ok ? undefined : 'bad'); }}>Check mailbox now</Button>}
      </div>
    </Panel>)}{!desk.departments.length && <Panel><Empty>No departments yet.</Empty></Panel>}</div>

    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Edit department' : 'New department'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Name" required><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Support, Renewals" /></Field>
        <Field label="Support address" hint="Replies are sent from (Reply-To) this address"><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="support@raidefend.com" /></Field>
        <Field label="Assign new tickets"><Select value={edit.assignMode} onChange={(e) => setEdit({ ...edit, assignMode: e.target.value as 'manual' })}>{ASSIGN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <div className="grid content-end gap-2"><Check checked={edit.autoAck} onChange={(v) => setEdit({ ...edit, autoAck: v })}>Email the customer an acknowledgement with the ticket number</Check><Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })}>Active</Check></div>
        <Field label="Agents in this department" className="col-span-full"><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-line p-3">{deskPeople.length ? deskPeople.map((a) => <Check key={a.id} checked={edit.memberIds.includes(a.id)} onChange={(v) => setEdit({ ...edit, memberIds: v ? [...edit.memberIds, a.id] : edit.memberIds.filter((x) => x !== a.id) })}>{a.name}<span className="text-xs text-muted">{a.deskRole === 'light' ? ' (light)' : a.deskRole === 'admin' ? ' (admin)' : ''}</span></Check>) : <span className="text-[13px] text-muted">Give people a helpdesk role under Users first.</span>}</div></Field>
        <Field label="Department signature" hint="Added under every reply from this department" className="col-span-full"><Textarea value={edit.signature} onChange={(e) => setEdit({ ...edit, signature: e.target.value })} placeholder={'Raidefend Support\n+971 4 000 0000'} /></Field>
        <fieldset className="col-span-full grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"><legend className="px-1"><Check checked={edit.useImap} onChange={(v) => setEdit({ ...edit, useImap: v })}><b>Fetch email from a mailbox (IMAP)</b></Check></legend>
          {edit.useImap ? <>
            <p className="col-span-full text-[12.5px] text-muted">Checked every 2 minutes. New emails become tickets; replies thread onto the ticket by its number or email headers. Use an app password for Microsoft 365 or Gmail.</p>
            <Field label="Server"><Input value={edit.host} onChange={(e) => setEdit({ ...edit, host: e.target.value })} placeholder="outlook.office365.com" /></Field>
            <div className="grid grid-cols-[1fr_auto] items-end gap-3"><Field label="Port"><Input type="number" value={edit.port} onChange={(e) => setEdit({ ...edit, port: e.target.value })} /></Field><Check checked={edit.secure} onChange={(v) => setEdit({ ...edit, secure: v })}>SSL/TLS</Check></div>
            <Field label="Username"><Input value={edit.user} onChange={(e) => setEdit({ ...edit, user: e.target.value })} autoComplete="off" /></Field>
            <Field label="Password" hint={edit.id && edit.host ? 'Leave blank to keep the saved password' : 'Stored encrypted'}><Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" /></Field>
            <Field label="Folder"><Input value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} /></Field>
          </> : <p className="col-span-full text-[12.5px] text-muted">Without a mailbox, tickets still come in from the portal, the web form, and agents logging calls or emails.</p>}
        </fieldset>
      </div></Modal>}

    {team && <Modal open onClose={() => setTeam(null)} title={team.id ? 'Edit team' : 'New team'} sub={desk.departments.find((d) => d.id === team.departmentId)?.name}
      footer={<>{team.id && <ConfirmButton variant="danger" confirmText="Delete team?" onConfirm={async () => { if (await run(D.deleteTeam(team.id!), 'Team deleted')) setTeam(null); }}>Delete</ConfirmButton>}<span className="flex-1" /><Button variant="ghost" onClick={() => setTeam(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(D.saveTeam(team), 'Team saved')) setTeam(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3"><Field label="Name" required><Input autoFocus value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="e.g. L2 engineers" /></Field>
        <Field label="Members" hint="Only agents of this department can join"><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-line p-3">
          {(desk.departments.find((d) => d.id === team.departmentId)?.memberIds || []).map((id) => <Check key={id} checked={team.memberIds.includes(id)} onChange={(v) => setTeam({ ...team, memberIds: v ? [...team.memberIds, id] : team.memberIds.filter((x) => x !== id) })}>{nameOf(id)}</Check>)}</div></Field>
        <Field label="Team lead" hint="First stop on the escalation ladder"><Select value={team.leadId || ''} onChange={(e) => setTeam({ ...team, leadId: e.target.value || null })}><option value="">No team lead</option>{(desk.departments.find((d) => d.id === team.departmentId)?.memberIds || []).map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</Select></Field></div></Modal>}
  </>;
}

/* ---------- statuses ---------- */
const CAT: Record<string, [string, 'accent' | 'warn' | 'good']> = { open: ['Open', 'accent'], onhold: ['On hold — SLA paused', 'warn'], closed: ['Closed', 'good'] };
export function StatusesTab({ statuses }: { statuses: TicketStatus[] }) {
  const run = useRun(); const [edit, setEdit] = useState<{ id?: string; name: string; category: 'open' | 'onhold' | 'closed'; isDefault: boolean } | null>(null);
  const move = (i: number, d: number) => { const ids = statuses.map((s) => s.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; run(D.reorderStatuses(ids)); };
  return <>
    <Intro>Every status belongs to a category. “On hold” pauses the SLA clock (e.g. waiting on the customer). “Closed” stops it and counts as resolved. The default status is given to new tickets.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ name: '', category: 'open', isDefault: false })}><Plus size={15} />Status</Button></div>
    <Panel>{statuses.map((s, i) => <div key={s.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
      <div className="flex flex-col"><IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={13} /></IconButton><IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === statuses.length - 1}><ArrowDown size={13} /></IconButton></div>
      <b className="text-[13.5px]">{s.name}</b><Chip tone={CAT[s.category][1]}>{CAT[s.category][0]}</Chip>{s.isDefault && <Chip tone="outline">Default</Chip>}<span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: s.id, name: s.name, category: s.category, isDefault: s.isDefault })}>Edit</Button>
      <ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(D.deleteStatus(s.id), 'Status deleted')}>Delete</ConfirmButton></div>)}{!statuses.length && <Empty>No statuses.</Empty>}</Panel>
    {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit status' : 'New status'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(D.saveStatus(edit), 'Status saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3"><Field label="Name" required><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Category"><Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as 'open' })}>{Object.entries(CAT).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {edit.category === 'open' && <Check checked={edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })}>Default for new tickets</Check>}</div></Modal>}
  </>;
}

/* ---------- SLA & business hours ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toHM = (m: number) => m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
type SEdit = { id?: string; name: string; departmentId: string; tier: string; targets: Record<string, { first: string; resolve: string }>; businessHours: boolean; warnPct: string; escalateTo: 'manager' | 'department' | 'both'; active: boolean };
export function SlaTab({ slas, departments }: { slas: SlaPolicy[]; departments: DeptRow[] }) {
  const { settings } = useApp(); const run = useRun(); const [edit, setEdit] = useState<SEdit | null>(null);
  const [bh, setBh] = useState(settings.businessHours); const [holiday, setHoliday] = useState('');
  const move = (i: number, d: number) => { const ids = slas.map((s) => s.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; run(D.reorderSla(ids)); };
  const open = (s?: SlaPolicy) => setEdit(s ? { id: s.id, name: s.name, departmentId: s.departmentId || '', tier: s.tier || '', targets: Object.fromEntries(PRIORITIES.map((p) => [p, { first: String((s.targets[p]?.first ?? 480) / 60), resolve: String((s.targets[p]?.resolve ?? 2400) / 60) }])), businessHours: s.businessHours, warnPct: String(s.warnPct), escalateTo: s.escalateTo, active: s.active }
    : { name: '', departmentId: '', tier: '', targets: { Low: { first: '16', resolve: '80' }, Medium: { first: '8', resolve: '40' }, High: { first: '4', resolve: '16' }, Urgent: { first: '1', resolve: '8' } }, businessHours: true, warnPct: '80', escalateTo: 'both', active: true });
  const save = async () => { if (!edit) return; const targets = Object.fromEntries(PRIORITIES.map((p) => [p, { first: Math.round((+edit.targets[p].first || 0) * 60), resolve: Math.round((+edit.targets[p].resolve || 0) * 60) }]));
    if (await run(D.saveSlaPolicy({ id: edit.id, name: edit.name, departmentId: edit.departmentId || null, tier: edit.tier || null, targets, businessHours: edit.businessHours, warnPct: +edit.warnPct || 80, escalateTo: edit.escalateTo, active: edit.active }), 'SLA policy saved')) setEdit(null); };
  return <div className="grid gap-4">
    <Intro>SLA policies set how fast the first response and the resolution must happen, per priority. The first active policy (top to bottom) whose department and customer tier match is applied. Agents get a warning at the warning point; on breach the ticket is flagged and escalated.</Intro>
    <Panel title="Business hours" bodyClass="grid gap-3.5 p-5" actions={<Button size="sm" variant="primary" onClick={() => run(D.saveDeskSettings({ businessHours: bh }), 'Business hours saved')}>Save hours</Button>}>
      <p className="text-[13px] text-muted">SLA clocks only run during these hours (Gulf Standard Time) unless a policy says “calendar hours”.</p>
      <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <button key={d} onClick={() => setBh({ ...bh, days: bh.days.includes(i) ? bh.days.filter((x) => x !== i) : [...bh.days, i] })} className={cn('rounded-lg border px-3 py-1.5 text-[13px] font-medium', bh.days.includes(i) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted')}>{d}</button>)}</div>
      <div className="flex flex-wrap items-end gap-3"><Field label="Start"><Input type="time" value={bh.start} onChange={(e) => setBh({ ...bh, start: e.target.value })} /></Field><Field label="End"><Input type="time" value={bh.end} onChange={(e) => setBh({ ...bh, end: e.target.value })} /></Field></div>
      <div><span className="eyebrow">Holidays</span><div className="mt-2 flex flex-wrap items-center gap-2">{bh.holidays.map((h) => <Chip key={h}>{new Date(h + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}<button aria-label={`Remove ${h}`} className="ml-1 text-muted hover:text-bad" onClick={() => setBh({ ...bh, holidays: bh.holidays.filter((x) => x !== h) })}>×</button></Chip>)}
        <Input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="h-9 w-auto" aria-label="Holiday date" /><Button size="sm" disabled={!holiday} onClick={() => { setBh({ ...bh, holidays: [...new Set([...bh.holidays, holiday])].sort() }); setHoliday(''); }}>Add</Button></div></div>
    </Panel>
    <div className="flex"><span className="flex-1" /><Button variant="primary" onClick={() => open()}><Plus size={15} />SLA policy</Button></div>
    <Panel title="Policies" count={slas.length}>{slas.map((s, i) => <div key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
      <div className="flex flex-col"><IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={13} /></IconButton><IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === slas.length - 1}><ArrowDown size={13} /></IconButton></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">{s.name}{!s.active && <Chip>Off</Chip>}<Chip tone="outline">{s.departmentId ? departments.find((d) => d.id === s.departmentId)?.name : 'Any department'}</Chip><Chip tone="outline">{s.tier ? `${s.tier} customers` : 'Any customer'}</Chip></div>
        <div className="num mt-0.5 text-xs text-muted">{PRIORITIES.slice().reverse().map((p) => s.targets[p] ? `${p}: ${toHM(s.targets[p].first)} / ${toHM(s.targets[p].resolve)}` : null).filter(Boolean).join(' · ')} · {s.businessHours ? 'business hours' : 'calendar hours'}</div></div>
      <Button size="sm" variant="ghost" onClick={() => open(s)}>Edit</Button><ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(D.deleteSlaPolicy(s.id), 'Policy deleted')}>Delete</ConfirmButton></div>)}{!slas.length && <Empty>No SLA policies — tickets get no due dates.</Empty>}</Panel>
    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Edit SLA policy' : 'New SLA policy'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Name" required className="col-span-full"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Strategic customers" /></Field>
        <Field label="Department"><Select value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}><option value="">Any department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Customer tier" hint="From the company record"><Select value={edit.tier} onChange={(e) => setEdit({ ...edit, tier: e.target.value })}><option value="">Any customer</option>{TIERS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <div className="col-span-full overflow-x-auto"><table className="tbl min-w-[420px]"><thead><tr><th>Priority</th><th>First response (hours)</th><th>Resolve within (hours)</th></tr></thead><tbody>
          {PRIORITIES.slice().reverse().map((p) => <tr key={p}><td className="font-semibold">{p}</td>
            <td><Input type="number" min={0} step="0.25" value={edit.targets[p].first} onChange={(e) => setEdit({ ...edit, targets: { ...edit.targets, [p]: { ...edit.targets[p], first: e.target.value } } })} aria-label={`${p} first response hours`} /></td>
            <td><Input type="number" min={0} step="0.25" value={edit.targets[p].resolve} onChange={(e) => setEdit({ ...edit, targets: { ...edit.targets, [p]: { ...edit.targets[p], resolve: e.target.value } } })} aria-label={`${p} resolution hours`} /></td></tr>)}</tbody></table></div>
        <Field label="Clock runs during"><Segmented value={edit.businessHours ? 'b' : 'c'} onChange={(v) => setEdit({ ...edit, businessHours: v === 'b' })} options={[['b', 'Business hours'], ['c', 'Calendar hours (24/7)']]} /></Field>
        <Field label="Warn agents at" hint="Percent of the time used"><Input type="number" min={10} max={99} value={edit.warnPct} onChange={(e) => setEdit({ ...edit, warnPct: e.target.value })} /></Field>
        <Field label="On breach, escalate to"><Select value={edit.escalateTo} onChange={(e) => setEdit({ ...edit, escalateTo: e.target.value as 'both' })}><option value="manager">The agent’s manager</option><option value="department">Helpdesk admins</option><option value="both">Both</option></Select></Field>
        <div className="flex items-end"><Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })}>Active</Check></div>
      </div></Modal>}
  </div>;
}

/* ---------- canned responses ---------- */
export function CannedTab({ canned, departments, canShare }: { canned: CannedResponse[]; departments: { id: string; name: string }[]; canShare: boolean }) {
  const { me } = useApp(); const run = useRun(); const [edit, setEdit] = useState<{ id?: string; name: string; body: string; departmentId: string; shared: boolean } | null>(null);
  return <>
    <Intro>Saved replies agents insert from the ticket composer. Placeholders: {'{{customer_name}}'}, {'{{ticket_number}}'}, {'{{subject}}'}, {'{{agent_name}}'}. Shared replies are visible to every agent; personal replies only to you.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ name: '', body: '', departmentId: '', shared: canShare })}><Plus size={15} />Canned response</Button></div>
    <Panel>{canned.map((c) => { const mine = c.ownerId === me.id; const editable = mine || canShare; return <div key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
      <button className="min-w-0 flex-1 text-left" disabled={!editable} onClick={() => setEdit({ id: c.id, name: c.name, body: c.body, departmentId: c.departmentId || '', shared: !c.ownerId })}>
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">{c.name}<Chip tone={c.ownerId ? 'outline' : 'accent'}>{c.ownerId ? 'Personal' : 'Shared'}</Chip>{c.departmentId && <Chip>{departments.find((d) => d.id === c.departmentId)?.name}</Chip>}</div>
        <div className="truncate text-xs text-muted">{c.body}</div></button>
      {editable && <ConfirmButton size="sm" confirmText="Remove?" onConfirm={() => run(D.deleteCanned(c.id), 'Removed')}>Remove</ConfirmButton>}</div>; })}
      {!canned.length && <Empty>No canned responses yet.</Empty>}</Panel>
    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Edit canned response' : 'New canned response'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(D.saveCanned({ ...edit, departmentId: edit.departmentId || null }), 'Saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2"><Field label="Name" required className="col-span-full"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Licence key resent" /></Field>
        <Field label="Department" hint="Optional: show only for this department"><Select value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <div className="flex items-end">{canShare ? <Check checked={edit.shared} onChange={(v) => setEdit({ ...edit, shared: v })}>Shared with all agents</Check> : <span className="text-[12.5px] text-muted">Personal — only helpdesk admins create shared replies.</span>}</div>
        <Field label="Reply" className="col-span-full"><Textarea className="min-h-[200px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field></div></Modal>}
  </>;
}

/* ---------- helpdesk settings ---------- */
export function HelpdeskTab() {
  const { settings } = useApp(); const run = useRun();
  const [v, setV] = useState({ ticketPrefix: settings.ticketPrefix, types: settings.ticketTypes.join('\n'), cats: settings.ticketCategories.join('\n'), csatEnabled: settings.csatEnabled, portalEnabled: settings.portalEnabled, webFormEnabled: settings.webFormEnabled, portalTitle: settings.portalTitle, portalWelcome: settings.portalWelcome, autoCloseDays: String(settings.autoCloseDays), reopenOnReply: settings.reopenOnReply });
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const [origin, setOrigin] = useState(''); useEffect(() => setOrigin(window.location.origin), []);
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="Tickets" bodyClass="grid gap-3.5 p-5 sm:grid-cols-2">
      <Field label="Ticket number prefix" hint={`Tickets look like ${v.ticketPrefix || 'RD'}-1042`}><Input value={v.ticketPrefix} maxLength={6} onChange={(e) => setV({ ...v, ticketPrefix: e.target.value.toUpperCase() })} /></Field>
      <Field label="Auto-close resolved tickets after" hint="Days without a customer reply (0 = never)"><Input type="number" min={0} max={90} value={v.autoCloseDays} onChange={(e) => setV({ ...v, autoCloseDays: e.target.value })} /></Field>
      <Field label="Ticket types" hint="One per line"><Textarea value={v.types} onChange={(e) => setV({ ...v, types: e.target.value })} /></Field>
      <Field label="Categories" hint="One per line"><Textarea value={v.cats} onChange={(e) => setV({ ...v, cats: e.target.value })} /></Field>
      <div className="col-span-full grid gap-2"><Check checked={v.reopenOnReply} onChange={(x) => setV({ ...v, reopenOnReply: x })}>Reopen a resolved ticket when the customer replies</Check>
        <Check checked={v.csatEnabled} onChange={(x) => setV({ ...v, csatEnabled: x })}>Ask customers to rate the support when a ticket is resolved</Check></div>
    </Panel>
    <Panel title="Customer portal & web form" bodyClass="grid gap-3.5 p-5">
      <Check checked={v.portalEnabled} onChange={(x) => setV({ ...v, portalEnabled: x })}>Customer portal — customers sign in to see their tickets and the help centre</Check>
      <Check checked={v.webFormEnabled} onChange={(x) => setV({ ...v, webFormEnabled: x })}>Public web form — anyone can open a ticket without an account</Check>
      <Field label="Portal title"><Input value={v.portalTitle} onChange={(e) => setV({ ...v, portalTitle: e.target.value })} /></Field>
      <Field label="Welcome text"><Textarea value={v.portalWelcome} onChange={(e) => setV({ ...v, portalWelcome: e.target.value })} /></Field>
      <div className="grid gap-1.5 rounded-xl bg-sunken p-3 text-[12.5px]"><span className="text-muted">Share these links (or put them on raidefend.com):</span>
        <span>Help centre &amp; sign in: <b className="num select-all">{origin}/portal</b></span><span>Web form: <b className="num select-all">{origin}/support</b></span></div>
    </Panel>
    <div className="col-span-full"><Button variant="primary" onClick={() => run(D.saveDeskSettings({ ticketPrefix: v.ticketPrefix, ticketTypes: lines(v.types), ticketCategories: lines(v.cats), csatEnabled: v.csatEnabled, portalEnabled: v.portalEnabled, webFormEnabled: v.webFormEnabled, portalTitle: v.portalTitle, portalWelcome: v.portalWelcome, autoCloseDays: +v.autoCloseDays || 0, reopenOnReply: v.reopenOnReply }), 'Helpdesk settings saved')}>Save helpdesk settings</Button></div>
  </div>;
}

/* ---------- recycle bin ---------- */
const ENTITY: Record<string, string> = { deal: 'Deal', lead: 'Lead', contact: 'Contact', company: 'Company', activity: 'Activity', ticket: 'Ticket', product: 'Product' };
export function TrashTab({ items, canPurge, desk }: { items: TrashRow[]; canPurge: boolean; desk?: boolean }) {
  const { users } = useApp(); const run = useRun(); const [f, setF] = useState('all');
  const kinds = [...new Set(items.map((i) => i.entity))]; const list = f === 'all' ? items : items.filter((i) => i.entity === f);
  return <>
    <Intro>{desk ? 'Deleted tickets stay here for 30 days with their conversation, time logs and files, then are removed for good. Restoring puts the ticket back in its department.' : 'Deleted records stay here for 30 days with their notes, activities and files, then are removed for good. Restoring puts the record back where it was.'}</Intro>
    {kinds.length > 1 && <div className="mb-3"><Segmented value={f} onChange={setF} options={[['all', 'All'], ...kinds.map((k) => [k, ENTITY[k] || k] as [string, string])]} /></div>}
    <div className="panel overflow-x-auto"><table className="tbl min-w-[620px]"><thead><tr><th>Record</th><th>Type</th><th>Deleted by</th><th>When</th><th>Removed for good</th><th /></tr></thead>
      <tbody>{list.map((i) => { const left = 30 - Math.floor((Date.now() - new Date(i.deletedAt).getTime()) / 864e5); return <tr key={i.id}><td className="font-semibold">{i.label}</td><td>{ENTITY[i.entity] || i.entity}</td><td>{users.find((u) => u.id === i.deletedBy)?.name || '—'}</td>
        <td className="whitespace-nowrap text-muted">{timeAgo(i.deletedAt)}</td><td className={cn('text-[13px]', left <= 3 ? 'text-bad' : 'text-muted')}>in {Math.max(0, left)} days</td>
        <td className="whitespace-nowrap text-right"><Button size="sm" onClick={() => run(A.restoreFromTrash(i.id), `${ENTITY[i.entity] || 'Record'} restored`)}><RotateCcw size={13} />Restore</Button>
          {canPurge && <ConfirmButton size="sm" variant="ghost" confirmText="Delete forever?" onConfirm={() => run(A.purgeTrashItem(i.id), 'Deleted for good')}><Trash2 size={13} /></ConfirmButton>}</td></tr>; })}
        {!list.length && <tr><td colSpan={6} className="py-8 text-center text-muted">The recycle bin is empty.</td></tr>}</tbody></table></div>
  </>;
}

/* ---------- my account: security, calendar, signature ---------- */
const device = (ua: string | null) => { if (!ua) return 'Unknown device'; const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''; return `${b}${os ? ' on ' + os : ''}`; };
export function SecurityPanels({ sessions, totpEnabled }: { sessions: SessionRow[]; totpEnabled: boolean }) {
  const run = useRun(); const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null); const [code, setCode] = useState(''); const [codes, setCodes] = useState<string[] | null>(null); const [off, setOff] = useState(''); const [askOff, setAskOff] = useState(false);
  return <>
    <Panel title={<span className="flex items-center gap-2"><ShieldCheck size={16} className={totpEnabled ? 'text-good' : 'text-muted'} />Two-step sign-in</span>} bodyClass="grid gap-3 p-5 text-[13.5px]">
      {totpEnabled ? <><p><Chip tone="good">On</Chip> <span className="text-muted">You enter a 6-digit code from your authenticator app after your password.</span></p>
        {askOff ? <div className="flex flex-wrap items-end gap-2"><Field label="Your password to turn it off"><Input type="password" value={off} onChange={(e) => setOff(e.target.value)} autoComplete="current-password" /></Field><Button variant="danger" disabled={!off} onClick={async () => { if (await run(A.disableTwoFactor(off), 'Two-step sign-in turned off')) { setOff(''); setAskOff(false); } }}>Turn off</Button><Button variant="ghost" onClick={() => setAskOff(false)}>Cancel</Button></div>
          : <div><Button onClick={() => setAskOff(true)}>Turn off…</Button></div>}</>
        : setup ? <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={220} height={220} className="rounded-lg border border-line bg-white p-1" />
          <div className="grid content-start gap-3"><p>1. Scan the code with Microsoft Authenticator, Google Authenticator or 1Password.<br /><span className="text-xs text-muted">Can’t scan? Enter this key: <b className="num select-all">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</b></span></p>
            <p>2. Enter the 6-digit code it shows.</p>
            <div className="flex gap-2"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num w-32 text-center tracking-[0.3em]" aria-label="6-digit code" />
              <Button variant="primary" disabled={code.length !== 6} onClick={async () => { const r = await A.confirmTwoFactor(code); if (!r.ok) return toast(r.error, 'bad'); setCodes(r.recovery); setSetup(null); setCode(''); }}>Turn on</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div></div></div>
          : <><p className="text-muted">Protect your account with a code from your phone, so a stolen password alone can’t get in.</p><div><Button variant="primary" onClick={async () => { const r = await A.startTwoFactor(); if (!r.ok) return toast(r.error, 'bad'); setSetup({ secret: r.secret, qr: r.qr }); }}><Smartphone size={15} />Set up two-step sign-in</Button></div></>}
    </Panel>
    <Modal open={!!codes} onClose={() => setCodes(null)} title="Save your recovery codes" sub="Each code works once if you lose your phone. Store them somewhere safe — they won’t be shown again."
      footer={<><Button onClick={async () => { try { await navigator.clipboard.writeText(codes!.join('\n')); toast('Copied'); } catch { toast('Select the codes to copy them'); } }}><Copy size={14} />Copy</Button><Button variant="primary" onClick={() => { setCodes(null); window.location.reload(); }}>I’ve saved them</Button></>}>
      <div className="num grid select-all grid-cols-2 gap-2 pb-3 text-[15px]">{codes?.map((c) => <span key={c} className="rounded-lg bg-sunken px-3 py-2 text-center">{c}</span>)}</div></Modal>

    <Panel title="Signed-in devices" count={sessions.length} actions={<ConfirmButton size="sm" variant="danger" confirmText="Sign out everywhere?" onConfirm={() => A.signOutEverywhere()}><LogOut size={14} />Sign out everywhere</ConfirmButton>}>
      {sessions.map((s) => <div key={s.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
        <Monitor size={18} className="flex-none text-muted" /><div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{device(s.userAgent)}{s.current && <Chip tone="good" className="ml-2">This device</Chip>}</div>
          <div className="text-xs text-muted">{s.ip || 'Unknown IP'} · signed in {timeAgo(s.createdAt)} · active {timeAgo(s.lastSeenAt)}</div></div>
        {!s.current && <ConfirmButton size="sm" confirmText="Sign out?" onConfirm={() => run(A.revokeSession(s.id), 'Signed out that device')}>Sign out</ConfirmButton>}</div>)}
      {!sessions.length && <Empty>No active sessions.</Empty>}</Panel>
  </>;
}
export function CalendarPanel({ has }: { has: boolean }) {
  const run = useRun(); const toast = useToast(); const [url, setUrl] = useState('');
  return <Panel title={<span className="flex items-center gap-2"><CalendarDays size={16} />Calendar feed</span>} bodyClass="grid gap-3 p-5 text-[13.5px]">
    <p className="text-muted">See your CRM tasks, calls and meetings in Outlook, Google Calendar or your phone. Subscribe to this private link (“Add calendar → From internet”). It refreshes every few hours.</p>
    {url ? <div className="flex gap-2"><Input readOnly value={url} onFocus={(e) => e.target.select()} className="num text-[12px]" /><Button onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Copied'); } catch { toast('Select the link to copy it'); } }}><Copy size={14} />Copy</Button></div>
      : has ? <p><Chip tone="good">Active</Chip> <span className="text-muted">The link was shown when you created it. Create a new one if you lost it — the old link stops working.</span></p> : null}
    <div className="flex flex-wrap gap-2"><Button variant={has ? 'secondary' : 'primary'} onClick={async () => { const r = await A.newCalendarLink(); if (!r.ok) return toast(r.error, 'bad'); setUrl(window.location.origin + r.url); }}><KeyRound size={14} />{has ? 'Create a new link' : 'Create my calendar link'}</Button>
      {has && <ConfirmButton variant="ghost" confirmText="Turn off the feed?" onConfirm={async () => { if (await run(A.removeCalendarLink(), 'Calendar feed turned off')) setUrl(''); }}>Turn off</ConfirmButton>}</div>
  </Panel>;
}
export function SignaturePanel({ value }: { value: string }) {
  const run = useRun(); const [v, setV] = useState(value);
  return <Panel title="My email signature" bodyClass="grid gap-3 p-5"><p className="text-[13px] text-muted">Added under your ticket replies, above the department signature.</p>
    <Textarea value={v} onChange={(e) => setV(e.target.value)} placeholder={'Anto George\nRaidefend Support'} />
    <div><Button variant="primary" disabled={v === value} onClick={() => run(D.saveMySignature(v), 'Signature saved')}>Save signature</Button></div></Panel>;
}
