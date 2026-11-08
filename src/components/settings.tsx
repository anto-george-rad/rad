'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, Image as ImageIcon, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react';
import type { AgentSkills, AuditEntry, Automation, AutomationActions, AutomationTrigger, CustomFieldType, CustomRole, DeskRole, EscalationRule, Product, ReportSchedule, ScoringRule, StageRule, TicketScope } from '@/db/schema';
import { DeskExtrasTab, EmailSyncTab, EscalationsTab, LicenceHandoffTab, MyMailSync, ReportsTab, RolesTab, RoutingModal, WebFormTab, WhatsAppTab, type LeaveRow } from './settings-ext';
import { CalendarPanel, CannedTab, DepartmentsTab, HelpdeskTab, SecurityPanels, SignaturePanel, SlaTab, StatusesTab, TrashTab, type DeptRow, type DeskSetup, type SessionRow, type TrashRow } from './settings-desk';
import { PRIORITIES, TICKET_CHANNELS, CHANNEL_LABEL } from '@/lib/options';
import { Button, Chip, ConfirmButton, Field, IconButton, Input, Modal, Panel, Segmented, Select, Textarea, useToast } from './ui';
import { useApp } from './app-context';
import { useForms, ACT_TYPES } from './forms';
import { ImportModal } from './import-modal';
import * as A from '@/lib/actions';
import { cn, fmtMoney, fullName, passwordProblem, timeAgo } from '@/lib/utils';
import { brandTokens } from '@/lib/brand';
import { THEME_PRESETS } from '@/lib/settings-defaults';
import { SCORE_FIELD_LABELS } from '@/lib/scoring';

type Run = { id: string; automationId: string; recordType: string; recordId: string; summary: string | null; at: Date };
type Access = { monthlyTarget: number | null; crmAccess: boolean; deskRole: DeskRole; ticketScope: TicketScope; totpEnabled: boolean; deptIds: string[] };
type Mod = 'crm' | 'desk';
type Props = { module: Mod; tab: string; runs: Run[]; audit: AuditEntry[]; mailOn: boolean; access: Record<string, Access>; rules: StageRule[]; automations: Automation[]; scoring: ScoringRule[]; products: Product[];
  contacts: { id: string; firstName: string; lastName: string | null; email: string | null; createdAt: Date }[]; companies: { id: string; name: string; createdAt: Date }[]; samples: number;
  sessions: SessionRow[]; account: { totpEnabled: boolean; hasCalendar: boolean; signature: string }; desk: DeskSetup; trash: TrashRow[]; ext: Ext };
type Ext = { schedules: ReportSchedule[]; roles: CustomRole[]; roleOf: Record<string, string | null>; escalations: EscalationRule[]; leaves: LeaveRow[]; routing: Record<string, { skills: AgentSkills; shift: { days: number[]; start: string; end: string } | null }>;
  outlook: { configured: boolean; tenantId: string; clientId: string; lastRunAt: string | null; lastError: string | null }; mailPeople: { id: string; name: string; email: string; mailSync: boolean; mailSyncedAt: Date | null }[];
  whatsapp: { configured: boolean; phoneNumberId: string; verifyToken: string; lastInboundAt: string | null }; aiConfigured: boolean; myMail: { on: boolean; at: Date | null } };
type Me = { role: string; crmAccess: boolean; deskRole: DeskRole };
/** CRM settings and Helpdesk settings are separate: each lists only its own module's tabs, and who sees each one. */
const CRM_TABS: [string, string, (m: Me) => boolean][] = [
  ['company', 'Company & rules', (m) => m.role === 'admin'], ['branding', 'Branding', (m) => m.role === 'admin'], ['users', 'Users & access', (m) => m.role === 'admin'],
  ['pipelines', 'Pipelines & stages', (m) => m.role === 'admin'], ['fields', 'Custom fields', (m) => m.role === 'admin'], ['automations', 'Automations', (m) => m.role === 'admin'], ['scoring', 'Lead scoring', (m) => m.role === 'admin'],
  ['templates', 'Email templates', (m) => m.role !== 'rep'], ['products', 'Products', (m) => m.role !== 'rep'],
  ['licences', 'Licences & handoff', (m) => m.role === 'admin'], ['reports', 'Scheduled reports', (m) => m.role !== 'rep'], ['webform', 'Website lead form', (m) => m.role === 'admin'], ['emailsync', 'Email sync', (m) => m.role === 'admin'],
  ['roles', 'Roles & permissions', (m) => m.role === 'admin'], ['data', 'Import & data', (m) => m.role !== 'rep'], ['trash', 'Recycle bin', () => true], ['audit', 'Audit log', (m) => m.role === 'admin'], ['account', 'My account', () => true]];
const DESK_TABS: [string, string, (m: Me) => boolean][] = [
  ['departments', 'Departments & teams', (m) => m.deskRole === 'admin'], ['agents', 'Agents & access', (m) => m.deskRole === 'admin'], ['statuses', 'Ticket statuses', (m) => m.deskRole === 'admin'],
  ['sla', 'SLAs & hours', (m) => m.deskRole === 'admin'], ['fields', 'Ticket fields', (m) => m.deskRole === 'admin'], ['automations', 'Ticket automations', (m) => m.deskRole === 'admin'],
  ['escalations', 'Escalations', (m) => m.deskRole === 'admin'], ['canned', 'Canned responses', (m) => m.deskRole === 'admin' || m.deskRole === 'agent'], ['helpdesk', 'Helpdesk & portal', (m) => m.deskRole === 'admin'],
  ['whatsapp', 'WhatsApp', (m) => m.deskRole === 'admin'], ['extras', 'AI, handoff & community', (m) => m.deskRole === 'admin'], ['reports', 'Scheduled reports', (m) => m.deskRole === 'admin'],
  ['trash', 'Deleted tickets', (m) => m.deskRole === 'admin'], ['audit', 'Audit log', (m) => m.deskRole === 'admin'], ['account', 'My account', () => true]];
const baseOf = (m: Mod) => (m === 'desk' ? '/desk/settings' : '/settings');

function useRun() {
  const toast = useToast(); const router = useRouter();
  return async (p: Promise<A.Result<object>>, ok?: string) => { const r = await p; if (!r.ok) { toast(r.error, 'bad'); return false; } if (ok) toast(ok); router.refresh(); return true; };
}

export default function SettingsView(p: Props) {
  const router = useRouter(); const { me, desk: deskLookups } = useApp();
  const desk = p.module === 'desk';
  const tabs = (desk ? DESK_TABS : CRM_TABS).filter(([, , w]) => w(me));
  const tab = tabs.some(([k]) => k === p.tab) ? p.tab : tabs[0][0];
  return <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
    <div><p className="eyebrow mb-1">{desk ? 'Helpdesk' : 'CRM'}</p><h1 className="mb-4 font-display text-[28px] font-bold tracking-tight">Settings</h1>
      <nav className="flex gap-1 overflow-x-auto lg:flex-col">{tabs.map(([k, l]) => <button key={k} onClick={() => router.replace(`${baseOf(p.module)}?tab=${k}`)} className={cn('whitespace-nowrap rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition', tab === k ? 'bg-surface font-semibold text-ink shadow-card' : 'text-muted hover:bg-sunken hover:text-ink')}>{l}</button>)}</nav></div>
    <div className="min-w-0 pt-1 lg:pt-14">
      {tab === 'company' && <CompanyTab mailOn={p.mailOn} />}{tab === 'branding' && <BrandingTab />}{tab === 'pipelines' && <PipelinesTab rules={p.rules} />}{tab === 'fields' && <FieldsTab module={p.module} />}
      {tab === 'automations' && <AutomationsTab module={p.module} items={p.automations} runs={p.runs} />}{tab === 'scoring' && <ScoringTab rules={p.scoring} />}
      {tab === 'templates' && <TemplatesTab />}{tab === 'products' && <ProductsTab items={p.products} />}{tab === 'users' && <UsersTab module="crm" access={p.access} departments={p.desk.departments} />}{tab === 'agents' && <UsersTab module="desk" access={p.access} departments={p.desk.departments} routing={p.ext.routing} leaves={p.ext.leaves} />}
      {tab === 'departments' && <DepartmentsTab desk={p.desk} />}{tab === 'statuses' && <StatusesTab statuses={p.desk.statuses} />}{tab === 'sla' && <SlaTab slas={p.desk.slas} departments={p.desk.departments} />}
      {tab === 'helpdesk' && <HelpdeskTab />}{tab === 'canned' && <CannedTab canned={p.desk.canned} departments={deskLookups?.departments || []} canShare={me.deskRole === 'admin'} />}
      {tab === 'data' && <DataTab contacts={p.contacts} companies={p.companies} samples={p.samples} isAdmin={me.role === 'admin'} />}{tab === 'trash' && <TrashTab items={p.trash} canPurge={me.role === 'admin'} desk={desk} />}
      {tab === 'licences' && <LicenceHandoffTab />}{tab === 'reports' && <ReportsTab schedules={p.ext.schedules} module={p.module} />}{tab === 'webform' && <WebFormTab />}
      {tab === 'emailsync' && <EmailSyncTab outlook={p.ext.outlook} people={p.ext.mailPeople} />}{tab === 'roles' && <RolesTab roles={p.ext.roles} assignments={p.ext.roleOf} />}
      {tab === 'escalations' && <EscalationsTab rules={p.ext.escalations} departments={p.desk.departments} />}{tab === 'whatsapp' && <WhatsAppTab wa={p.ext.whatsapp} departments={p.desk.departments} />}{tab === 'extras' && <DeskExtrasTab aiConfigured={p.ext.aiConfigured} />}
      {tab === 'audit' && <AuditTab rows={p.audit} module={p.module} />}{tab === 'account' && <AccountTab module={p.module} sessions={p.sessions} account={p.account} myMail={p.ext.myMail} />}
    </div>
  </div>;
}
const Intro = ({ children }: { children: ReactNode }) => <p className="mb-4 max-w-[70ch] text-[13.5px] text-muted">{children}</p>;

