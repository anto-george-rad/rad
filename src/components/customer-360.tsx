'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, HeartPulse, KeyRound, Mail, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Chip, ConfirmButton, Field, IconButton, Input, Modal, Panel, Segmented, Select, Textarea, useToast } from './ui';
import { RecordPicker } from './record-picker';
import { useApp } from './app-context';
import * as X from '@/lib/crm-ext-actions';
import { cn, daysBetweenISO, fmtDate, fmtMoney, timeAgo, todayISO } from '@/lib/utils';

export type LicenceRow = { id: string; companyId: string; companyName?: string; contactId: string | null; productId: string | null; productName: string; vendor: string | null; seats: number; hasKey: boolean;
  startDate: string | null; endDate: string | null; value: number | null; currency: string; status: string; dealId: string | null; renewalDealId: string | null; notes: string | null };
export type HealthView = { score: number; label: string; reasons: string[] };
export type ContractView = { id: string; name: string; tier: string; startDate: string; endDate: string; hoursIncluded: number | null; hours: number; usedPct: number | null };
export type EmailRow = { id: string; userId: string; direction: 'in' | 'out'; subject: string; snippet: string | null; fromEmail: string | null; toEmails: string | null; webLink: string | null; at: Date; dealId: string | null };

const tone = (label: string) => (label === 'Healthy' ? 'good' : label === 'Watch' ? 'warn' : 'bad') as 'good' | 'warn' | 'bad';
export function HealthChip({ h }: { h: HealthView | undefined }) {
  if (!h) return null;
  return <Chip tone={tone(h.label)}><HeartPulse size={12} className="mr-1 inline" />{h.score} · {h.label}</Chip>;
}
/** The account at a glance: health score with its reasons. */
export function HealthCard({ h }: { h: HealthView }) {
  return <div className={cn('flex flex-col gap-2 rounded-2xl border p-4', h.label === 'Healthy' ? 'border-good/30 bg-good-soft' : h.label === 'Watch' ? 'border-warn/30 bg-warn-soft' : 'border-bad/30 bg-bad-soft')}>
    <div className="flex items-center gap-3"><HeartPulse size={20} className={h.label === 'Healthy' ? 'text-good' : h.label === 'Watch' ? 'text-warn' : 'text-bad'} />
      <div><div className="eyebrow">Customer health</div><div className="font-display text-[22px] font-bold leading-none">{h.score}<span className="text-[13px] font-semibold text-muted">/100 · {h.label}</span></div></div>
      <div className="ml-2 h-2 flex-1 overflow-hidden rounded-full bg-surface/70"><div className={cn('h-full rounded-full', h.label === 'Healthy' ? 'bg-good' : h.label === 'Watch' ? 'bg-warn' : 'bg-bad')} style={{ width: `${h.score}%` }} /></div></div>
    {h.reasons.length > 0 ? <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-8 text-[12.5px] text-ink/80">{h.reasons.map((r) => <li key={r} className="list-disc">{r}</li>)}</ul>
      : <p className="pl-8 text-[12.5px] text-muted">No warning signs: recent contact, no open escalations, and licences covered.</p>}
  </div>;
}

