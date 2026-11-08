'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FileSignature, Plus, Trash2 } from 'lucide-react';
import type { SupportContract } from '@/db/schema';
import { Button, Chip, ConfirmButton, Field, Input, Kpi, Modal, Segmented, Select, Textarea, useToast } from '../ui';
import { RecordPicker } from '../record-picker';
import { useApp } from '../app-context';
import * as DX from '@/lib/desk-ext-actions';
import { cn, daysBetweenISO, fmtDate, fmtMoney, todayISO } from '@/lib/utils';

type Row = SupportContract & { companyName: string; tickets: number; hours: number; cost: number; usedPct: number | null; margin: number | null; profit: number | null };
const state = (c: Row) => { const t = todayISO(); if (c.endDate < t) return 'expired'; if (c.startDate > t) return 'future'; return daysBetweenISO(t, c.endDate) <= 60 ? 'ending' : 'active'; };
export function ContractsView({ rows, policies, costPerHour, focus }: { rows: Row[]; policies: { id: string; name: string }[]; costPerHour: number; focus: string | null }) {
  const { me, settings } = useApp(); const [f, setF] = useState<'active' | 'ending' | 'expired' | 'all'>('active'); const [edit, setEdit] = useState<Partial<Row> | null>(() => rows.find((r) => r.id === focus) || null);
  const admin = me.deskRole === 'admin';
  const list = useMemo(() => rows.filter((r) => f === 'all' || (f === 'active' ? ['active', 'ending'].includes(state(r)) : state(r) === f)), [rows, f]);
  const act = rows.filter((r) => ['active', 'ending'].includes(state(r)));
  const value = act.reduce((a, r) => a + (r.value || 0) * (settings.currencies[r.currency] || 1), 0); const cost = act.reduce((a, r) => a + r.cost, 0);
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><p className="eyebrow">Helpdesk</p><h1 className="flex items-center gap-2 font-display text-[28px] font-bold tracking-tight"><FileSignature size={24} className="text-accent" />Support contracts</h1>
      <p className="text-[13.5px] text-muted">A contract’s tier picks the SLA for the customer’s tickets; logged time is drawn from its included hours. Profit uses AED {costPerHour} per support hour.</p></div>
      {admin && <Button variant="primary" onClick={() => setEdit({ tier: settings.contractTiers[0] || 'Standard', startDate: todayISO(), currency: 'AED', productIds: [] })}><Plus size={15} />Contract</Button>}</div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Active contracts" value={act.length} sub={`${act.filter((r) => state(r) === 'ending').length} ending within 60 days`} />
      <Kpi label="Contract value" value={fmtMoney(value)} sub="active contracts" />
      <Kpi label="Support cost" value={fmtMoney(cost)} sub="hours logged × hourly cost" />
      <Kpi label="Margin" value={value ? `${Math.round(((value - cost) / value) * 100)}%` : '—'} tone={value && (value - cost) / value < 0.2 ? 'bad' : 'good'} sub={fmtMoney(value - cost)} />
    </div>
    <Segmented value={f} onChange={setF} options={[['active', 'Active'], ['ending', 'Ending soon'], ['expired', 'Expired'], ['all', 'All']]} />
    <div className="panel overflow-x-auto"><table className="tbl min-w-[900px]"><thead><tr><th>Customer</th><th>Contract</th><th>Tier</th><th>Period</th><th>Hours used</th><th className="text-right">Tickets</th><th className="text-right">Value</th><th className="text-right">Cost</th><th className="text-right">Margin</th></tr></thead>
      <tbody>{list.map((r) => { const st = state(r); return <tr key={r.id} className={admin ? 'cursor-pointer' : ''} onClick={(e) => { if (admin && !(e.target as HTMLElement).closest('a')) setEdit(r); }}>
        <td className="font-semibold"><Link href={`/desk/customers/c-${r.companyId}`} className="hover:text-accent">{r.companyName}</Link></td><td>{r.name}</td><td><Chip tone="accent">{r.tier}</Chip></td>
        <td className="whitespace-nowrap text-[13px]">{fmtDate(r.startDate)} – {fmtDate(r.endDate)} {st === 'ending' && <Chip tone="warn">Ends soon</Chip>}{st === 'expired' && <Chip>Expired</Chip>}{st === 'future' && <Chip tone="outline">Starts later</Chip>}</td>
        <td className="min-w-[150px]"><div className="num text-[12.5px]">{r.hours} h{r.hoursIncluded ? ` of ${r.hoursIncluded}` : ''}</div>{r.usedPct != null && <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className={cn('h-full rounded-full', r.usedPct >= 100 ? 'bg-bad' : r.usedPct >= settings.lowHoursPct ? 'bg-warn' : 'bg-good')} style={{ width: `${Math.min(100, r.usedPct)}%` }} /></div>}</td>
        <td className="num text-right">{r.tickets}</td><td className="num text-right">{r.value != null ? fmtMoney(r.value, r.currency) : '—'}</td><td className="num text-right">{fmtMoney(r.cost)}</td>
        <td className={cn('num text-right font-semibold', r.margin != null && (r.margin < 0 ? 'text-bad' : r.margin < 20 ? 'text-warn' : 'text-good'))}>{r.margin != null ? `${r.margin}%` : '—'}</td></tr>; })}
        {!list.length && <tr><td colSpan={9} className="py-10 text-center text-muted">No contracts here.</td></tr>}</tbody></table></div>
    {edit && <ContractModal init={edit} policies={policies} onClose={() => setEdit(null)} />}
  </div>;
}
export function ContractModal({ init, policies, onClose }: { init: Partial<Row>; policies: { id: string; name: string }[]; onClose: () => void }) {
  const { settings, products } = useApp(); const toast = useToast(); const router = useRouter();
  const [v, setV] = useState({ companyId: init.companyId || '', name: init.name || '', tier: init.tier || 'Standard', slaPolicyId: init.slaPolicyId || '', hours: init.hoursIncluded != null ? String(init.hoursIncluded) : '', startDate: init.startDate || todayISO(),
    endDate: init.endDate || '', value: init.value != null ? String(init.value) : '', currency: init.currency || 'AED', productIds: init.productIds || [], notes: init.notes || '' });
  return <Modal open wide onClose={onClose} title={init.id ? 'Edit support contract' : 'New support contract'} footer={<>{init.id && <ConfirmButton variant="danger" confirmText="Delete contract?" onConfirm={async () => { const r = await DX.deleteContract(init.id!); if (!r.ok) return toast(r.error, 'bad'); onClose(); router.refresh(); }}><Trash2 size={14} />Delete</ConfirmButton>}<span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancel</Button>
    <Button variant="primary" onClick={async () => { const r = await DX.saveContract({ id: init.id, companyId: v.companyId, name: v.name, tier: v.tier, slaPolicyId: v.slaPolicyId || null, hoursIncluded: v.hours, startDate: v.startDate, endDate: v.endDate, value: v.value, currency: v.currency, productIds: v.productIds, notes: v.notes }); if (!r.ok) return toast(r.error, 'bad'); toast('Contract saved'); onClose(); router.refresh(); }}>Save</Button></>}>
    <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
      <Field label="Customer" required className="col-span-full"><RecordPicker type="company" value={v.companyId} onChange={(id) => setV({ ...v, companyId: id })} ariaLabel="Customer" /></Field>
      <Field label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Premium support 2027" /></Field>
      <Field label="Tier" hint="Picks the SLA policy with the same tier"><Select value={v.tier} onChange={(e) => setV({ ...v, tier: e.target.value })}>{settings.contractTiers.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="SLA policy" hint="Optional: overrides the tier"><Select value={v.slaPolicyId} onChange={(e) => setV({ ...v, slaPolicyId: e.target.value })}><option value="">By tier</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Included hours" hint="Empty = unlimited"><Input type="number" min={0} value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} /></Field>
      <Field label="Starts" required><Input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></Field>
      <Field label="Ends" required><Input type="date" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
      <Field label="Contract value"><div className="flex gap-2"><Select className="w-24" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} aria-label="Currency">{Object.keys(settings.currencies).map((c) => <option key={c}>{c}</option>)}</Select><Input type="number" min={0} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></div></Field>
      <Field label="Covered products" hint="Empty = all products" className="col-span-full"><div className="flex max-h-36 flex-wrap gap-x-4 gap-y-2 overflow-y-auto rounded-xl border border-line p-3">{products.filter((p) => p.active).map((p) => <label key={p.id} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={v.productIds.includes(p.id)} onChange={(e) => setV({ ...v, productIds: e.target.checked ? [...v.productIds, p.id] : v.productIds.filter((x) => x !== p.id) })} className="h-4 w-4 accent-[rgb(var(--accent))]" />{p.name}</label>)}</div></Field>
      <Field label="Notes" className="col-span-full"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
    </div></Modal>;
}