/* ---------- company & rules ---------- */
function CompanyTab({ mailOn }: { mailOn: boolean }) {
  const { settings, pipelines } = useApp(); const run = useRun();
  const [v, setV] = useState({ ...settings, leadSourcesText: settings.leadSources.join('\n'), lossText: settings.lossReasons.join('\n'), winText: settings.winReasons.join('\n') });
  const [cur, setCur] = useState(''); const [rate, setRate] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = () => run(A.saveOrg({ orgName: v.orgName, address: v.address, vatTrn: v.vatTrn.replace(/\s/g, ''), email: v.email, phone: v.phone, monthlyTarget: +v.monthlyTarget || 0, hotScore: +v.hotScore, warmScore: +v.warmScore, currencies: v.currencies,
    leadSources: lines(v.leadSourcesText), lossReasons: lines(v.lossText), winReasons: lines(v.winText), renewalPipelineId: v.renewalPipelineId, renewalDays: Math.max(0, +v.renewalDays || 0),
    overdueAlertDays: Math.max(0, +v.overdueAlertDays || 0), licenceReminderDays: Math.max(0, +v.licenceReminderDays || 0) }), 'Settings saved');
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="Company details" bodyClass="grid gap-3.5 p-5 sm:grid-cols-2">
      <Field label="Company name" className="col-span-full"><Input value={v.orgName} onChange={set('orgName')} /></Field>
      <Field label="Address" className="col-span-full"><Input value={v.address} onChange={set('address')} /></Field>
      <Field label="VAT TRN" hint="15-digit tax registration number"><Input value={v.vatTrn} onChange={set('vatTrn')} inputMode="numeric" /></Field>
      <Field label="Phone"><Input value={v.phone} onChange={set('phone')} /></Field>
      <Field label="Email" className="col-span-full"><Input type="email" value={v.email} onChange={set('email')} /></Field>
      <Field label="Company monthly won target (AED)" hint="Per-person targets are under Users" className="col-span-full"><Input type="number" value={String(v.monthlyTarget || '')} onChange={set('monthlyTarget')} /></Field>
      <Field label="Lead sources" hint="One per line"><Textarea value={v.leadSourcesText} onChange={set('leadSourcesText')} className="min-h-[150px]" /></Field>
      <Field label="Win reasons" hint="One per line"><Textarea value={v.winText} onChange={set('winText')} className="min-h-[150px]" /></Field>
      <Field label="Loss reasons" hint="One per line" className="col-span-full sm:col-span-1"><Textarea value={v.lossText} onChange={set('lossText')} className="min-h-[150px]" /></Field>
      <div className="col-span-full"><Button variant="primary" onClick={save}>Save settings</Button></div>
    </Panel>
    <div className="flex min-w-0 flex-col gap-4">
    <Panel title="Reminders & renewals" bodyClass="grid gap-3.5 p-5 sm:grid-cols-2">
      <Field label="Renewals go to"><Select value={v.renewalPipelineId} onChange={set('renewalPipelineId')}><option value="">Pipeline named “Renewals”</option>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Open a renewal this many days before contract end" hint="0 turns automatic renewals off"><Input type="number" min={0} value={String(v.renewalDays)} onChange={set('renewalDays')} /></Field>
      <Field label="Alert the manager when a task is overdue by (days)" hint="0 turns it off"><Input type="number" min={0} value={String(v.overdueAlertDays)} onChange={set('overdueAlertDays')} /></Field>
      <Field label="Remind before a trade licence expires (days)" hint="0 turns it off"><Input type="number" min={0} value={String(v.licenceReminderDays)} onChange={set('licenceReminderDays')} /></Field>
      <p className="col-span-full text-xs text-muted">These checks run every hour on the server. Times use the company time zone (Asia/Dubai unless APP_TIMEZONE is set). Click “Save settings” to keep changes.</p>
      <div className="col-span-full rounded-xl bg-raised px-4 py-3 text-[13px]"><b>Email (SMTP):</b> {mailOn ? <span className="text-good">set up — password reset emails are sent.</span> : <span className="text-muted">not set up. Add SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM to the server environment. Until then, admins create reset links under Users.</span>}</div>
    </Panel>
    <Panel title="Currencies" actions={<span className="text-xs text-muted">Value of 1 unit in AED</span>} bodyClass="p-5">
      <div className="flex flex-col divide-y divide-line">{Object.entries(v.currencies).map(([k, r]) => <div key={k} className="flex items-center gap-3 py-2">
        <b className="num w-14">{k}</b><Input type="number" step="any" disabled={k === 'AED'} value={String(r)} onChange={(e) => setV((o) => ({ ...o, currencies: { ...o.currencies, [k]: +e.target.value } }))} className="w-36" aria-label={`${k} rate`} /><span className="flex-1" />
        {k === 'AED' ? <Chip>Base</Chip> : <IconButton label={`Remove ${k}`} onClick={() => setV((o) => { const c = { ...o.currencies }; delete c[k]; return { ...o, currencies: c }; })}><Trash2 size={15} /></IconButton>}</div>)}</div>
      <div className="mt-3 flex gap-2"><Input placeholder="Code e.g. KWD" maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} className="w-36" /><Input type="number" step="any" placeholder="Rate" value={rate} onChange={(e) => setRate(e.target.value)} className="w-32" />
        <Button onClick={() => { if (/^[A-Z]{3}$/.test(cur) && +rate > 0) { setV((o) => ({ ...o, currencies: { ...o.currencies, [cur]: +rate } })); setCur(''); setRate(''); } }}>Add</Button></div>
      <p className="mt-3 text-xs text-muted">The AED is pegged to the USD at 3.6725. Check other rates before relying on converted totals. Click “Save settings” to keep currency changes.</p>
      <div className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"><Field label="Hot lead score from"><Input type="number" value={String(v.hotScore)} onChange={set('hotScore')} /></Field><Field label="Warm lead score from"><Input type="number" value={String(v.warmScore)} onChange={set('warmScore')} /></Field></div>
    </Panel>
    </div>
  </div>;
}

/* ---------- branding ---------- */
function BrandingTab() {
  const { settings } = useApp(); const run = useRun(); const toast = useToast();
  const [color, setColor] = useState(settings.brandColor); const [head, setHead] = useState(settings.loginHeadline); const [sub, setSub] = useState(settings.loginSubtext); const [bg, setBg] = useState(settings.loginBackground);
  const tok = brandTokens(color);
  const upload = (key: 'logoLight' | 'logoDark') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    if (f.size > 300_000) return toast('Keep the logo under 300 KB', 'bad');
    const r = new FileReader(); r.onload = () => run(A.saveOrg({ [key]: String(r.result) }), 'Logo updated'); r.readAsDataURL(f);
  };
  const Logo = ({ k, label, dark }: { k: 'logoLight' | 'logoDark'; label: string; dark?: boolean }) => <div className="flex flex-col gap-2">
    <span className="text-[12.5px] font-semibold">{label}</span>
    <div className={cn('grid h-24 place-items-center rounded-xl border border-line p-3', dark ? 'bg-[#0B0F1E]' : 'bg-white')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {settings[k] ? <img src={settings[k]} alt={label} className="max-h-full max-w-full object-contain" /> : <span className={cn('inline-flex items-center gap-1.5 text-xs', dark ? 'text-[#8C94B8]' : 'text-faint')}><ImageIcon size={14} />No logo</span>}</div>
    <div className="flex gap-2"><label className="inline-flex h-8 cursor-pointer items-center rounded-lg bg-accent-soft px-2.5 text-xs font-semibold text-accent hover:brightness-95">Upload<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={upload(k)} /></label>
      {settings[k] && <Button size="sm" variant="ghost" onClick={() => run(A.saveOrg({ [k]: '' }), 'Logo removed')}>Remove</Button>}</div>
  </div>;
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="Logo" bodyClass="grid gap-4 p-5 sm:grid-cols-2">
      <Logo k="logoLight" label="For light backgrounds" /><Logo k="logoDark" label="For dark backgrounds (sidebar)" dark />
      <p className="col-span-full text-xs text-muted">PNG, SVG, JPG or WebP up to 300 KB. A wide logo about 400×100 px works best. Used in the sidebar, on the sign-in page and as the browser tab icon. If you upload only one, it’s used everywhere.</p>
    </Panel>
    <Panel title="Colour" bodyClass="p-5">
      <div className="flex flex-wrap gap-2">{THEME_PRESETS.map((t) => <button key={t.hex} type="button" onClick={() => setColor(t.hex)} aria-pressed={color.toUpperCase() === t.hex.toUpperCase()} className={cn('flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold', color.toUpperCase() === t.hex.toUpperCase() ? 'border-ink' : 'border-line hover:border-faint')}><span className="h-6 w-6 rounded-full" style={{ background: t.hex }} />{t.name}</button>)}</div>
      <div className="mt-4 flex flex-wrap items-end gap-3"><Field label="Custom colour"><div className="flex gap-2"><input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#4C5BFF'} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1" aria-label="Pick colour" /><Input value={color} onChange={(e) => setColor(e.target.value)} className="w-32 num" /></div></Field>
        <Button variant="primary" disabled={!tok} onClick={() => run(A.saveOrg({ brandColor: color }), 'Colour saved')}>Save colour</Button></div>
      {tok && <div className="mt-4 grid gap-3 sm:grid-cols-2">{([['Light', tok.light, '#FFFFFF', '#0D1226'], ['Dark', tok.dark, '#111524', '#ECEFF8']] as const).map(([n, t, bgc, ink]) => <div key={n} className="rounded-xl border border-line p-4" style={{ background: bgc, color: ink }}>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider opacity-60">{n} theme preview</div>
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ background: `rgb(${t.accent})`, color: `rgb(${t.ink})` }}>Primary button</span><span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: `rgb(${t.soft})`, color: `rgb(${t.accent})` }}>Chip</span><span className="text-[13px] font-semibold" style={{ color: `rgb(${t.accent})` }}>Link</span></div></div>)}</div>}
      <p className="mt-3 text-xs text-muted">Colours are adjusted automatically so text stays readable in both light and dark themes.</p>
    </Panel>
    <Panel title="Sign-in page" bodyClass="grid gap-3.5 p-5">
      <Field label="Headline"><Input value={head} onChange={(e) => setHead(e.target.value)} maxLength={80} /></Field>
      <Field label="Subtext"><Input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={140} /></Field>
      <Field label="Background"><Segmented value={bg} onChange={setBg} options={[['mesh', 'Glow'], ['grid', 'Grid'], ['plain', 'Plain']]} /></Field>
      <div className="flex gap-2"><Button variant="primary" onClick={() => run(A.saveOrg({ loginHeadline: head.trim() || 'Every deal, one clear view.', loginSubtext: sub.trim(), loginBackground: bg }), 'Sign-in page saved')}>Save</Button><a href="/login" target="_blank" rel="noopener"><Button>Preview</Button></a></div>
      <p className="text-xs text-muted">Preview opens the sign-in page; you’ll see it after signing out, or in a private window.</p>
    </Panel>
  </div>;
}

