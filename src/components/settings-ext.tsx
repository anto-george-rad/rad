'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { CalendarOff, Copy, Mail, Plus, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import type { AgentSkills, CustomRole, EscalationRule, ReportSchedule, RolePermissions } from '@/db/schema';
import { Button, Chip, ConfirmButton, Field, Input, Modal, Panel, Segmented, Select, Textarea, useToast } from './ui';
import { useApp } from './app-context';
import * as A from '@/lib/actions';
import * as X from '@/lib/crm-ext-actions';
import * as DX from '@/lib/desk-ext-actions';
import * as D from '@/lib/desk-actions';
import { PERMISSION_LABELS, REPORT_KINDS } from '@/lib/options';
import { cn, fmtDate, timeAgo } from '@/lib/utils';

type R = { ok: boolean; error?: string };
function useRun() {
  const toast = useToast(); const router = useRouter();
  return async (p: Promise<R>, ok?: string) => { const r = await p; if (!r.ok) { toast(r.error || 'Something went wrong', 'bad'); return false; } if (ok) toast(ok); router.refresh(); return true; };
}
const Intro = ({ children }: { children: ReactNode }) => <p className="mb-4 max-w-[72ch] text-[13.5px] text-muted">{children}</p>;
const Check = ({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) =>
  <label className={cn('flex items-center gap-2 text-[13.5px]', disabled && 'opacity-60')}><input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />{children}</label>;
const Empty = ({ children }: { children: ReactNode }) => <p className="px-5 py-8 text-center text-[13px] text-muted">{children}</p>;
const copy = async (t: string, toast: (m: string, k?: 'bad') => void) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Select the text to copy it'); } };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ---------------- scheduled reports ---------------- */
export function ReportsTab({ schedules, module }: { schedules: ReportSchedule[]; module: 'crm' | 'desk' }) {
  const { users, me } = useApp(); const run = useRun(); const toast = useToast();
  const [edit, setEdit] = useState<{ id?: string; name: string; kind: ReportSchedule['kind']; frequency: ReportSchedule['frequency']; day: number; hour: number; recipientIds: string[]; active: boolean } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const kinds = REPORT_KINDS.filter(([k]) => module === 'desk' ? k === 'helpdesk' : k !== 'helpdesk' || me.deskRole === 'admin');
  const list = schedules.filter((s) => module === 'desk' ? s.kind === 'helpdesk' : s.kind !== 'helpdesk');
  const when = (s: Pick<ReportSchedule, 'frequency' | 'day' | 'hour'>) => `${s.frequency === 'weekly' ? `Every ${DAYS[s.day]}` : `Monthly on day ${s.day}`} at ${String(s.hour).padStart(2, '0')}:00`;
  return <>
    <Intro>Reports emailed automatically to managers: {module === 'desk' ? 'tickets created and resolved, SLA, satisfaction and agent performance' : 'open pipeline by stage, win/loss with reasons, activity by person, or the sales leaderboard'}. Times are Gulf Standard Time.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ name: module === 'desk' ? 'Weekly helpdesk report' : 'Weekly pipeline', kind: (kinds[0]?.[0] || 'pipeline') as 'pipeline', frequency: 'weekly', day: 1, hour: 8, recipientIds: [me.id], active: true })}><Plus size={15} />Scheduled report</Button></div>
    <Panel>{list.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
      <Mail size={17} className="flex-none text-accent" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[13.5px] font-semibold">{s.name}{!s.active && <Chip>Paused</Chip>}<Chip tone="outline">{REPORT_KINDS.find((k) => k[0] === s.kind)?.[1]}</Chip></div>
        <div className="text-xs text-muted">{when(s)} · to {s.recipientIds.map((id) => users.find((u) => u.id === id)?.name).filter(Boolean).join(', ')}{s.lastSentAt ? ` · last sent ${timeAgo(s.lastSentAt)}` : ''}</div></div>
      <Button size="sm" variant="ghost" onClick={async () => { const r = await X.sendReportNow(s.id); if (!r.ok) return toast(r.error, 'bad'); if (r.mail) toast(`Sent to ${r.sent} of ${r.of}`); else setPreview({ subject: r.subject, html: r.html }); }}><Send size={13} />Send now</Button>
      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: s.id, name: s.name, kind: s.kind, frequency: s.frequency, day: s.day, hour: s.hour, recipientIds: s.recipientIds, active: s.active })}>Edit</Button>
      <ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(X.deleteReportSchedule(s.id), 'Deleted')}>Delete</ConfirmButton></div>)}
      {!list.length && <Empty>No scheduled reports yet.</Empty>}</Panel>
    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Edit scheduled report' : 'New scheduled report'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(X.saveReportSchedule(edit), 'Saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Name" required className="col-span-full"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Report"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as 'pipeline' })}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="How often"><Segmented value={edit.frequency} onChange={(v) => setEdit({ ...edit, frequency: v, day: v === 'weekly' ? 1 : 1 })} options={[['weekly', 'Weekly (last 7 days)'], ['monthly', 'Monthly (last 30 days)']]} /></Field>
        <Field label={edit.frequency === 'weekly' ? 'Day' : 'Day of month'}>{edit.frequency === 'weekly' ? <Select value={edit.day} onChange={(e) => setEdit({ ...edit, day: +e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
          : <Input type="number" min={1} max={28} value={edit.day} onChange={(e) => setEdit({ ...edit, day: +e.target.value })} />}</Field>
        <Field label="Time"><Select value={edit.hour} onChange={(e) => setEdit({ ...edit, hour: +e.target.value })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</Select></Field>
        <Field label="Send to" className="col-span-full"><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-line p-3">{users.filter((u) => u.active).map((u) => <Check key={u.id} checked={edit.recipientIds.includes(u.id)} onChange={(on) => setEdit({ ...edit, recipientIds: on ? [...edit.recipientIds, u.id] : edit.recipientIds.filter((x) => x !== u.id) })}>{u.name}</Check>)}</div></Field>
        <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })}>Active</Check>
      </div></Modal>}
    <Modal open={!!preview} onClose={() => setPreview(null)} wide title={preview?.subject || ''} sub="Email isn’t set up on the server, so here’s a preview of what recipients will get."
      footer={<Button variant="primary" onClick={() => setPreview(null)}>Close</Button>}>
      {preview && <iframe title="Report preview" srcDoc={preview.html} sandbox="" className="h-[60vh] w-full rounded-xl border border-line bg-white" />}</Modal>
  </>;
}