/* ---------------- licences ---------------- */
const statusTone = (l: LicenceRow) => { if (l.status === 'renewed') return 'outline'; if (l.status !== 'active') return 'neutral'; const d = l.endDate ? daysBetweenISO(todayISO(), l.endDate) : 999; return d < 0 ? 'bad' : d <= 30 ? 'bad' : d <= 90 ? 'warn' : 'good'; };
const endsLabel = (l: LicenceRow) => { if (!l.endDate) return 'No end date'; const d = daysBetweenISO(todayISO(), l.endDate); return l.status !== 'active' ? fmtDate(l.endDate) : d < 0 ? `Expired ${fmtDate(l.endDate)}` : d === 0 ? 'Ends today' : `${fmtDate(l.endDate)} · ${d} days`; };
export function LicencesPanel({ companyId, items, canEdit }: { companyId: string; items: LicenceRow[]; canEdit: boolean }) {
  const [edit, setEdit] = useState<Partial<LicenceRow> | null>(null);
  const active = items.filter((l) => l.status === 'active');
  return <Panel title={<span className="inline-flex items-center gap-2"><KeyRound size={15} className="text-accent" />Licences</span>} count={`${active.length} active`}
    actions={canEdit && <Button size="sm" variant="soft" onClick={() => setEdit({ companyId, seats: 1, currency: 'AED', status: 'active' })}><Plus size={14} />Add</Button>}>
    {items.length ? <LicenceTable rows={items} onEdit={canEdit ? setEdit : undefined} /> : <p className="px-5 py-6 text-[13px] text-muted">No licences recorded. They’re added automatically when a deal with subscription products is won, or add them here.</p>}
    {edit && <LicenceModal init={edit} onClose={() => setEdit(null)} />}
  </Panel>;
}
export function LicenceTable({ rows, onEdit, showCompany }: { rows: LicenceRow[]; onEdit?: (l: LicenceRow) => void; showCompany?: boolean }) {
  return <div className="overflow-x-auto"><table className="tbl min-w-[620px]"><thead><tr>{showCompany && <th>Customer</th>}<th>Product</th><th className="text-right">Seats</th><th>Ends</th><th className="text-right">Value</th><th>Renewal</th><th /></tr></thead>
    <tbody>{rows.map((l) => <tr key={l.id} className={onEdit ? 'cursor-pointer' : ''} onClick={(e) => { if (onEdit && !(e.target as HTMLElement).closest('a,button')) onEdit(l); }}>
      {showCompany && <td className="font-semibold"><Link href={`/companies/${l.companyId}`} className="hover:text-accent">{l.companyName}</Link></td>}
      <td><div className="font-medium">{l.productName}</div>{l.vendor && <div className="text-xs text-muted">{l.vendor}</div>}</td><td className="num text-right">{l.seats}</td>
      <td><Chip tone={statusTone(l)}>{l.status === 'active' ? endsLabel(l) : `${l.status[0].toUpperCase()}${l.status.slice(1)}`}</Chip></td>
      <td className="num text-right text-[13px]">{l.value != null ? fmtMoney(l.value, l.currency) : '—'}</td>
      <td className="text-[13px]">{l.renewalDealId ? <Link href={`/deals/${l.renewalDealId}`} className="font-semibold text-accent hover:underline">Renewal deal</Link> : <span className="text-faint">—</span>}</td>
      <td className="text-right">{l.hasKey && <KeyButton id={l.id} />}</td></tr>)}</tbody></table></div>;
}
function KeyButton({ id }: { id: string }) {
  const toast = useToast(); const [key, setKey] = useState<string | null>(null);
  return key ? <span className="num select-all rounded bg-sunken px-2 py-0.5 text-[12px]">{key}</span>
    : <IconButton label="Show licence key (logged)" onClick={async () => { const r = await X.revealLicenceKey(id); if (!r.ok) return toast(r.error, 'bad'); setKey(r.key); }}><Eye size={14} /></IconButton>;
}
export function LicenceModal({ init, onClose }: { init: Partial<LicenceRow>; onClose: () => void }) {
  const { products, settings } = useApp(); const toast = useToast(); const router = useRouter();
  const [v, setV] = useState({ companyId: init.companyId || '', productId: init.productId || '', productName: init.productName || '', vendor: init.vendor || '', seats: String(init.seats ?? 1), key: '', startDate: init.startDate || todayISO(),
    endDate: init.endDate || '', value: init.value != null ? String(init.value) : '', currency: init.currency || 'AED', status: init.status || 'active', notes: init.notes || '' });
  const save = async () => {
    const r = await X.saveLicence({ id: init.id, companyId: v.companyId, productId: v.productId || null, productName: v.productName, vendor: v.vendor, seats: v.seats, licenceKey: v.key ? v.key : init.id ? undefined : '', startDate: v.startDate, endDate: v.endDate, value: v.value, currency: v.currency, status: v.status as 'active', notes: v.notes });
    if (!r.ok) return toast(r.error, 'bad'); toast('Licence saved'); onClose(); router.refresh();
  };
  return <Modal open wide onClose={onClose} title={init.id ? 'Edit licence' : 'Add licence'} footer={<>{init.id && <ConfirmButton variant="danger" confirmText="Delete licence?" onConfirm={async () => { const r = await X.deleteLicence(init.id!); if (!r.ok) return toast(r.error, 'bad'); onClose(); router.refresh(); }}><Trash2 size={14} />Delete</ConfirmButton>}<span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
    <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
      {!init.companyId && <Field label="Customer" required className="col-span-full"><RecordPicker type="company" value={v.companyId} onChange={(id) => setV({ ...v, companyId: id })} ariaLabel="Customer" /></Field>}
      <Field label="Product"><Select value={v.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); setV({ ...v, productId: e.target.value, productName: p?.name || v.productName, vendor: v.vendor || p?.category || '' }); }}><option value="">Not in the catalogue</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Licence name" required><Input value={v.productName} onChange={(e) => setV({ ...v, productName: e.target.value })} placeholder="e.g. Endpoint Protection Enterprise" /></Field>
      <Field label="Vendor"><Input value={v.vendor} onChange={(e) => setV({ ...v, vendor: e.target.value })} /></Field>
      <Field label="Seats" required><Input type="number" min={1} value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} /></Field>
      <Field label="Start date"><Input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></Field>
      <Field label="End date" hint={`A renewal deal opens ${settings.licenceRenewalDays} days before`}><Input type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
      <Field label="Annual value"><div className="flex gap-2"><Select className="w-24" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} aria-label="Currency">{Object.keys(settings.currencies).map((c) => <option key={c}>{c}</option>)}</Select><Input type="number" min={0} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></div></Field>
      <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as 'active' })}><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="renewed">Renewed</option></Select></Field>
      <Field label="Licence key" hint={init.hasKey ? 'A key is stored (encrypted). Type a new one to replace it.' : 'Stored encrypted; viewing it is logged'} className="col-span-full"><Input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} autoComplete="off" className="num" /></Field>
      <Field label="Notes" className="col-span-full"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
    </div></Modal>;
}