/* ---------- pipelines ---------- */
const REQ: [string, string][] = [['amount', 'Amount'], ['closingDate', 'Closing date'], ['contact', 'Contact'], ['company', 'Company'], ['products', 'Products'], ['note', 'A note'], ['nextActivity', 'A next activity']];
function PipelinesTab({ rules }: { rules: StageRule[] }) {
  const { pipelines, customFields } = useApp(); const run = useRun();
  const [modal, setModal] = useState<null | { kind: 'pipe' | 'sub' | 'rule'; id?: string; pipelineId?: string; name?: string; rec?: string }>(null);
  const [form, setForm] = useState<Record<string, string>>({}); const [req, setReq] = useState<string[]>([]);
  const stName = (pid: string, id: string | null) => !id ? 'Any stage' : pipelines.find((p) => p.id === pid)?.subs.flatMap((s) => s.stages).find((s) => s.id === id)?.name || '?';
  const reqLabel = (k: string) => k.startsWith('cf:') ? customFields.find((f) => f.id === k.slice(3))?.label || 'Custom field' : REQ.find((r) => r[0] === k)?.[1] || k;
  return <>
    <Intro>Each pipeline is its own process, such as sales, delivery or renewals, with its own record name, sub-pipelines and stages. Stage rules make people fill in details before a deal moves forward.</Intro>
    <div className="flex flex-col gap-4">{pipelines.map((p) => <Panel key={p.id} title={p.name} actions={<><span className="text-xs text-muted">records are called “{p.recordName}”</span>
      <Button size="sm" variant="ghost" onClick={() => { setForm({ name: p.name, rec: p.recordName }); setModal({ kind: 'pipe', id: p.id }); }}>Rename</Button>
      <Button size="sm" variant="ghost" onClick={() => { setForm({ name: '' }); setModal({ kind: 'sub', pipelineId: p.id }); }}>+ Sub-pipeline</Button>
      <ConfirmButton size="sm" confirmText="Delete pipeline?" onConfirm={() => run(A.deletePipeline(p.id), 'Pipeline deleted')}>Delete</ConfirmButton></>} bodyClass="flex flex-col gap-5 p-5">
      {p.subs.map((s) => <div key={s.id}>
        <div className="mb-2 flex items-center gap-2"><span className="eyebrow">{s.name}</span><span className="flex-1" /><Button size="sm" variant="ghost" onClick={() => { setForm({ name: s.name }); setModal({ kind: 'sub', id: s.id, pipelineId: p.id }); }}>Rename</Button><Button size="sm" variant="soft" onClick={() => run(A.saveStage({ subPipelineId: s.id }), 'Stage added')}><Plus size={14} />Stage</Button></div>
        <div className="overflow-x-auto"><table className="tbl min-w-[620px]"><thead><tr><th>Stage</th><th>Type</th><th>Win %</th><th>Idle after (days)</th><th /></tr></thead>
          <tbody>{s.stages.map((st, i) => <tr key={st.id}>
            <td><Input defaultValue={st.name} onBlur={(e) => e.target.value.trim() && e.target.value !== st.name && run(A.saveStage({ id: st.id, subPipelineId: s.id, name: e.target.value.trim() }))} aria-label="Stage name" /></td>
            <td><Select defaultValue={st.type} onChange={(e) => run(A.saveStage({ id: st.id, subPipelineId: s.id, type: e.target.value as 'open' }))} aria-label="Stage type"><option value="open">Open</option><option value="won">Closed won</option><option value="lost">Closed lost</option></Select></td>
            <td><Input type="number" min={0} max={100} defaultValue={st.probability ?? ''} className="w-24" onBlur={(e) => run(A.saveStage({ id: st.id, subPipelineId: s.id, probability: e.target.value === '' ? null : +e.target.value }))} aria-label="Win probability" /></td>
            <td><Input type="number" min={0} defaultValue={st.idleDays ?? ''} className="w-24" onBlur={(e) => run(A.saveStage({ id: st.id, subPipelineId: s.id, idleDays: e.target.value === '' ? null : +e.target.value }))} aria-label="Idle days" /></td>
            <td className="whitespace-nowrap text-right"><IconButton label="Move up" disabled={!i} onClick={() => { const ids = s.stages.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; run(A.reorderStages(ids)); }}><ArrowUp size={15} /></IconButton>
              <IconButton label="Move down" disabled={i === s.stages.length - 1} onClick={() => { const ids = s.stages.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; run(A.reorderStages(ids)); }}><ArrowDown size={15} /></IconButton>
              <IconButton label="Delete stage" onClick={() => run(A.deleteStage(st.id), 'Stage deleted')}><Trash2 size={15} /></IconButton></td></tr>)}</tbody></table></div>
      </div>)}
      <div><div className="mb-2 flex items-center gap-2"><span className="eyebrow">Stage rules</span><span className="flex-1" /><Button size="sm" variant="soft" onClick={() => { setForm({ from: '', to: '' }); setReq([]); setModal({ kind: 'rule', pipelineId: p.id }); }}><Plus size={14} />Rule</Button></div>
        {rules.filter((r) => r.pipelineId === p.id).map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 border-b border-dashed border-line py-2.5 text-[13.5px] last:border-0">
          <span>{stName(p.id, r.fromStageId)} → <b>{stName(p.id, r.toStageId)}</b></span><span className="text-muted">requires</span>{r.requiredItems.map((k) => <Chip key={k} tone="accent">{reqLabel(k)}</Chip>)}<span className="flex-1" /><Button size="sm" variant="ghost" onClick={() => run(A.deleteStageRule(r.id), 'Rule removed')}>Remove</Button></div>)}
        {!rules.some((r) => r.pipelineId === p.id) && <p className="text-[13px] text-muted">No rules. Deals can move freely between stages.</p>}</div>
    </Panel>)}
      <div><Button onClick={() => { setForm({ name: '', rec: 'Deal' }); setModal({ kind: 'pipe' }); }}><Plus size={15} />New pipeline</Button></div></div>
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.kind === 'rule' ? 'New stage rule' : modal?.kind === 'sub' ? (modal.id ? 'Rename sub-pipeline' : 'New sub-pipeline') : modal?.id ? 'Rename pipeline' : 'New pipeline'}
      sub={modal?.kind === 'rule' ? 'Before a deal enters the target stage, these items must be in place.' : modal?.kind === 'sub' && !modal.id ? 'Starts with a copy of the first sub-pipeline’s stages.' : undefined}
      footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" onClick={async () => {
        const ok = modal!.kind === 'pipe' ? await run(A.savePipeline({ id: modal!.id, name: form.name || '', recordName: form.rec || 'Deal' }), 'Saved')
          : modal!.kind === 'sub' ? await run(A.saveSubPipeline({ id: modal!.id, pipelineId: modal!.pipelineId!, name: form.name || '' }), 'Saved')
            : await run(A.saveStageRule({ pipelineId: modal!.pipelineId!, fromStageId: form.from || null, toStageId: form.to || '', requiredItems: req }), 'Rule added');
        if (ok) setModal(null);
      }}>Save</Button></>}>
      {modal?.kind === 'rule' ? (() => { const p = pipelines.find((x) => x.id === modal.pipelineId)!; const opts = p.subs.flatMap((s) => s.stages.map((x) => [x.id, (p.subs.length > 1 ? s.name + ' · ' : '') + x.name]));
        return <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
          <Field label="From"><Select value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}><option value="">Any stage</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="To" required><Select value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}><option value="">Choose…</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <fieldset className="col-span-full grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2"><legend className="eyebrow px-1">Required</legend>
            {[...REQ, ...customFields.filter((f) => f.module === 'deal' && (!f.pipelineId || f.pipelineId === p.id)).map((f) => ['cf:' + f.id, f.label] as [string, string])].map(([k, l]) => <label key={k} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={req.includes(k)} onChange={(e) => setReq((r) => e.target.checked ? [...r, k] : r.filter((x) => x !== k))} className="h-4 w-4 accent-[rgb(var(--accent))]" />{l}</label>)}</fieldset>
        </div>; })()
        : <div className="grid gap-3.5 pb-3"><Field label="Name" required><Input autoFocus value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          {modal?.kind === 'pipe' && <Field label="Records are called" hint="e.g. Deal, Project, Renewal, Ticket"><Input value={form.rec || ''} onChange={(e) => setForm((f) => ({ ...f, rec: e.target.value }))} /></Field>}</div>}
    </Modal>
  </>;
}