/* ---------------- roles & permissions ---------------- */
export function RolesTab({ roles, assignments }: { roles: CustomRole[]; assignments: Record<string, string | null> }) {
  const { users } = useApp(); const run = useRun();
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string; permissions: RolePermissions } | null>(null);
  const allOn = Object.fromEntries(PERMISSION_LABELS.map(([k]) => [k, true])) as RolePermissions;
  return <>
    <Intro>Custom roles take rights away from someone’s normal role, never add to it. For example, a “Sales rep – no export” role, or “Agent – can’t delete” for a contractor. Admins always have full rights. Changes apply on the next page the person opens.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ name: '', description: '', permissions: allOn })}><Plus size={15} />Role</Button></div>
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Roles" count={roles.length}>{roles.map((r) => <div key={r.id} className="flex items-start gap-3 border-b border-line px-5 py-3.5 last:border-0">
        <ShieldCheck size={17} className="mt-0.5 flex-none text-accent" /><div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{r.name}</div>{r.description && <div className="text-xs text-muted">{r.description}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1">{PERMISSION_LABELS.filter(([k]) => !r.permissions[k as keyof RolePermissions]).map(([k, l]) => <Chip key={k} tone="bad">No {l.toLowerCase()}</Chip>)}{PERMISSION_LABELS.every(([k]) => r.permissions[k as keyof RolePermissions]) && <Chip>No restrictions</Chip>}</div></div>
        <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, name: r.name, description: r.description || '', permissions: r.permissions })}>Edit</Button>
        <ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(X.deleteRole(r.id), 'Role deleted')}>Delete</ConfirmButton></div>)}{!roles.length && <Empty>No custom roles yet.</Empty>}</Panel>
      <Panel title="Who has which role">{users.filter((u) => u.active && u.role !== 'admin').map((u) => <div key={u.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
        <span className="flex-1 text-[13.5px]">{u.name} <span className="text-xs capitalize text-muted">{u.role === 'rep' ? 'sales rep' : u.role}</span></span>
        <Select className="h-8 w-52" value={assignments[u.id] || ''} onChange={(e) => run(X.setUserRole(u.id, e.target.value || null), 'Role updated')} aria-label={`Custom role for ${u.name}`}><option value="">Normal rights</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>)}</Panel>
    </div>
    {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit role' : 'New role'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(X.saveRole(edit), 'Role saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3"><Field label="Name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Sales rep – no export" /></Field>
        <Field label="Description"><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
        <Field label="Allowed"><div className="grid gap-2 rounded-xl border border-line p-3">{PERMISSION_LABELS.map(([k, l, hint]) => <Check key={k} checked={edit.permissions[k as keyof RolePermissions]} onChange={(v) => setEdit({ ...edit, permissions: { ...edit.permissions, [k]: v } })}><span>{l}<span className="block text-xs text-muted">{hint}</span></span></Check>)}</div></Field></div></Modal>}
  </>;
}