/** Licence register page: every customer licence, filtered by when it ends. */
export function LicenceRegister({ rows }: { rows: LicenceRow[] }) {
  const [f, setF] = useState<'all' | '30' | '90' | 'expired' | 'renewal'>('90'); const [q, setQ] = useState(''); const [edit, setEdit] = useState<Partial<LicenceRow> | null>(null);
  const today = todayISO(); const { settings } = useApp();
  const list = useMemo(() => rows.filter((l) => {
    const d = l.endDate ? daysBetweenISO(today, l.endDate) : 9999;
    if (f === '30' && !(l.status === 'active' && d <= 30)) return false; if (f === '90' && !(l.status === 'active' && d <= 90)) return false;
    if (f === 'expired' && !(l.status === 'expired' || (l.status === 'active' && d < 0))) return false; if (f === 'renewal' && !(l.status === 'active' && l.renewalDealId)) return false;
    return !q || `${l.companyName} ${l.productName} ${l.vendor}`.toLowerCase().includes(q.toLowerCase());
  }).sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999')), [rows, f, q, today]);
  const value = list.filter((l) => l.status === 'active').reduce((a, l) => a + (l.value || 0) * (settings.currencies[l.currency] || 1), 0);
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><p className="eyebrow">CRM</p><h1 className="font-display text-[28px] font-bold tracking-tight">Licence register</h1>
      <p className="text-[13.5px] text-muted">Every licence your customers hold. Renewal deals open automatically {settings.licenceRenewalDays} days before a licence ends.</p></div>
      <Button variant="primary" onClick={() => setEdit({ seats: 1, currency: 'AED', status: 'active' })}><Plus size={15} />Licence</Button></div>
    <div className="flex flex-wrap items-center gap-2"><Segmented value={f} onChange={setF} options={[['90', 'Ending in 90 days'], ['30', 'Ending in 30 days'], ['expired', 'Expired'], ['renewal', 'Renewal in progress'], ['all', 'All']]} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or product" className="h-9 w-56" aria-label="Search licences" /><span className="flex-1" />
      <span className="text-[13px] text-muted">{list.length} licence{list.length === 1 ? '' : 's'} · {fmtMoney(value)} a year</span></div>
    <div className="panel">{list.length ? <LicenceTable rows={list} showCompany onEdit={setEdit} /> : <p className="px-5 py-10 text-center text-[13px] text-muted">No licences match.</p>}</div>
    {edit && <LicenceModal init={edit} onClose={() => setEdit(null)} />}
  </div>;
}

/* ---------------- support summary on the customer page ---------------- */
export function SupportSummary({ contracts, ratings, openTickets }: { contracts: ContractView[]; ratings: { good: number; ok: number; bad: number }; openTickets: number }) {
  const rated = ratings.good + ratings.ok + ratings.bad; const today = todayISO();
  return <Panel title={<span className="inline-flex items-center gap-2"><ShieldCheck size={15} className="text-accent" />Support</span>} bodyClass="grid gap-3 p-5 text-[13.5px]">
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-sunken p-2.5"><div className="font-display text-xl font-bold">{openTickets}</div><div className="text-xs text-muted">open tickets</div></div>
      <div className="rounded-xl bg-sunken p-2.5"><div className="font-display text-xl font-bold">{rated ? `${Math.round((ratings.good / rated) * 100)}%` : '—'}</div><div className="text-xs text-muted">happy (90 days)</div></div>
      <div className="rounded-xl bg-sunken p-2.5"><div className="font-display text-xl font-bold">{rated}</div><div className="text-xs text-muted">ratings</div></div></div>
    {contracts.length ? contracts.map((c) => { const active = c.startDate <= today && today <= c.endDate; return <div key={c.id} className="rounded-xl border border-line p-3">
      <div className="flex items-center gap-2"><b>{c.name}</b><Chip tone={active ? 'good' : 'neutral'}>{active ? c.tier : 'Ended'}</Chip></div>
      <div className="text-xs text-muted">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}{c.hoursIncluded ? ` · ${c.hours} of ${c.hoursIncluded} hours used` : c.hours ? ` · ${c.hours} hours logged` : ''}</div>
      {c.usedPct != null && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken"><div className={cn('h-full rounded-full', c.usedPct >= 100 ? 'bg-bad' : c.usedPct >= 80 ? 'bg-warn' : 'bg-good')} style={{ width: `${Math.min(100, c.usedPct)}%` }} /></div>}
    </div>; }) : <p className="text-muted">No support contract. Tickets use the standard SLA.</p>}
  </Panel>;
}

/* ---------------- synced emails ---------------- */
export function EmailsPanel({ items }: { items: EmailRow[] }) {
  const { users, me, settings } = useApp(); const toast = useToast(); const router = useRouter(); const [all, setAll] = useState(false);
  if (!settings.outlookEnabled && !items.length) return null;
  const list = all ? items : items.slice(0, 6);
  return <Panel title={<span className="inline-flex items-center gap-2"><Mail size={15} className="text-accent" />Emails</span>} count={items.length}
    actions={items.length > 6 && <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show all'}</Button>}>
    {list.length ? list.map((e) => <div key={e.id} className="group flex gap-3 border-b border-line px-5 py-3 last:border-0">
      {e.direction === 'out' ? <ArrowUpRight size={16} className="mt-0.5 flex-none text-accent" /> : <ArrowDownLeft size={16} className="mt-0.5 flex-none text-good" />}
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-semibold">{e.webLink ? <a href={e.webLink} target="_blank" rel="noopener" className="hover:text-accent">{e.subject}</a> : e.subject}</span><span className="ml-auto flex-none text-xs text-muted">{timeAgo(e.at)}</span></div>
        <div className="text-xs text-muted">{e.direction === 'out' ? `${users.find((u) => u.id === e.userId)?.name || 'Rep'} → ${e.toEmails || ''}` : `${e.fromEmail} → ${users.find((u) => u.id === e.userId)?.name || 'rep'}`}</div>
        {e.snippet && <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink/75">{e.snippet}</p>}</div>
      {(e.userId === me.id || me.role === 'admin') && <ConfirmButton size="sm" variant="ghost" confirmText="Remove?" onConfirm={async () => { const r = await X.deleteEmailLog(e.id); if (!r.ok) return toast(r.error, 'bad'); router.refresh(); }}><Trash2 size={13} /></ConfirmButton>}
    </div>) : <p className="px-5 py-6 text-[13px] text-muted">No synced emails yet. Turn on Outlook sync under My account.</p>}
  </Panel>;
}