/* ---------- custom fields ---------- */
const TYPES: [CustomFieldType, string][] = [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Pick list'], ['checkbox', 'Checkbox'], ['url', 'URL'], ['email', 'Email']];
function FieldsTab({ module }: { module: Mod }) {
  const { customFields, pipelines } = useApp(); const run = useRun();
  const [mod, setMod] = useState<'deal' | 'lead' | 'contact' | 'company' | 'ticket'>(module === 'desk' ? 'ticket' : 'deal'); const [edit, setEdit] = useState<null | Record<string, string | boolean>>(null);
  const list = customFields.filter((f) => f.module === mod);
  return <>
    <Intro>{module === 'desk' ? 'Extra fields agents fill in on every ticket, shown under the ticket’s properties.' : 'Add the fields your team needs. Deal fields can apply to every pipeline or to one, and can be required by stage rules.'}</Intro>
    <div className="mb-3 flex flex-wrap items-center gap-2">{module === 'crm' && <Segmented value={mod} onChange={setMod} options={[['deal', 'Deals'], ['lead', 'Leads'], ['contact', 'Contacts'], ['company', 'Companies']]} />}<span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ label: '', type: 'text', options: '', required: false, pipelineId: '' })}><Plus size={15} />Field</Button></div>
    <Panel>{list.length ? list.map((f) => <div key={f.id} className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 last:border-0"><b className="text-[13.5px]">{f.label}</b><Chip>{TYPES.find((t) => t[0] === f.type)?.[1]}</Chip>{f.required && <Chip tone="warn">Required</Chip>}{f.pipelineId && <Chip tone="accent">{pipelines.find((p) => p.id === f.pipelineId)?.name} only</Chip>}{f.options.length > 0 && <span className="text-xs text-muted">{f.options.join(', ')}</span>}
      <span className="flex-1" /><Button size="sm" variant="ghost" onClick={() => setEdit({ id: f.id, label: f.label, type: f.type, options: f.options.join(', '), required: f.required, pipelineId: f.pipelineId || '' })}>Edit</Button><ConfirmButton size="sm" confirmText="Remove?" onConfirm={() => run(A.deleteCustomField(f.id), 'Field removed')}>Remove</ConfirmButton></div>)
      : <p className="px-5 py-8 text-center text-[13px] text-muted">No custom fields yet.</p>}</Panel>
    {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit field' : 'New field'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(A.saveCustomField({ id: edit.id as string | undefined, module: mod, label: String(edit.label), type: edit.type as CustomFieldType, options: String(edit.options).split(',').map((s) => s.trim()).filter(Boolean), required: !!edit.required, pipelineId: (edit.pipelineId as string) || null }), 'Field saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Label" required className="col-span-full"><Input autoFocus value={String(edit.label)} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
        <Field label="Type"><Select value={String(edit.type)} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {mod === 'deal' ? <Field label="Applies to"><Select value={String(edit.pipelineId)} onChange={(e) => setEdit({ ...edit, pipelineId: e.target.value })}><option value="">All pipelines</option>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name} only</option>)}</Select></Field> : <span />}
        {edit.type === 'select' && <Field label="Options" hint="Comma separated" className="col-span-full"><Input value={String(edit.options)} onChange={(e) => setEdit({ ...edit, options: e.target.value })} /></Field>}
        <label className="col-span-full flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={!!edit.required} onChange={(e) => setEdit({ ...edit, required: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Required when saving</label>
      </div></Modal>}
  </>;
}

/* ---------- automations ---------- */
const EVENTS: [AutomationTrigger['event'], string][] = [['deal.created', 'A deal is created'], ['deal.stage', 'A deal enters a stage'], ['deal.won', 'A deal is won'], ['deal.lost', 'A deal is lost'], ['lead.created', 'A lead is created'], ['lead.status', 'A lead’s status changes to'],
  ['deal.closing_soon', 'An open deal’s closing date is within'], ['deal.idle', 'An open deal sits in its stage for'], ['deal.contract_ending', 'A won deal’s contract ends within'], ['lead.untouched', 'A new lead is not contacted for'],
  ['ticket.created', 'A ticket is created'], ['ticket.status', 'A ticket’s status changes to'], ['ticket.customer_reply', 'A customer replies on a ticket'], ['ticket.idle', 'A ticket gets no update for']];