/* ---------------- web-to-lead form ---------------- */
export function WebFormTab() {
  const { settings, users } = useApp(); const run = useRun(); const toast = useToast();
  const [v, setV] = useState({ leadFormEnabled: settings.leadFormEnabled, leadFormOwnerId: settings.leadFormOwnerId, leadFormSource: settings.leadFormSource, leadFormThanks: settings.leadFormThanks, origins: settings.leadFormOrigins.join('\n') });
  const [origin, setOrigin] = useState(''); useEffect(() => setOrigin(window.location.origin), []);
  const html = `<form action="${origin}/api/forms/lead" method="post">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Work email">
  <input name="phone" placeholder="Mobile">
  <input name="company" placeholder="Company">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <label><input type="checkbox" name="consent"> I agree to be contacted</label>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <input type="hidden" name="t" value="">
  <input type="hidden" name="redirect" value="https://raidefend.com/thank-you">
  <button>Send</button>
</form>
<script>document.querySelector('[name=t]').value = Date.now();</script>`;
  const iframe = `<iframe src="${origin}/forms/lead" style="width:100%;max-width:520px;height:640px;border:0" title="Contact Raidefend"></iframe>`;
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="Website lead form" bodyClass="grid gap-3.5 p-5">
      <Check checked={v.leadFormEnabled} onChange={(x) => setV({ ...v, leadFormEnabled: x })}>Accept leads from the website</Check>
      <Field label="New leads go to" hint="If nobody is chosen, admins are notified and assign them"><Select value={v.leadFormOwnerId} onChange={(e) => setV({ ...v, leadFormOwnerId: e.target.value })}><option value="">Unassigned</option>{users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <Field label="Lead source"><Select value={v.leadFormSource} onChange={(e) => setV({ ...v, leadFormSource: e.target.value })}>{settings.leadSources.map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Thank-you message"><Textarea value={v.leadFormThanks} onChange={(e) => setV({ ...v, leadFormThanks: e.target.value })} /></Field>
      <Field label="Websites allowed to send leads from a script" hint="One per line, e.g. https://raidefend.com (not needed for the plain HTML form or the embed)"><Textarea value={v.origins} onChange={(e) => setV({ ...v, origins: e.target.value })} /></Field>
      <div><Button variant="primary" onClick={() => run(X.saveLeadForm({ leadFormEnabled: v.leadFormEnabled, leadFormOwnerId: v.leadFormOwnerId, leadFormSource: v.leadFormSource, leadFormThanks: v.leadFormThanks, leadFormOrigins: v.origins.split('\n') }), 'Saved')}>Save</Button></div>
    </Panel>
    <Panel title="Put it on raidefend.com" bodyClass="grid gap-4 p-5 text-[13px]">
      <div><div className="mb-1 flex items-center gap-2 font-semibold">Option 1 · Embed the ready-made form<Button size="sm" variant="ghost" onClick={() => copy(iframe, toast)}><Copy size={13} />Copy</Button></div>
        <pre className="overflow-x-auto rounded-xl bg-sunken p-3 text-[11.5px]">{iframe}</pre><a className="text-accent hover:underline" href="/forms/lead" target="_blank" rel="noopener">Open the form</a></div>
      <div><div className="mb-1 flex items-center gap-2 font-semibold">Option 2 · Your own HTML form<Button size="sm" variant="ghost" onClick={() => copy(html, toast)}><Copy size={13} />Copy</Button></div>
        <pre className="max-h-64 overflow-auto rounded-xl bg-sunken p-3 text-[11.5px]">{html}</pre>
        <p className="mt-1 text-muted">Fields: name (or firstName/lastName), email, phone, company, jobTitle, message, product, campaign, consent. The hidden “website” field catches bots.</p></div>
    </Panel>
  </div>;
}

/* ---------------- Outlook email sync ---------------- */
export function EmailSyncTab({ outlook, people }: { outlook: { configured: boolean; tenantId: string; clientId: string; lastRunAt: string | null; lastError: string | null }; people: { id: string; name: string; email: string; mailSync: boolean; mailSyncedAt: Date | null }[] }) {
  const { settings } = useApp(); const run = useRun(); const toast = useToast();
  const [v, setV] = useState({ enabled: settings.outlookEnabled, tenantId: outlook.tenantId, clientId: outlook.clientId, clientSecret: '' });
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="Microsoft 365 connection" bodyClass="grid gap-3.5 p-5 text-[13.5px]">
      <p className="text-muted">Emails your reps send to and receive from CRM contacts are logged on the contact, company and open deal automatically, every 10 minutes. Mail with people who aren’t in the CRM is never stored.</p>
      <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted"><li>In Microsoft Entra admin centre → App registrations, create “RAD Workspace mail sync”.</li><li>API permissions → Microsoft Graph → <b>Application</b> permission <b>Mail.ReadBasic.All</b> (or Mail.Read) → Grant admin consent.</li><li>Certificates &amp; secrets → New client secret. Paste the IDs and secret below.</li></ol>
      <Check checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })}>Sync Outlook email</Check>
      <Field label="Directory (tenant) ID"><Input value={v.tenantId} onChange={(e) => setV({ ...v, tenantId: e.target.value })} className="num" /></Field>
      <Field label="Application (client) ID"><Input value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })} className="num" /></Field>
      <Field label="Client secret" hint={outlook.configured ? 'Saved (encrypted). Leave blank to keep it.' : 'Stored encrypted'}><Input type="password" value={v.clientSecret} onChange={(e) => setV({ ...v, clientSecret: e.target.value })} autoComplete="new-password" /></Field>
      <div className="flex flex-wrap gap-2"><Button variant="primary" onClick={() => run(X.saveOutlook(v), 'Saved')}>Save</Button>
        <Button onClick={async () => { const r = await X.testOutlook(); toast(r.ok ? r.result : r.error, r.ok ? undefined : 'bad'); }}>Test connection</Button>
        <Button onClick={async () => { const r = await X.syncOutlookNow(); toast(r.ok ? r.result : r.error, r.ok ? undefined : 'bad'); }}><RefreshCw size={14} />Sync now</Button></div>
      {(outlook.lastRunAt || outlook.lastError) && <p className={cn('text-[12.5px]', outlook.lastError ? 'text-bad' : 'text-muted')}>{outlook.lastRunAt && `Last run ${timeAgo(outlook.lastRunAt)}. `}{outlook.lastError}</p>}
    </Panel>
    <Panel title="Mailboxes" count={`${people.filter((p) => p.mailSync).length} on`}>{people.map((p) => <div key={p.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
      <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{p.name}</div><div className="text-xs text-muted">{p.email}{p.mailSyncedAt ? ` · synced ${timeAgo(p.mailSyncedAt)}` : ''}</div></div>
      <Check checked={p.mailSync} onChange={(on) => run(X.setMailSync(p.id, on), on ? 'Sync on' : 'Sync off')}>Sync</Check></div>)}</Panel>
  </div>;
}
/** My account: switch my own mailbox sync on or off. */
export function MyMailSync({ on, syncedAt }: { on: boolean; syncedAt: Date | null }) {
  const { settings, me } = useApp(); const run = useRun();
  if (!settings.outlookEnabled) return null;
  return <Panel title={<span className="flex items-center gap-2"><Mail size={16} />Outlook email sync</span>} bodyClass="grid gap-2 p-5 text-[13.5px]">
    <p className="text-muted">Log my emails with CRM contacts on their records automatically. Mail with anyone not in the CRM is never stored, and you can remove any synced email.</p>
    <Check checked={on} onChange={(v) => run(X.setMailSync(me.id, v), v ? 'Sync on' : 'Sync off')}>Sync my mailbox{syncedAt ? ` · last synced ${timeAgo(syncedAt)}` : ''}</Check></Panel>;
}

/* ---------------- licences & handoff (CRM) ---------------- */
export function LicenceHandoffTab() {
  const { settings, desk } = useApp(); const run = useRun();
  const [v, setV] = useState({ licenceRenewalDays: String(settings.licenceRenewalDays), handoffWonToOnboarding: settings.handoffWonToOnboarding, onboardingDepartmentId: settings.onboardingDepartmentId });
  return <div className="grid max-w-3xl gap-4">
    <Panel title="Licence renewals" bodyClass="grid gap-3.5 p-5 text-[13.5px]">
      <p className="text-muted">Won deals add their subscription and licence lines to the customer’s licence register. A renewal deal (one per customer and expiry date) opens in the Renewals pipeline this many days before licences end, with a task for the account owner.</p>
      <Field label="Open renewal deals this many days before expiry" hint="0 turns automatic renewal deals off"><Input type="number" min={0} max={365} className="w-32" value={v.licenceRenewalDays} onChange={(e) => setV({ ...v, licenceRenewalDays: e.target.value })} /></Field>
    </Panel>
    <Panel title="Won deal → onboarding ticket" bodyClass="grid gap-3.5 p-5 text-[13.5px]">
      <Check checked={v.handoffWonToOnboarding} onChange={(x) => setV({ ...v, handoffWonToOnboarding: x })}>When a new-business deal is won, open an onboarding ticket in the helpdesk with the products and a checklist</Check>
      <Field label="Department"><Select value={v.onboardingDepartmentId} onChange={(e) => setV({ ...v, onboardingDepartmentId: e.target.value })}><option value="">The first department</option>{(desk?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
    </Panel>
    <div><Button variant="primary" onClick={() => run(A.saveOrg({ licenceRenewalDays: Math.max(0, Math.min(365, +v.licenceRenewalDays || 0)), handoffWonToOnboarding: v.handoffWonToOnboarding, onboardingDepartmentId: v.onboardingDepartmentId }), 'Saved')}>Save</Button></div>
  </div>;
}

/* ---------------- helpdesk: escalation ladder ---------------- */
const TARGET: Record<EscalationRule['target'], string> = { team_lead: 'Team lead', manager: 'Agent’s manager', desk_admins: 'Helpdesk admins', user: 'A specific person' };
export function EscalationsTab({ rules, departments }: { rules: EscalationRule[]; departments: { id: string; name: string }[] }) {
  const { desk, users } = useApp(); const run = useRun();
  const [edit, setEdit] = useState<{ id?: string; departmentId: string; level: number; afterMinutes: string; target: EscalationRule['target']; userId: string; reassign: boolean; raisePriority: boolean; active: boolean } | null>(null);
  const h = (m: number) => (m === 0 ? 'at breach' : m % 60 ? `${m} min after due` : `${m / 60} h after due`);
  return <>
    <Intro>When a ticket passes its resolution time, it climbs this ladder: each level notifies someone and can hand the ticket over or raise its priority. Set the team lead of each team under Departments &amp; teams. A department’s own ladder replaces the general one.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ departmentId: '', level: (rules.at(-1)?.level || 0) + 1, afterMinutes: String(rules.length ? (rules.at(-1)!.afterMinutes || 0) + 240 : 0), target: rules.length ? 'manager' : 'team_lead', userId: '', reassign: false, raisePriority: false, active: true })}><Plus size={15} />Level</Button></div>
    <Panel>{[...rules].sort((a, b) => (a.departmentId || '').localeCompare(b.departmentId || '') || a.level - b.level).map((r) => <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-0">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent-soft font-display font-bold text-accent">{r.level}</span>
      <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{TARGET[r.target]}{r.target === 'user' && `: ${users.find((u) => u.id === r.userId)?.name || '—'}`}{!r.active && <Chip className="ml-2">Off</Chip>}</div>
        <div className="text-xs text-muted">{h(r.afterMinutes)} · {r.departmentId ? departments.find((d) => d.id === r.departmentId)?.name : 'All departments'}{r.reassign ? ' · reassigns the ticket' : ''}{r.raisePriority ? ' · raises priority' : ''}</div></div>
      <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, departmentId: r.departmentId || '', level: r.level, afterMinutes: String(r.afterMinutes), target: r.target, userId: r.userId || '', reassign: r.reassign, raisePriority: r.raisePriority, active: r.active })}>Edit</Button>
      <ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(DX.deleteEscalationRule(r.id), 'Deleted')}>Delete</ConfirmButton></div>)}
      {!rules.length && <Empty>No escalation ladder. Breaches only notify the assignee, their manager and helpdesk admins once.</Empty>}</Panel>
    {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit escalation level' : 'New escalation level'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(DX.saveEscalationRule({ ...edit, afterMinutes: +edit.afterMinutes || 0, departmentId: edit.departmentId || null, userId: edit.userId || null }), 'Saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Level"><Input type="number" min={1} max={5} value={edit.level} onChange={(e) => setEdit({ ...edit, level: +e.target.value })} /></Field>
        <Field label="Minutes after the due time" hint="0 = the moment it breaches"><Input type="number" min={0} value={edit.afterMinutes} onChange={(e) => setEdit({ ...edit, afterMinutes: e.target.value })} /></Field>
        <Field label="Escalate to"><Select value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value as 'manager' })}>{Object.entries(TARGET).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {edit.target === 'user' ? <Field label="Person"><Select value={edit.userId} onChange={(e) => setEdit({ ...edit, userId: e.target.value })}><option value="">Choose…</option>{(desk?.agents || []).filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field> : <span />}
        <Field label="Department"><Select value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <div className="grid content-end gap-2">{edit.target !== 'desk_admins' && <Check checked={edit.reassign} onChange={(v) => setEdit({ ...edit, reassign: v })}>Hand the ticket to them</Check>}<Check checked={edit.raisePriority} onChange={(v) => setEdit({ ...edit, raisePriority: v })}>Raise priority one step</Check><Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })}>Active</Check></div>
      </div></Modal>}
  </>;
}