const TIME_EVENTS = ['deal.closing_soon', 'deal.idle', 'deal.contract_ending', 'lead.untouched', 'ticket.idle'];
function AutomationsTab({ module, items, runs }: { module: Mod; items: Automation[]; runs: Run[] }) {
  const { pipelines, users, desk } = useApp(); const run = useRun(); const [edit, setEdit] = useState<Automation | 'new' | null>(null);
  const stageName = (id?: string) => pipelines.flatMap((p) => p.subs.flatMap((s) => s.stages)).find((s) => s.id === id)?.name;
  const describe = (a: Automation) => { const t = a.trigger; const x = a.actions; const out: string[] = [];
    if (x.task) out.push(`${ACT_TYPES.find((q) => q[0] === x.task!.type)?.[1].toLowerCase()} “${x.task.title}” in ${x.task.dueDays}d`); if (x.assign?.pool.length) out.push(`round-robin to ${x.assign.pool.length} people`);
    if (x.tag) out.push(`tag ${x.tag}`); if (x.priority) out.push(`priority ${x.priority}`); if (x.status) out.push(`status ${x.status}`); if (x.note) out.push('add note');
    if (x.createDeal) out.push(`create a ${pipelines.find((p) => p.id === x.createDeal!.pipelineId)?.recordName.toLowerCase() || 'record'} in ${pipelines.find((p) => p.id === x.createDeal!.pipelineId)?.name}`);
    if (x.notify) out.push(`notify ${x.notify.to}`);
    if (x.assignTo) out.push(x.assignTo.mode === 'agent' ? `assign to ${users.find((u) => u.id === x.assignTo!.userId)?.name || 'an agent'}` : x.assignTo.mode === 'load' ? 'assign to least busy agent' : 'assign round-robin');
    if (x.setStatusId) out.push(`status ${desk?.statuses.find((s) => s.id === x.setStatusId)?.name}`); if (x.setPriority) out.push(`priority ${x.setPriority}`); if (x.setTeamId) out.push(`team ${desk?.teams.find((q) => q.id === x.setTeamId)?.name}`);
    if (t.event.startsWith('ticket')) { const c = [t.departmentId && desk?.departments.find((d) => d.id === t.departmentId)?.name, t.priority, t.channel && CHANNEL_LABEL[t.channel], t.keyword && `“${t.keyword}”`, t.statusId && desk?.statuses.find((s) => s.id === t.statusId)?.name].filter(Boolean);
      return `When ${EVENTS.find((e) => e[0] === t.event)?.[1].toLowerCase()}${t.event === 'ticket.idle' ? ` ${t.days ?? 2} days` : ''}${c.length ? ` (${c.join(', ')})` : ''} → ${out.join(' · ')}`; }
    return `When ${EVENTS.find((e) => e[0] === t.event)?.[1].toLowerCase()}${TIME_EVENTS.includes(t.event) ? ` ${t.days ?? 7} days` : ''}${t.stageId ? ` “${stageName(t.stageId)}”` : ''}${t.status ? ` “${t.status}”` : ''}${t.pipelineId ? ` in ${pipelines.find((p) => p.id === t.pipelineId)?.name}` : ''} → ${out.join(' · ')}`; };
  return <>
    <Intro>{module === 'desk' ? 'Ticket automations route, prioritise and escalate tickets the moment they arrive or change, and chase tickets nobody has updated.' : 'Automations run on the server whenever someone makes the matching change, so follow-ups are never forgotten.'}</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit('new')}><Plus size={15} />Automation</Button></div>
    <Panel>{items.length ? items.map((a) => <div key={a.id} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
      <button role="switch" aria-checked={a.active} aria-label={a.active ? 'Turn off' : 'Turn on'} onClick={() => run(A.toggleAutomation(a.id, !a.active))} className={cn('relative h-6 w-10 flex-none rounded-full transition', a.active ? 'bg-good' : 'bg-line')}><span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', a.active ? 'left-[18px]' : 'left-0.5')} /></button>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[13.5px] font-semibold"><Zap size={14} className="text-accent" />{a.name}<span className="num text-xs font-normal text-muted">ran {a.runCount}×</span></div><div className="truncate text-xs text-muted">{describe(a)}</div></div>
      <Button size="sm" variant="ghost" onClick={() => setEdit(a)}>Edit</Button><ConfirmButton size="sm" confirmText="Remove?" onConfirm={() => run(A.deleteAutomation(a.id), 'Automation removed')}>Remove</ConfirmButton></div>)
      : <p className="px-5 py-8 text-center text-[13px] text-muted">No automations yet.</p>}</Panel>
    <Panel title="Recent runs" count={runs.length} className="mt-4">{runs.length ? <div className="overflow-x-auto"><table className="tbl min-w-[560px]"><thead><tr><th>When</th><th>Automation</th><th>Record</th><th>What it did</th></tr></thead>
      <tbody>{runs.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-muted">{timeAgo(r.at)} · {new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td><td className="font-medium">{items.find((a) => a.id === r.automationId)?.name || 'Removed'}</td>
        <td><Link className="text-accent hover:underline" href={r.recordType === 'ticket' ? `/desk/tickets/${r.recordId}` : `/${r.recordType === 'deal' ? 'deals' : 'leads'}/${r.recordId}`}>Open {r.recordType}</Link></td><td className="text-[13px]">{r.summary}</td></tr>)}</tbody></table></div>
      : <p className="px-5 py-6 text-[13px] text-muted">Nothing has run yet. Time-based automations are checked every hour.</p>}</Panel>
    {edit && <AutoModal module={module} a={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
  </>;
}
function AutoModal({ module, a, onClose }: { module: Mod; a: Automation | null; onClose: () => void }) {
  const { pipelines, users, desk } = useApp(); const run = useRun();
  const [name, setName] = useState(a?.name || ''); const [t, setT] = useState<AutomationTrigger>(a?.trigger || { event: module === 'desk' ? 'ticket.created' : 'deal.won' });
  const [x, setX] = useState<AutomationActions>(a?.actions || (module === 'desk' ? { assignTo: { mode: 'round_robin' } } : { task: { title: 'Follow up: {{name}}', type: 'call', dueDays: 1 } }));
  const isDeal = t.event.startsWith('deal'); const isTicket = t.event.startsWith('ticket'); const pipe = pipelines.find((p) => p.id === t.pipelineId); const timed = TIME_EVENTS.includes(t.event);
  const targets = pipelines.flatMap((p) => p.subs.flatMap((s) => s.stages.filter((st) => st.type === 'open').map((st) => [`${p.id}:${s.id}:${st.id}`, `${p.name} · ${p.subs.length > 1 ? s.name + ' · ' : ''}${st.name}`])));
  const toggle = <K extends keyof AutomationActions>(k: K, on: boolean, val: AutomationActions[K]) => setX((o) => { const n = { ...o }; if (on) n[k] = val; else delete n[k]; return n; });
  return <Modal open wide onClose={onClose} title={a ? 'Edit automation' : 'New automation'} sub="Choose when it runs, then what it does."
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => { const clean = { ...x }; if (!isDeal) { delete clean.priority; delete clean.createDeal; } if (isDeal || isTicket) delete clean.status; if (isTicket) { delete clean.task; delete clean.assign; delete clean.tag; delete clean.note; } else { delete clean.assignTo; delete clean.setStatusId; delete clean.setPriority; delete clean.setTeamId; if (clean.notify?.to === 'department') clean.notify = { ...clean.notify, to: 'owner' }; } if (await run(A.saveAutomation({ id: a?.id, name, active: a?.active ?? true, trigger: t, actions: clean }), 'Automation saved')) onClose(); }}>Save</Button></>}>
    <div className="grid gap-4 pb-3 lg:grid-cols-2">
      <Field label="Name" required className="col-span-full"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Won deal starts onboarding" /></Field>
      <fieldset className="grid content-start gap-3 rounded-xl border border-line p-4"><legend className="eyebrow px-1">When</legend>
        <Field label="Trigger"><Select value={t.event} onChange={(e) => { const ev = e.target.value as AutomationTrigger['event']; setT(TIME_EVENTS.includes(ev) ? { event: ev, days: ev === 'deal.idle' ? 14 : ev === 'lead.untouched' || ev === 'ticket.idle' ? 2 : 7 } : { event: ev }); }}>
          {module === 'desk' ? EVENTS.filter(([k]) => k.startsWith('ticket')).map(([k, l]) => <option key={k} value={k}>{l}{k === 'ticket.idle' ? ' … days' : ''}</option>) : <>
          <optgroup label="When something changes">{EVENTS.filter(([k]) => !TIME_EVENTS.includes(k) && !k.startsWith('ticket')).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
          <optgroup label="On a schedule (checked hourly)">{EVENTS.filter(([k]) => TIME_EVENTS.includes(k) && !k.startsWith('ticket')).map(([k, l]) => <option key={k} value={k}>{l} … days</option>)}</optgroup></>}</Select></Field>
        {timed && <Field label="Days" hint="Runs once per record each time this becomes true"><Input type="number" min={1} value={String(t.days ?? 7)} onChange={(e) => setT({ ...t, days: Math.max(1, +e.target.value || 1) })} /></Field>}
        {isDeal && <Field label="Pipeline"><Select value={t.pipelineId || ''} onChange={(e) => setT({ ...t, pipelineId: e.target.value || undefined, stageId: undefined })}><option value="">Any pipeline</option>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
        {(t.event === 'deal.stage' || t.event === 'deal.idle') && <Field label="Stage" required={t.event === 'deal.stage'}><Select value={t.stageId || ''} onChange={(e) => setT({ ...t, stageId: e.target.value || undefined })}><option value="">{t.event === 'deal.idle' ? 'Any open stage' : 'Choose…'}</option>{(pipe ? [pipe] : pipelines).flatMap((p) => p.subs.flatMap((s) => s.stages.filter((st) => t.event !== 'deal.idle' || st.type === 'open').map((st) => <option key={st.id} value={st.id}>{p.name} · {st.name}</option>)))}</Select></Field>}
        {isTicket && desk && <>
          <Field label="Department"><Select value={t.departmentId || ''} onChange={(e) => setT({ ...t, departmentId: e.target.value || undefined })}><option value="">Any department</option>{desk.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          {t.event === 'ticket.status' && <Field label="Status" required><Select value={t.statusId || ''} onChange={(e) => setT({ ...t, statusId: e.target.value || undefined })}><option value="">Choose…</option>{desk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Priority"><Select value={t.priority || ''} onChange={(e) => setT({ ...t, priority: e.target.value || undefined })}><option value="">Any</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Channel"><Select value={t.channel || ''} onChange={(e) => setT({ ...t, channel: e.target.value || undefined })}><option value="">Any</option>{TICKET_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select></Field></div>
          <Field label="Subject or message contains" hint="Use | for “any of”, e.g. licence|activation"><Input value={t.keyword || ''} onChange={(e) => setT({ ...t, keyword: e.target.value || undefined })} /></Field></>}
        {t.event === 'lead.status' && <Field label="Status" required><Select value={t.status || ''} onChange={(e) => setT({ ...t, status: e.target.value })}><option value="">Choose…</option>{['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'].map((s) => <option key={s}>{s}</option>)}</Select></Field>}
      </fieldset>
      <fieldset className="grid content-start gap-3 rounded-xl border border-line p-4"><legend className="eyebrow px-1">Then</legend>
        {isTicket && desk ? <>
          <label className="flex items-center gap-2 text-[13.5px] font-semibold"><input type="checkbox" checked={!!x.assignTo} onChange={(e) => toggle('assignTo', e.target.checked, { mode: 'round_robin' })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Assign the ticket</label>
          {x.assignTo && <div className="grid gap-2 pl-6 sm:grid-cols-2"><Select value={x.assignTo.mode} onChange={(e) => setX({ ...x, assignTo: { ...x.assignTo!, mode: e.target.value as 'agent' } })} aria-label="How to assign"><option value="round_robin">Round robin</option><option value="load">Least busy agent</option><option value="agent">A specific agent</option></Select>
            {x.assignTo.mode === 'agent' ? <Select value={x.assignTo.userId || ''} onChange={(e) => setX({ ...x, assignTo: { ...x.assignTo!, userId: e.target.value } })} aria-label="Agent"><option value="">Choose…</option>{desk.agents.filter((a) => a.active && (a.deskRole === 'agent' || a.deskRole === 'admin')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
              : <Select value={x.assignTo.teamId || ''} onChange={(e) => setX({ ...x, assignTo: { ...x.assignTo!, teamId: e.target.value || undefined } })} aria-label="Among"><option value="">Among the department’s agents</option>{desk.teams.map((q) => <option key={q.id} value={q.id}>Among team {q.name}</option>)}</Select>}</div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Set status"><Select value={x.setStatusId || ''} onChange={(e) => setX({ ...x, setStatusId: e.target.value || undefined })}><option value="">Leave as is</option>{desk.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Set priority"><Select value={x.setPriority || ''} onChange={(e) => setX({ ...x, setPriority: e.target.value || undefined })}><option value="">Leave as is</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Move to team"><Select value={x.setTeamId || ''} onChange={(e) => setX({ ...x, setTeamId: e.target.value || undefined })}><option value="">Leave as is</option>{desk.teams.map((q) => <option key={q.id} value={q.id}>{desk.departments.find((d) => d.id === q.departmentId)?.name} · {q.name}</option>)}</Select></Field></div>
          <label className="flex items-center gap-2 text-[13.5px] font-semibold"><input type="checkbox" checked={!!x.notify} onChange={(e) => toggle('notify', e.target.checked, { to: 'owner', message: 'Check {{name}}' })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Send an in-app notification</label>
          {x.notify && <div className="grid gap-2 pl-6 sm:grid-cols-[150px_1fr]"><Select value={x.notify.to} onChange={(e) => setX({ ...x, notify: { ...x.notify!, to: e.target.value as 'owner' } })} aria-label="Notify whom"><option value="owner">The assignee</option><option value="manager">Assignee’s manager</option><option value="department">Department agents</option></Select><Input value={x.notify.message} onChange={(e) => setX({ ...x, notify: { ...x.notify!, message: e.target.value } })} aria-label="Message" /></div>}
        </> : <>
        <label className="flex items-center gap-2 text-[13.5px] font-semibold"><input type="checkbox" checked={!!x.task} onChange={(e) => toggle('task', e.target.checked, { title: 'Follow up: {{name}}', type: 'call', dueDays: 1 })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Create an activity</label>
        {x.task && <div className="grid gap-2 pl-6 sm:grid-cols-[1fr_120px_90px]"><Input value={x.task.title} onChange={(e) => setX({ ...x, task: { ...x.task!, title: e.target.value } })} aria-label="Activity title" /><Select value={x.task.type} onChange={(e) => setX({ ...x, task: { ...x.task!, type: e.target.value } })}>{ACT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select><Input type="number" min={0} value={x.task.dueDays} onChange={(e) => setX({ ...x, task: { ...x.task!, dueDays: +e.target.value } })} aria-label="Due in days" /></div>}
        <label className="flex items-center gap-2 text-[13.5px] font-semibold"><input type="checkbox" checked={!!x.assign} onChange={(e) => toggle('assign', e.target.checked, { pool: [] })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Assign owner round-robin</label>
        {x.assign && <div className="flex flex-wrap gap-2 pl-6">{users.filter((u) => u.active).map((u) => <label key={u.id} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={x.assign!.pool.includes(u.id)} onChange={(e) => setX({ ...x, assign: { pool: e.target.checked ? [...x.assign!.pool, u.id] : x.assign!.pool.filter((p) => p !== u.id) } })} className="h-4 w-4 accent-[rgb(var(--accent))]" />{u.name}</label>)}</div>}
        <label className="flex items-center gap-2 text-[13.5px] font-semibold"><input type="checkbox" checked={!!x.notify} onChange={(e) => toggle('notify', e.target.checked, { to: 'owner', message: isDeal ? 'Check {{name}}' : 'Follow up {{name}}' })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Send an in-app notification</label>
        {x.notify && <div className="grid gap-2 pl-6 sm:grid-cols-[130px_1fr]"><Select value={x.notify.to} onChange={(e) => setX({ ...x, notify: { ...x.notify!, to: e.target.value as 'owner' } })} aria-label="Notify whom"><option value="owner">The owner</option><option value="manager">Owner’s manager</option></Select><Input value={x.notify.message} onChange={(e) => setX({ ...x, notify: { ...x.notify!, message: e.target.value } })} aria-label="Message" /></div>}
        <div className="grid gap-2 sm:grid-cols-2"><Field label="Add tag(s)"><Input value={x.tag || ''} onChange={(e) => setX({ ...x, tag: e.target.value || undefined })} /></Field><Field label="Add note"><Input value={x.note || ''} onChange={(e) => setX({ ...x, note: e.target.value || undefined })} /></Field>
          {isDeal ? <Field label="Set priority"><Select value={x.priority || ''} onChange={(e) => setX({ ...x, priority: e.target.value || undefined })}><option value="">Leave as is</option><option>High</option><option>Medium</option><option>Low</option></Select></Field>
            : <Field label="Set lead status"><Select value={x.status || ''} onChange={(e) => setX({ ...x, status: e.target.value || undefined })}><option value="">Leave as is</option>{['New', 'Contacted', 'Qualified', 'Unqualified'].map((s) => <option key={s}>{s}</option>)}</Select></Field>}
          {isDeal && <Field label="Create a record in"><Select value={x.createDeal ? `${x.createDeal.pipelineId}:${x.createDeal.subPipelineId}:${x.createDeal.stageId}` : ''} onChange={(e) => { const [pipelineId, subPipelineId, stageId] = e.target.value.split(':'); setX({ ...x, createDeal: e.target.value ? { pipelineId, subPipelineId, stageId } : undefined }); }}><option value="">Nothing</option>{targets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}</div>
        </>}
      </fieldset>
    </div>
  </Modal>;
}

/* ---------- scoring ---------- */
function ScoringTab({ rules }: { rules: ScoringRule[] }) {
  const { customFields, settings } = useApp(); const run = useRun();
  const fields: [string, string][] = [...Object.entries(SCORE_FIELD_LABELS), ...customFields.filter((f) => f.module === 'lead').map((f) => ['cf:' + f.id, f.label] as [string, string])];
  const [f, setF] = useState('source'); const [op, setOp] = useState<'is' | 'contains' | 'filled'>('is'); const [val, setVal] = useState(''); const [pts, setPts] = useState('10');
  const label = (k: string) => fields.find((x) => x[0] === k)?.[1] || k;
  return <>
    <Intro>Each matching rule adds points to a lead’s score (0–100). Leads at {settings.hotScore}+ are Hot and show on Home. Use | between words for “contains any of”. Thresholds are under Company & currency.</Intro>
    <Panel title="Rules" count={rules.length}>{rules.map((r) => <div key={r.id} className="flex items-center gap-3 border-b border-line px-5 py-3 text-[13.5px] last:border-0"><span className="flex-1">If <b>{label(r.field)}</b> {r.operator === 'filled' ? 'is filled in' : r.operator === 'is' ? <>is <b>{r.value}</b></> : <>contains <b>{r.value}</b></>}</span><Chip tone={r.points < 0 ? 'bad' : 'good'}>{r.points > 0 ? '+' : ''}{r.points}</Chip><IconButton label="Remove rule" onClick={() => run(A.deleteScoringRule(r.id), 'Rule removed')}><Trash2 size={15} /></IconButton></div>)}
      <div className="grid gap-2 border-t border-line bg-raised p-4 sm:grid-cols-[1fr_150px_1fr_90px_auto]"><Select value={f} onChange={(e) => setF(e.target.value)} aria-label="Field">{fields.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select value={op} onChange={(e) => setOp(e.target.value as 'is')} aria-label="Condition"><option value="is">is</option><option value="contains">contains any of</option><option value="filled">is filled in</option></Select>
        <Input value={val} disabled={op === 'filled'} onChange={(e) => setVal(e.target.value)} placeholder="e.g. Referral or ciso|cto" aria-label="Value" /><Input type="number" value={pts} onChange={(e) => setPts(e.target.value)} aria-label="Points" />
        <Button variant="primary" onClick={async () => { if (await run(A.saveScoringRule({ field: f, operator: op, value: val, points: +pts || 0 }), 'Rule added')) setVal(''); }}>Add</Button></div></Panel>
  </>;
}

/* ---------- templates ---------- */
function TemplatesTab() {
  const { templates } = useApp(); const run = useRun(); const [edit, setEdit] = useState<null | { id?: string; name: string; subject: string; body: string }>(null);
  return <>
    <Intro>Templates appear in the email composer on leads, contacts and deals. Merge fields: {'{{first_name}}'}, {'{{last_name}}'}, {'{{company}}'}, {'{{deal}}'}, {'{{amount}}'}, {'{{my_name}}'}.</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => setEdit({ name: '', subject: '', body: '' })}><Plus size={15} />Template</Button></div>
    <Panel>{templates.map((t) => <div key={t.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0"><button className="min-w-0 flex-1 text-left" onClick={() => setEdit(t)}><div className="text-[13.5px] font-semibold">{t.name}</div><div className="truncate text-xs text-muted">{t.subject}</div></button><ConfirmButton size="sm" confirmText="Remove?" onConfirm={() => run(A.deleteTemplate(t.id), 'Template removed')}>Remove</ConfirmButton></div>)}
      {!templates.length && <p className="px-5 py-8 text-center text-[13px] text-muted">No templates yet.</p>}</Panel>
    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? 'Edit template' : 'New template'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (await run(A.saveTemplate(edit), 'Template saved')) setEdit(null); }}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3"><Field label="Name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field><Field label="Subject" required><Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field><Field label="Body"><Textarea className="min-h-[240px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field></div></Modal>}
  </>;
}

/* ---------- products ---------- */
function ProductsTab({ items }: { items: Product[] }) {
  const openForm = useForms(); const run = useRun();
  return <>
    <Intro>The catalogue used for deal line items and for the products distributor contacts handle. Prices are in AED and convert to the deal’s currency when added.</Intro>
    <div className="mb-3 flex gap-2"><span className="flex-1" /><a href="/api/export/products"><Button><Download size={15} />Export</Button></a><Button variant="primary" onClick={() => openForm('product')}><Plus size={15} />Product</Button></div>
    <div className="panel overflow-x-auto"><table className="tbl min-w-[620px]"><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Billing</th><th className="text-right">Unit price</th><th className="text-right">Margin</th><th>Status</th><th /></tr></thead>
      <tbody>{items.map((p) => <tr key={p.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) openForm('product', p as never); }}><td className="font-semibold">{p.name}</td><td className="num text-[13px]">{p.sku || '—'}</td><td>{p.category || '—'}</td><td className="text-[13px]">{p.billingType}{p.unit ? ` · per ${p.unit}` : ''}</td><td className="num text-right">{fmtMoney(p.unitPrice)}</td><td className="num text-right text-[13px]">{p.costPrice != null && p.unitPrice > 0 ? `${Math.round((1 - p.costPrice / p.unitPrice) * 100)}%` : '—'}</td><td>{p.active ? <Chip tone="good">Active</Chip> : <Chip>Inactive</Chip>}</td>
        <td className="text-right"><ConfirmButton size="sm" confirmText="Delete?" onConfirm={() => run(A.deleteRecords('product', [p.id]), 'Product deleted')}>Delete</ConfirmButton></td></tr>)}
        {!items.length && <tr><td colSpan={8} className="py-8 text-center text-muted">No products yet.</td></tr>}</tbody></table></div>
  </>;
}

/* ---------- users (CRM: Users & access · Helpdesk: Agents & access) ---------- */
type UEdit = { id?: string; name: string; email: string; role: 'admin' | 'manager' | 'rep'; password: string; active: boolean; managerId: string; monthlyTarget: string; reassignTo: string; wasActive: boolean; crmAccess: boolean; deskRole: DeskRole; ticketScope: TicketScope; departmentIds: string[] };
const DESK_ROLE: Record<DeskRole, string> = { none: 'No helpdesk access', admin: 'Helpdesk admin', agent: 'Agent', light: 'Light agent (read + notes)' };
const SCOPE: Record<TicketScope, string> = { all: 'All tickets', department: 'All tickets in their departments', team: 'Their team’s tickets + unassigned in their departments', own: 'Assigned to them + unassigned in their departments' };
const CRM_ROLE: Record<string, string> = { admin: 'Admin', manager: 'Manager', rep: 'Sales rep' };
function UsersTab({ module, access, departments, routing, leaves }: { module: Mod; access: Record<string, Access>; departments: DeptRow[]; routing?: Ext['routing']; leaves?: LeaveRow[] }) {
  const [routeFor, setRouteFor] = useState<{ id: string; name: string } | null>(null);
  const { users, me } = useApp(); const run = useRun(); const toast = useToast(); const [edit, setEdit] = useState<UEdit | null>(null); const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const desk = module === 'desk'; const wsAdmin = me.role === 'admin';
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name;
  const inModule = (u: { id: string; role: string }) => { const a = access[u.id]; return u.role === 'admin' || (desk ? !!a && a.deskRole !== 'none' : !!a?.crmAccess); };
  const members = users.filter(inModule); const others = users.filter((u) => !inModule(u) && u.active);
  /** Helpdesk admins (not workspace admins) manage the sign-in of helpdesk-only people only. */
  const canSignIn = (u?: { id: string; role: string }) => wsAdmin || !u || (u.role !== 'admin' && !access[u.id]?.crmAccess);
  const pw = edit?.password ? passwordProblem(edit.password, edit.email) : null;
  const deactivating = !!edit?.id && edit.wasActive && !edit.active;
  const target = edit?.id ? users.find((u) => u.id === edit.id) : undefined; const signIn = canSignIn(target);
  const open = (u?: typeof users[number]) => { const a = u ? access[u.id] : undefined;
    setEdit(u ? { id: u.id, name: u.name, email: u.email, role: u.role as 'rep', password: '', active: u.active, managerId: u.managerId || '', monthlyTarget: a?.monthlyTarget ? String(a.monthlyTarget) : '', reassignTo: u.managerId || '', wasActive: u.active, crmAccess: a?.crmAccess ?? false, deskRole: desk && !inModule(u) ? 'agent' : a?.deskRole ?? 'none', ticketScope: a?.ticketScope ?? 'department', departmentIds: a?.deptIds?.length ? a.deptIds : desk && !inModule(u) && departments[0] ? [departments[0].id] : [] }
      : { name: '', email: '', role: 'rep', password: '', active: true, managerId: '', monthlyTarget: '', reassignTo: '', wasActive: true, crmAccess: !desk, deskRole: desk ? 'agent' : 'none', ticketScope: 'department', departmentIds: desk && departments[0] ? [departments[0].id] : [] }); };
  const row = (u: typeof users[number]) => { const a = access[u.id]; return <tr key={u.id}>
    <td className="font-semibold">{u.name}{u.id === me.id && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}{a?.totpEnabled && <ShieldCheck size={13} className="ml-1 inline text-good" aria-label="Two-step sign-in on" />}</td><td>{u.email}</td>
    {desk ? <><td>{u.role === 'admin' ? 'Admin' : DESK_ROLE[a?.deskRole || 'none'].split(' (')[0]}</td>
        <td className="text-[13px]">{u.role === 'admin' || a?.deskRole === 'admin' ? 'All tickets' : a && a.deskRole !== 'none' ? <>{SCOPE[a.ticketScope].split(' + ')[0]}<span className="block text-xs text-muted">{a.deptIds.map((d) => departments.find((x) => x.id === d)?.name).filter(Boolean).join(', ') || 'No department'}</span></> : <span className="text-faint">—</span>}</td></>
      : <><td>{CRM_ROLE[u.role]}</td><td className="num text-right">{a?.monthlyTarget ? fmtMoney(a.monthlyTarget) : <span className="text-faint">—</span>}</td></>}
    <td>{nameOf(u.managerId) || <span className="text-faint">—</span>}</td><td>{u.active ? <Chip tone="good">Active</Chip> : <Chip>Deactivated</Chip>}</td>
    <td className="whitespace-nowrap text-right">{u.active && u.id !== me.id && canSignIn(u) && <Button size="sm" variant="ghost" onClick={async () => { const r = await A.adminResetLink(u.id); if (!r.ok) return toast(r.error, 'bad'); setLink({ name: u.name, url: r.link.startsWith('/') ? window.location.origin + r.link : r.link }); }}>Reset link</Button>}
      {a?.totpEnabled && u.id !== me.id && canSignIn(u) && <ConfirmButton size="sm" variant="ghost" confirmText="Turn off their 2-step?" onConfirm={() => run(A.adminResetTwoFactor(u.id), 'Two-step sign-in reset — they can sign in with their password and set it up again')}>Reset 2-step</ConfirmButton>}
      {desk && routing && inModule(u) && (a?.deskRole === 'agent' || u.role === 'admin' || a?.deskRole === 'admin') && <Button size="sm" variant="ghost" onClick={() => setRouteFor({ id: u.id, name: u.name })}>Skills &amp; shifts</Button>}
      {(wsAdmin || u.role !== 'admin') && <Button size="sm" variant="ghost" onClick={() => open(u)}>{inModule(u) ? 'Edit' : desk ? 'Give access' : 'Give CRM access'}</Button>}</td></tr>; };
  const save = async () => { if (!edit) return; const v = { ...edit, crmAccess: !desk && edit.id && !inModule(target!) ? true : edit.crmAccess };
    if (await run(A.saveUser({ ...v, password: v.password || undefined, managerId: v.managerId || null, monthlyTarget: v.monthlyTarget, reassignTo: deactivating ? v.reassignTo || null : null, departmentIds: !desk ? undefined : v.deskRole === 'none' ? [] : v.departmentIds }), 'Saved')) setEdit(null); };
  return <>
    <Intro>{desk
      ? <>Who works in the helpdesk. <b>Helpdesk admins</b> set up departments, SLAs and the portal and see every ticket. <b>Agents</b> work the tickets their scope allows, in the departments you tick. <b>Light agents</b> read tickets in their departments and add private notes, and are never assigned tickets. A manager (“Reports to”) also sees tickets assigned to their people.</>
      : <>Who uses the CRM. Admins manage settings and users and see everyone’s tasks. Managers edit all records and see the tasks of everyone who reports to them (set “Reports to”). Sales reps edit only what they own and see only their own tasks.</>}</Intro>
    <div className="mb-3 flex"><span className="flex-1" /><Button variant="primary" onClick={() => open()}><Plus size={15} />{desk ? 'Add agent' : 'Add user'}</Button></div>
    <div className="panel overflow-x-auto"><table className="tbl min-w-[860px]"><thead><tr><th>Name</th><th>Email</th>{desk ? <><th>Helpdesk role</th><th>Can see</th></> : <><th>Role</th><th className="text-right">Monthly target</th></>}<th>Reports to</th><th>Status</th><th /></tr></thead>
      <tbody>{members.map(row)}{!members.length && <tr><td colSpan={7} className="py-8 text-center text-muted">Nobody yet.</td></tr>}</tbody></table></div>
    {others.length > 0 && <div className="mt-4"><button className="text-[13px] font-semibold text-accent hover:underline" onClick={() => setShowOthers(!showOthers)}>{showOthers ? 'Hide' : 'Show'} {others.length} {others.length === 1 ? 'person' : 'people'} without {desk ? 'helpdesk' : 'CRM'} access</button>
      {showOthers && <div className="panel mt-2 overflow-x-auto"><table className="tbl min-w-[860px]"><tbody>{others.map(row)}</tbody></table></div>}</div>}

    {edit && <Modal open wide onClose={() => setEdit(null)} title={edit.id ? (inModule(target!) ? `Edit ${desk ? 'agent' : 'user'}` : `Give ${edit.name.split(' ')[0]} ${desk ? 'helpdesk' : 'CRM'} access`) : desk ? 'Add agent' : 'Add user'}
      sub={!signIn ? 'This person also uses the CRM, so a workspace admin manages their name, email and password.' : edit.id ? 'Leave the password blank to keep it.' : 'Share the temporary password with them; they can change it under My account.'}
      footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!!pw} onClick={save}>Save</Button></>}>
      <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
        <Field label="Name" required><Input value={edit.name} disabled={!signIn} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field><Field label="Email" required><Input type="email" value={edit.email} disabled={!signIn} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
        {desk ? <fieldset className="col-span-full grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"><legend className="eyebrow px-1">Helpdesk access</legend>
          {edit.role === 'admin' ? <p className="col-span-full text-[13px] text-muted">Workspace admins are always helpdesk admins.</p> : <>
            <Field label="Helpdesk role"><Select value={edit.deskRole} onChange={(e) => setEdit({ ...edit, deskRole: e.target.value as DeskRole })}>{(Object.keys(DESK_ROLE) as DeskRole[]).filter((k) => k !== 'none' || edit.crmAccess).map((k) => <option key={k} value={k}>{DESK_ROLE[k]}</option>)}</Select></Field>
            {(edit.deskRole === 'agent' || edit.deskRole === 'light') ? <Field label="Can see" hint={edit.deskRole === 'light' ? 'Light agents always see their departments' : undefined}><Select value={edit.deskRole === 'light' ? 'department' : edit.ticketScope} disabled={edit.deskRole === 'light'} onChange={(e) => setEdit({ ...edit, ticketScope: e.target.value as TicketScope })}>{(Object.keys(SCOPE) as TicketScope[]).map((k) => <option key={k} value={k}>{SCOPE[k]}</option>)}</Select></Field> : <span />}
            {edit.deskRole !== 'none' && <Field label="Departments" className="col-span-full"><div className="flex flex-wrap gap-x-4 gap-y-2">{departments.map((d) => <label key={d.id} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={edit.departmentIds.includes(d.id)} onChange={(e) => setEdit({ ...edit, departmentIds: e.target.checked ? [...edit.departmentIds, d.id] : edit.departmentIds.filter((x) => x !== d.id) })} className="h-4 w-4 accent-[rgb(var(--accent))]" />{d.name}</label>)}{!departments.length && <span className="text-[13px] text-muted">Add a department first.</span>}</div></Field>}
            {edit.deskRole === 'none' && <p className="col-span-full text-[13px] text-muted">They keep their CRM access; their open tickets go back to the unassigned queue.</p>}</>}
        </fieldset>
        : <fieldset className="col-span-full grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2"><legend className="eyebrow px-1">CRM access</legend>
          <Field label="Role" hint={edit.role === 'admin' ? 'Admins manage all settings and users' : undefined}><Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as 'rep' })}><option value="rep">Sales rep</option><option value="manager">Manager</option><option value="admin">Admin</option></Select></Field>
          <Field label="Monthly won target (AED)" hint="Shown on the Home leaderboard"><Input type="number" min={0} value={edit.monthlyTarget} onChange={(e) => setEdit({ ...edit, monthlyTarget: e.target.value })} /></Field>
          {edit.id && edit.role !== 'admin' && inModule(target!) && edit.deskRole !== 'none' && <label className="col-span-full flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={!edit.crmAccess} onChange={(e) => setEdit({ ...edit, crmAccess: !e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Remove CRM access (they keep their helpdesk access)</label>}
        </fieldset>}
        <Field label="Reports to" hint={desk ? 'Their manager also sees their tickets' : 'Their manager sees their tasks'}><Select value={edit.managerId} disabled={!signIn} onChange={(e) => setEdit({ ...edit, managerId: e.target.value })}><option value="">No one</option>{users.filter((u) => u.id !== edit.id && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        {signIn ? <Field label={edit.id ? 'New password' : 'Temporary password'} required={!edit.id} hint={pw || '10+ characters with letters and numbers'}><Input type="text" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} className={pw ? '!border-bad' : ''} /></Field> : <span />}
        {edit.id && edit.id !== me.id && signIn && <label className="col-span-full flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />Active (can sign in)</label>}
        {deactivating && <div className="col-span-full rounded-xl border border-warn/40 bg-warn-soft p-3.5">
          <p className="mb-2 text-[13px] text-warn">Deactivating signs {edit.name.split(' ')[0]} out everywhere. Anyone who reports to them will report to their manager instead.</p>
          <Field label={desk ? 'Give their open tickets to' : 'Give their leads, deals, contacts, companies and open tasks to'}><Select value={edit.reassignTo} onChange={(e) => setEdit({ ...edit, reassignTo: e.target.value })}><option value="">{desk ? 'Nobody — return them to the unassigned queue' : 'Nobody — leave them as they are'}</option>{users.filter((u) => u.id !== edit.id && u.active && (!desk || (access[u.id] && access[u.id].deskRole !== 'none') || u.role === 'admin')).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field></div>}</div></Modal>}
    {routeFor && routing && <RoutingModal agent={{ ...routeFor, skills: routing[routeFor.id]?.skills || { products: [], vendors: [], languages: [] }, shift: routing[routeFor.id]?.shift || null }} leave={(leaves || []).filter((l) => l.userId === routeFor.id)} onClose={() => setRouteFor(null)} />}
    <Modal open={!!link} onClose={() => setLink(null)} title={`Reset link for ${link?.name}`} sub="Valid for 24 hours and works once. Send it to them privately (WhatsApp, Teams…)."
      footer={<Button variant="primary" onClick={() => setLink(null)}>Done</Button>}>
      <div className="flex gap-2 pb-3"><Input readOnly value={link?.url || ''} onFocus={(e) => e.target.select()} className="num text-[12px]" /><Button onClick={async () => { try { await navigator.clipboard.writeText(link!.url); toast('Copied'); } catch { toast('Select the link to copy it'); } }}><Copy size={14} />Copy</Button></div>
    </Modal>
  </>;
}

/* ---------- audit log ---------- */
const AUDIT_LABEL: Record<string, string> = { login: 'Signed in', 'login.failed': 'Failed sign-in', 'login.locked': 'Account locked after failed sign-ins', 'password.changed': 'Changed password', 'password.reset': 'Reset password', 'password.reset_requested': 'Asked for a reset link', 'password.reset_link': 'Created a reset link', 'sessions.revoked': 'Signed out on all devices',
  'user.created': 'Added a user', 'user.updated': 'Updated a user', 'user.deactivated': 'Deactivated a user', 'settings.changed': 'Changed settings', 'data.exported': 'Exported data', 'file.uploaded': 'Uploaded a file', 'file.deleted': 'Deleted a file', 'automation.created': 'Added an automation', 'automation.updated': 'Edited an automation' };
const auditText = (a: string) => AUDIT_LABEL[a] || a.replace(/^(\w+)\.(\w+)$/, (_m, e, v) => `${v[0].toUpperCase()}${v.slice(1)} ${e}`.replace('deleted', 'Deleted').replace('imported', 'Imported').replace('merged', 'Merged').replace('reassigned', 'Reassigned'));
function AuditTab({ rows, module }: { rows: AuditEntry[]; module: Mod }) {
  const { users } = useApp(); const router = useRouter();
  return <>
    <Intro>{module === 'desk' ? 'Helpdesk changes: departments, ticket deletions, portal invitations and helpdesk settings. Newest first (last 300).' : 'Who did what: sign-ins, password and user changes, settings, exports, imports, deletions, merges and files. Kept for review; newest first (last 300).'}</Intro>
    <div className="mb-3 flex"><Select className="h-9 w-auto" defaultValue="" onChange={(e) => router.replace(`${baseOf(module)}?tab=audit${e.target.value ? `&audit=${e.target.value}` : ''}`)} aria-label="Person"><option value="">Everyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></div>
    <div className="panel overflow-x-auto"><table className="tbl min-w-[640px]"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-[13px] text-muted">{new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td className="font-medium">{users.find((u) => u.id === r.userId)?.name || 'System'}</td>
        <td className={cn(r.action.includes('failed') || r.action.includes('locked') || r.action.includes('deleted') ? 'text-bad' : '')}>{auditText(r.action)}</td><td className="max-w-[320px] truncate text-[13px] text-muted">{[r.entity !== 'user' && r.entity !== 'settings' ? r.entity : null, r.detail].filter(Boolean).join(' · ')}</td></tr>)}
        {!rows.length && <tr><td colSpan={4} className="py-8 text-center text-muted">Nothing recorded yet.</td></tr>}</tbody></table></div>
  </>;
}

/* ---------- data ---------- */
function DataTab({ contacts, companies, samples, isAdmin }: { contacts: Props['contacts']; companies: Props['companies']; samples: number; isAdmin: boolean }) {
  const run = useRun(); const [imp, setImp] = useState<'' | 'lead' | 'contact' | 'company' | 'deal' | 'activity'>('');
  const groups = useMemo(() => {
    const g = new Map<string, { kind: 'contact' | 'company'; ids: string[]; label: string; sub: string }>();
    for (const c of contacts) for (const k of [c.email && 'e:' + c.email.toLowerCase().trim(), 'n:' + fullName(c).toLowerCase().replace(/\s+/g, ' ').trim()].filter(Boolean) as string[]) { const x = g.get('c' + k) || { kind: 'contact' as const, ids: [], label: fullName(c), sub: c.email || 'same name' }; x.ids.push(c.id); g.set('c' + k, x); }
    for (const c of companies) { const k = 'o' + c.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(llc|fzco|fze|ltd|limited)$/, ''); const x = g.get(k) || { kind: 'company' as const, ids: [], label: c.name, sub: 'same name' }; x.ids.push(c.id); g.set(k, x); }
    const seen = new Set<string>(); return [...g.values()].filter((x) => x.ids.length > 1).filter((x) => { const k = [...x.ids].sort().join(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [contacts, companies]);
  return <div className="grid gap-4 xl:grid-cols-2">
    <Panel title="Import" bodyClass="p-5"><p className="mb-3 text-[13.5px] text-muted">Bring in a CSV from Excel, Google Sheets, Bigin or another CRM. You match the columns and choose how duplicates are handled.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={() => setImp('lead')}>Import leads</Button><Button onClick={() => setImp('contact')}>Import contacts</Button><Button onClick={() => setImp('company')}>Import companies</Button><Button onClick={() => setImp('deal')}>Import deals</Button><Button onClick={() => setImp('activity')}>Import activities</Button></div></Panel>
    <Panel title="Export" bodyClass="p-5"><p className="mb-3 text-[13.5px] text-muted">Download any module as a CSV that opens in Excel.</p>
      <div className="flex flex-wrap gap-2">{['deals', 'leads', 'contacts', 'companies', 'activities', 'products', ...(isAdmin ? ['tickets'] : [])].map((k) => <a key={k} href={`/api/export/${k}`}><Button><Download size={14} />{k[0].toUpperCase() + k.slice(1)}</Button></a>)}</div></Panel>
    <Panel title="Duplicates" count={groups.length}>{groups.length ? groups.map((x) => <div key={x.ids.join()} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0"><div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{x.label}</div><div className="text-xs text-muted">{x.ids.length} {x.kind === 'contact' ? 'contacts' : 'companies'} · {x.sub}</div></div>
      <ConfirmButton size="sm" variant="secondary" confirmText="Merge now?" onConfirm={() => run(A.mergeRecords(x.kind, x.ids), 'Merged')}>Merge</ConfirmButton></div>)
      : <p className="px-5 py-6 text-[13px] text-muted">No duplicate contacts or companies found (matched on email, full name and company name). Merging keeps the oldest record and moves deals, activities and notes onto it.</p>}</Panel>
    {isAdmin && <Panel title="Sample data" bodyClass="p-5">{samples ? <><p className="mb-3 text-[13.5px] text-muted">{samples} sample records (marked “Sample:” or “Example”) are loaded. Remove them when you start entering real data. Pipelines and settings stay.</p><ConfirmButton variant="danger" confirmText="Remove all sample data?" onConfirm={() => run(A.removeSampleData(), 'Sample data removed')}>Remove sample data</ConfirmButton></> : <p className="text-[13.5px] text-muted">No sample data left.</p>}</Panel>}
    {imp && <ImportModal entity={imp} onClose={() => setImp('')} />}
  </div>;
}

/* ---------- account ---------- */
function AccountTab({ module, sessions, account, myMail }: { module: Mod; sessions: SessionRow[]; account: Props['account']; myMail: Ext['myMail'] }) {
  const { me } = useApp(); const run = useRun(); const [cur, setCur] = useState(''); const [nw, setNw] = useState('');
  const pw = nw ? passwordProblem(nw, me.email) : null;
  const access = [me.crmAccess && `CRM ${me.role === 'rep' ? 'sales rep' : me.role}`, me.deskRole !== 'none' && `Helpdesk ${me.deskRole === 'light' ? 'light agent' : me.deskRole}`].filter(Boolean).join(' · ');
  return <div className="grid max-w-3xl gap-4">
    <Panel title="My account" bodyClass="grid gap-3.5 p-5 sm:grid-cols-2">
      <p className="col-span-full text-[13.5px]"><b>{me.name}</b> · {me.email} · <span className="text-muted">{access || 'No module access'}</span></p>
      <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="New password" hint={pw || '10+ characters with letters and numbers'}><Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" className={pw ? '!border-bad' : ''} /></Field>
      <div className="col-span-full"><Button variant="primary" disabled={!cur || !nw || !!pw} onClick={async () => { if (await run(A.changePassword(cur, nw), 'Password changed — other devices were signed out')) { setCur(''); setNw(''); } }}>Change password</Button></div>
    </Panel>
    <SecurityPanels sessions={sessions} totpEnabled={account.totpEnabled} />
    {module === 'crm' && me.crmAccess && <CalendarPanel has={account.hasCalendar} />}
    {module === 'crm' && me.crmAccess && <MyMailSync on={myMail.on} syncedAt={myMail.at} />}
    {module === 'desk' && (me.deskRole === 'admin' || me.deskRole === 'agent') && <SignaturePanel value={account.signature} />}
    <p className="text-xs text-muted">Theme (system, light or dark) is in the top bar and is saved to your account. Need another account? Ask an admin. <Link className="text-accent hover:underline" href={module === 'desk' ? '/desk' : '/'}>Back to Home</Link></p>
  </div>;
}