/* ---------------- helpdesk: WhatsApp ---------------- */
export function WhatsAppTab({ wa, departments }: { wa: { configured: boolean; phoneNumberId: string; verifyToken: string; lastInboundAt: string | null }; departments: { id: string; name: string }[] }) {
  const { settings } = useApp(); const run = useRun(); const toast = useToast();
  const [v, setV] = useState({ enabled: settings.whatsappEnabled, departmentId: settings.whatsappDepartmentId, phoneNumberId: wa.phoneNumberId, accessToken: '', verifyToken: wa.verifyToken || '', appSecret: '' });
  const [origin, setOrigin] = useState(''); useEffect(() => setOrigin(window.location.origin), []);
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="WhatsApp Business" bodyClass="grid gap-3.5 p-5 text-[13.5px]">
      <p className="text-muted">Customers message your WhatsApp Business number; each conversation becomes a ticket (or joins their open WhatsApp ticket), and agent replies go back on WhatsApp. Photos and documents are attached to the ticket.</p>
      <Check checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })}>Receive WhatsApp messages as tickets</Check>
      <Field label="Department"><Select value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}><option value="">The first department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Phone number ID" hint="Meta for Developers → WhatsApp → API setup"><Input value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value })} className="num" /></Field>
      <Field label="Permanent access token" hint={wa.configured ? 'Saved (encrypted). Leave blank to keep it.' : 'From a system user with whatsapp_business_messaging'}><Input type="password" value={v.accessToken} onChange={(e) => setV({ ...v, accessToken: e.target.value })} autoComplete="new-password" /></Field>
      <Field label="App secret" hint={wa.configured ? 'Saved (encrypted). Leave blank to keep it.' : 'App settings → Basic; used to check messages really come from Meta'}><Input type="password" value={v.appSecret} onChange={(e) => setV({ ...v, appSecret: e.target.value })} autoComplete="new-password" /></Field>
      <Field label="Verify token" hint="Any secret phrase; paste the same one in Meta’s webhook settings"><Input value={v.verifyToken} onChange={(e) => setV({ ...v, verifyToken: e.target.value })} /></Field>
      <div><Button variant="primary" onClick={() => run(DX.saveWhatsApp(v), 'Saved')}>Save</Button></div>
    </Panel>
    <Panel title="Connect the webhook in Meta" bodyClass="grid gap-3 p-5 text-[13px]">
      <ol className="list-decimal space-y-1.5 pl-5"><li>Meta for Developers → your app → WhatsApp → Configuration → Webhook → Edit.</li>
        <li>Callback URL: <span className="num select-all rounded bg-sunken px-1.5 py-0.5">{origin}/api/whatsapp</span> <Button size="sm" variant="ghost" onClick={() => copy(`${origin}/api/whatsapp`, toast)}><Copy size={12} /></Button></li>
        <li>Verify token: the phrase on the left. Then subscribe to the <b>messages</b> field.</li></ol>
      <p className="text-muted">WhatsApp only allows free-form replies within 24 hours of the customer’s last message; after that the agent is told the reply wasn’t sent and should email or call.</p>
      <p className={cn('text-[12.5px]', wa.lastInboundAt ? 'text-good' : 'text-muted')}>{wa.lastInboundAt ? `Last message received ${timeAgo(wa.lastInboundAt)}` : 'No messages received yet.'}</p>
    </Panel>
  </div>;
}

/* ---------------- helpdesk: AI, handoff, community, status, contracts ---------------- */
export function DeskExtrasTab({ aiConfigured }: { aiConfigured: boolean }) {
  const { settings } = useApp(); const run = useRun();
  const [v, setV] = useState({ handoffTicketToLead: settings.handoffTicketToLead, handoffKeywords: settings.handoffKeywords, aiTriage: settings.aiTriage, aiSentiment: settings.aiSentiment, communityEnabled: settings.communityEnabled, forumCategories: settings.forumCategories.join('\n'),
    statusPageEnabled: settings.statusPageEnabled, statusComponents: settings.statusComponents.join('\n'), ticketLanguages: settings.ticketLanguages.join('\n'), contractTiers: settings.contractTiers.join('\n'), supportCostPerHour: String(settings.supportCostPerHour), lowHoursPct: String(settings.lowHoursPct) });
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="AI assistance" bodyClass="grid gap-3 p-5 text-[13.5px]">
      <p className="text-muted">{aiConfigured ? 'Claude is connected.' : 'Claude isn’t connected (ANTHROPIC_API_KEY), so simple keyword rules are used instead and “Suggest reply” and “Summarise” are unavailable.'}</p>
      <Check checked={v.aiTriage} onChange={(x) => setV({ ...v, aiTriage: x })}>Set category, priority and language on new tickets automatically</Check>
      <Check checked={v.aiSentiment} onChange={(x) => setV({ ...v, aiSentiment: x })}>Alert the agent and their manager when a customer sounds frustrated</Check>
      <Field label="Ticket languages" hint="One per line; used for routing to agents who speak them"><Textarea value={v.ticketLanguages} onChange={(e) => setV({ ...v, ticketLanguages: e.target.value })} /></Field>
    </Panel>
    <Panel title="Support → sales handoff" bodyClass="grid gap-3 p-5 text-[13.5px]">
      <Check checked={v.handoffTicketToLead} onChange={(x) => setV({ ...v, handoffTicketToLead: x })}>When a customer asks about these, create a lead for the account owner (once per ticket)</Check>
      <Field label="Words that signal a sales opportunity" hint="Separate with |"><Textarea value={v.handoffKeywords} onChange={(e) => setV({ ...v, handoffKeywords: e.target.value })} className="num text-[12.5px]" /></Field>
    </Panel>
    <Panel title="Support contracts" bodyClass="grid gap-3 p-5 text-[13.5px] sm:grid-cols-2">
      <Field label="Contract tiers" hint="Match SLA policy tiers" className="col-span-full"><Textarea value={v.contractTiers} onChange={(e) => setV({ ...v, contractTiers: e.target.value })} /></Field>
      <Field label="Cost of a support hour (AED)" hint="For contract profitability"><Input type="number" min={0} value={v.supportCostPerHour} onChange={(e) => setV({ ...v, supportCostPerHour: e.target.value })} /></Field>
      <Field label="Warn at % of included hours"><Input type="number" min={10} max={100} value={v.lowHoursPct} onChange={(e) => setV({ ...v, lowHoursPct: e.target.value })} /></Field>
    </Panel>
    <Panel title="Community & status page" bodyClass="grid gap-3 p-5 text-[13.5px] sm:grid-cols-2">
      <Check checked={v.communityEnabled} onChange={(x) => setV({ ...v, communityEnabled: x })}>Customer community in the portal</Check>
      <Check checked={v.statusPageEnabled} onChange={(x) => setV({ ...v, statusPageEnabled: x })}>Public status page (/status)</Check>
      <Field label="Community categories"><Textarea value={v.forumCategories} onChange={(e) => setV({ ...v, forumCategories: e.target.value })} /></Field>
      <Field label="Services on the status page"><Textarea value={v.statusComponents} onChange={(e) => setV({ ...v, statusComponents: e.target.value })} /></Field>
    </Panel>
    <div className="col-span-full"><Button variant="primary" onClick={() => run(D.saveDeskSettings({ handoffTicketToLead: v.handoffTicketToLead, handoffKeywords: v.handoffKeywords.trim(), aiTriage: v.aiTriage, aiSentiment: v.aiSentiment, communityEnabled: v.communityEnabled, forumCategories: lines(v.forumCategories),
      statusPageEnabled: v.statusPageEnabled, statusComponents: lines(v.statusComponents), ticketLanguages: lines(v.ticketLanguages), contractTiers: lines(v.contractTiers), supportCostPerHour: +v.supportCostPerHour || 0, lowHoursPct: Math.max(10, Math.min(100, +v.lowHoursPct || 80)) }), 'Saved')}>Save</Button></div>
  </div>;
}

/* ---------------- agent skills, shift and leave ---------------- */
export type LeaveRow = { id: string; userId: string; startDate: string; endDate: string; note: string | null };
export function RoutingModal({ agent, leave, onClose }: { agent: { id: string; name: string; skills: AgentSkills; shift: { days: number[]; start: string; end: string } | null }; leave: LeaveRow[]; onClose: () => void }) {
  const { products, settings } = useApp(); const run = useRun();
  const [sk, setSk] = useState<AgentSkills>(agent.skills || { products: [], vendors: [], languages: [] }); const [vendors, setVendors] = useState((agent.skills?.vendors || []).join(', '));
  const [shiftOn, setShiftOn] = useState(!!agent.shift); const [shift, setShift] = useState(agent.shift || { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' });
  const [lv, setLv] = useState({ start: '', end: '', note: '' });
  const toggle = (list: string[], v: string, on: boolean) => on ? [...list, v] : list.filter((x) => x !== v);
  return <Modal open wide onClose={onClose} title={`Routing for ${agent.name}`} sub="Automatic assignment prefers agents whose skills match the ticket, and skips anyone off shift or on leave."
    footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={async () => { if (await run(DX.saveAgentRouting(agent.id, { skills: { ...sk, vendors: vendors.split(',') }, shift: shiftOn ? shift : null }), 'Saved')) onClose(); }}>Save</Button></>}>
    <div className="grid gap-4 pb-3 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <Field label="Products" hint="Empty = any product"><div className="flex max-h-44 flex-wrap gap-x-4 gap-y-2 overflow-y-auto rounded-xl border border-line p-3">{products.filter((p) => p.active).map((p) => <Check key={p.id} checked={sk.products.includes(p.id)} onChange={(on) => setSk({ ...sk, products: toggle(sk.products, p.id, on) })}>{p.name}</Check>)}</div></Field>
        <Field label="Vendors" hint="Comma-separated, e.g. Sophos, Fortinet; empty = any"><Input value={vendors} onChange={(e) => setVendors(e.target.value)} /></Field>
        <Field label="Languages" hint="Empty = any"><div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border border-line p-3">{settings.ticketLanguages.map((l) => <Check key={l} checked={sk.languages.includes(l)} onChange={(on) => setSk({ ...sk, languages: toggle(sk.languages, l, on) })}>{l}</Check>)}</div></Field>
      </div>
      <div className="grid content-start gap-3">
        <Check checked={shiftOn} onChange={setShiftOn}>Works a fixed shift (otherwise always available)</Check>
        {shiftOn && <><div className="flex flex-wrap gap-1.5">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <button key={d} onClick={() => setShift({ ...shift, days: shift.days.includes(i) ? shift.days.filter((x) => x !== i) : [...shift.days, i] })} className={cn('rounded-lg border px-2.5 py-1 text-[12.5px] font-medium', shift.days.includes(i) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted')}>{d}</button>)}</div>
          <div className="flex items-end gap-3"><Field label="From"><Input type="time" value={shift.start} onChange={(e) => setShift({ ...shift, start: e.target.value })} /></Field><Field label="To"><Input type="time" value={shift.end} onChange={(e) => setShift({ ...shift, end: e.target.value })} /></Field></div></>}
        <div className="mt-2"><div className="eyebrow mb-1.5 flex items-center gap-1.5"><CalendarOff size={13} />Leave</div>
          {leave.map((l) => <div key={l.id} className="flex items-center gap-2 border-b border-line py-1.5 text-[13px] last:border-0"><span className="flex-1">{fmtDate(l.startDate)} – {fmtDate(l.endDate)}{l.note ? ` · ${l.note}` : ''}</span><ConfirmButton size="sm" variant="ghost" confirmText="Remove?" onConfirm={() => run(DX.deleteLeave(l.id), 'Removed')}><Trash2 size={13} /></ConfirmButton></div>)}
          <div className="mt-2 flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={lv.start} onChange={(e) => setLv({ ...lv, start: e.target.value, end: lv.end || e.target.value })} /></Field><Field label="To"><Input type="date" value={lv.end} onChange={(e) => setLv({ ...lv, end: e.target.value })} /></Field>
            <Input value={lv.note} onChange={(e) => setLv({ ...lv, note: e.target.value })} placeholder="Note" className="h-10 w-32" aria-label="Leave note" /><Button disabled={!lv.start} onClick={async () => { if (await run(DX.addLeave(agent.id, lv.start, lv.end || lv.start, lv.note), 'Leave added')) setLv({ start: '', end: '', note: '' }); }}>Add</Button></div></div>
      </div>
    </div></Modal>;
}
