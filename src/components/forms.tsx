'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { RecordPicker, resolveRecords } from './record-picker';
import * as D from '@/lib/desk-actions';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Modal, Select, Textarea, useToast } from './ui';
import { useApp } from './app-context';
import * as A from '@/lib/actions';
import { contractEndFrom, fullName, tagsOf, todayISO } from '@/lib/utils';
import { FORECAST_CATEGORIES, PRIORITIES, TICKET_CHANNELS, CHANNEL_LABEL, ACCOUNT_TYPES, BILLING_TYPES, BUYING_ROLES, DEAL_TYPES, DISQUAL_REASONS, EMIRATES, EMPLOYEE_RANGES, LANGUAGES, OUTCOMES, PAYMENT_TERMS, PRODUCT_HANDLING_TYPES, SECTORS, TIERS, TIMELINES, ZONES } from '@/lib/options';
import type { CustomField } from '@/db/schema';

export type FormType = 'lead' | 'deal' | 'contact' | 'company' | 'activity' | 'product' | 'ticket';
type Open = (type: FormType, initial?: Record<string, unknown>) => void;
const Ctx = createContext<Open>(() => {});
export const useForms = () => useContext(Ctx);

export function FormHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ type: FormType; initial: Record<string, unknown>; key: number } | null>(null);
  const open = useCallback<Open>((type, initial = {}) => setState({ type, initial, key: Date.now() }), []);
  const close = () => setState(null);
  const F = state && { lead: LeadForm, deal: DealForm, contact: ContactForm, company: CompanyForm, activity: ActivityForm, product: ProductForm, ticket: TicketForm }[state.type];
  return <Ctx.Provider value={open}>{children}{state && F && <F key={state.key} initial={state.initial} onClose={close} />}</Ctx.Provider>;
}

type FP = { initial: Record<string, unknown>; onClose: () => void };
function useSubmit(onClose: () => void) {
  const toast = useToast(); const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const run = async (fn: () => Promise<A.Result<{ id?: string; ran?: string[] }>>, okText: string, go?: (id: string) => string) => {
    setBusy(true); setError('');
    const r = await fn(); setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast(okText); r.ran?.forEach((n) => toast(`Automation ran: ${n}`));
    onClose(); if (go && r.id) router.push(go(r.id)); else router.refresh();
  };
  return { busy, error, run };
}
function Footer({ busy, error, onClose, label }: { busy: boolean; error: string; onClose: () => void; label: string }) {
  return <>{error && <span className="mr-auto text-[13px] font-medium text-bad">{error}</span>}<Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="rec-form" disabled={busy}>{busy ? 'Saving…' : label}</Button></>;
}
function useObj<T extends Record<string, unknown>>(init: T) {
  const [v, setV] = useState<T>(init);
  const set = (k: keyof T) => (e: { target: { value: string; type?: string; checked?: boolean } }) => setV((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return [v, set, setV] as const;
}
export function CustomInputs({ fields, values, onChange }: { fields: CustomField[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  if (!fields.length) return null;
  return <>
    <div className="col-span-full mt-1 border-t border-line pt-3 eyebrow">Custom fields</div>
    {fields.map((f) => {
      const val = values[f.id]; const set = (x: unknown) => onChange({ ...values, [f.id]: x });
      if (f.type === 'checkbox') return <label key={f.id} className="flex items-center gap-2 text-[13px] font-medium"><input type="checkbox" checked={!!val} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />{f.label}{f.required && <span className="text-bad">*</span>}</label>;
      return <Field key={f.id} label={f.label} required={f.required} className={f.type === 'textarea' ? 'col-span-full' : ''}>
        {f.type === 'select' ? <Select value={String(val ?? '')} onChange={(e) => set(e.target.value)}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</Select>
          : f.type === 'textarea' ? <Textarea value={String(val ?? '')} onChange={(e) => set(e.target.value)} />
            : <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : 'text'} value={String(val ?? '')} onChange={(e) => set(e.target.value)} />}
      </Field>;
    })}
  </>;
}
const Grid = ({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) =>
  <form id="rec-form" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="grid grid-cols-1 gap-x-4 gap-y-3.5 pb-2 sm:grid-cols-2">{children}</form>;

function OwnerSelect({ value, onChange, teamOnly }: { value: string; onChange: (e: { target: { value: string } }) => void; teamOnly?: boolean }) {
  const { users, team } = useApp();
  const list = users.filter((u) => u.active && (!teamOnly || !team || team.includes(u.id)));
  return <Field label={teamOnly ? 'Assigned to' : 'Owner'}><Select value={value} onChange={onChange}>{list.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>;
}

const Section = ({ children }: { children: ReactNode }) => <div className="col-span-full mt-1 border-t border-line pt-3 eyebrow">{children}</div>;
const Opts = ({ list, blank = true }: { list: readonly string[]; blank?: boolean }) => <>{blank && <option value="">—</option>}{list.map((x) => <option key={x}>{x}</option>)}</>;
const Check = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (e: { target: { value: string; type?: string; checked?: boolean } }) => void; hint?: string }) =>
  <label className="flex items-start gap-2 text-[13px] font-medium"><input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" /><span>{label}{hint && <span className="block text-xs font-normal text-faint">{hint}</span>}</span></label>;
const s_ = (v: unknown) => String(v ?? '');

/* ---------------- lead ---------------- */
function LeadForm({ initial, onClose }: FP) {
  const { me, settings, customFields, products } = useApp(); const isNew = !initial.id; const router = useRouter();
  const [v, set] = useObj({ firstName: '', lastName: '', companyName: '', jobTitle: '', email: '', phone: '', source: '', status: 'New', ownerId: me.id, notes: '', consent: false, doNotContact: false, ...initial, tags: tagsOf(initial.tags).join(', ') } as Record<string, unknown>);
  const [custom, setCustom] = useState<Record<string, unknown>>((initial.custom as Record<string, unknown>) || {});
  const { busy, error, run } = useSubmit(onClose);
  const [dup, setDup] = useState<{ id: string; msg: string } | null>(null);
  const save = (allow = false) => run(async () => {
    const r = await A.saveLead({ ...(v as object), custom, allowContactDuplicate: allow } as never);
    if (!r.ok && r.error.startsWith('DUP_CONTACT:')) { const [, id, ...m] = r.error.split(':'); setDup({ id, msg: m.join(':') }); return { ok: false as const, error: 'Possible duplicate — see below.' }; }
    return r;
  }, isNew ? 'Lead added' : 'Saved', isNew ? (id) => `/leads/${id}` : undefined);
  return <Modal open onClose={onClose} title={isNew ? 'New lead' : 'Edit lead'} footer={<Footer busy={busy} error={error} onClose={onClose} label={isNew ? 'Add lead' : 'Save'} />}>
    <Grid onSubmit={() => { setDup(null); save(); }}>
      <Field label="First name" required><Input autoFocus value={s_(v.firstName)} onChange={set('firstName')} /></Field>
      <Field label="Last name"><Input value={s_(v.lastName)} onChange={set('lastName')} /></Field>
      <Field label="Company"><Input value={s_(v.companyName)} onChange={set('companyName')} /></Field>
      <Field label="Job title"><Input value={s_(v.jobTitle)} onChange={set('jobTitle')} /></Field>
      <Field label="Email"><Input type="email" value={s_(v.email)} onChange={set('email')} /></Field>
      <Field label="Phone" hint="UAE numbers are saved as +971…"><Input type="tel" value={s_(v.phone)} onChange={set('phone')} placeholder="050 123 4567" /></Field>
      {dup && <div className="col-span-full rounded-xl border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{dup.msg}
        <div className="mt-2 flex gap-2"><Button type="button" size="sm" onClick={() => { onClose(); router.push(`/contacts/${dup.id}`); }}>Open contact</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setDup(null); save(true); }}>Add lead anyway</Button></div></div>}
      <Field label="Source"><Select value={s_(v.source)} onChange={set('source')}><Opts list={settings.leadSources} /></Select></Field>
      <Field label="Campaign"><Input value={s_(v.campaign)} onChange={set('campaign')} placeholder="e.g. GITEX 2026" /></Field>
      <Field label="Status"><Select value={s_(v.status)} onChange={set('status')}>{['New', 'Contacted', 'Qualified', 'Unqualified'].concat(v.status === 'Converted' ? ['Converted'] : []).map((x) => <option key={x}>{x}</option>)}</Select></Field>
      {v.status === 'Unqualified' ? <Field label="Why unqualified?" required><Select value={s_(v.disqualReason)} onChange={set('disqualReason')}><Opts list={DISQUAL_REASONS} /></Select></Field> : <OwnerSelect value={s_(v.ownerId)} onChange={set('ownerId')} />}
      {v.status === 'Unqualified' && <OwnerSelect value={s_(v.ownerId)} onChange={set('ownerId')} />}
      <Field label="Tags" hint="Comma separated"><Input value={s_(v.tags)} onChange={set('tags')} /></Field>
      <Section>Qualification</Section>
      <Field label="Industry"><Input value={s_(v.industry)} onChange={set('industry')} /></Field>
      <Field label="Emirate"><Select value={s_(v.emirate)} onChange={set('emirate')}><Opts list={EMIRATES} /></Select></Field>
      <Field label="Website"><Input value={s_(v.website)} onChange={set('website')} placeholder="example.ae" /></Field>
      <Field label="Company size"><Select value={s_(v.companySize)} onChange={set('companySize')}><Opts list={EMPLOYEE_RANGES} /></Select></Field>
      <Field label="Budget (AED)"><Input type="number" min={0} value={s_(v.budget)} onChange={set('budget')} /></Field>
      <Field label="Timeline"><Select value={s_(v.timeline)} onChange={set('timeline')}><Opts list={TIMELINES} /></Select></Field>
      <Field label="Product of interest" className="col-span-full"><Select value={s_(v.productInterestId)} onChange={set('productInterestId')}><option value="">—</option>{products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Section>Consent</Section>
      <Check label="Agreed to be contacted" hint="Recorded with today’s date" checked={!!v.consent} onChange={set('consent')} />
      <Check label="Do not contact" hint="Shows a warning on the record" checked={!!v.doNotContact} onChange={set('doNotContact')} />
      <Field label="Notes" className="col-span-full"><Textarea value={s_(v.notes)} onChange={set('notes')} /></Field>
      <CustomInputs fields={customFields.filter((f) => f.module === 'lead')} values={custom} onChange={setCustom} />
    </Grid>
  </Modal>;
}

/* ---------------- products a distributor contact handles ---------------- */
export function ProductPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { products } = useApp(); const [q, setQ] = useState('');
  const list = products.filter((p) => (p.active || value.includes(p.id)) && (!q || `${p.name} ${p.category || ''} ${p.sku || ''}`.toLowerCase().includes(q.toLowerCase())));
  const cats = Array.from(new Set(list.map((p) => p.category || 'Other')));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return <div className="rounded-xl border border-line">
    <div className="flex items-center gap-2 border-b border-line px-3 py-2"><Input aria-label="Filter products" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter products" className="!h-8 flex-1" /><span className="num whitespace-nowrap text-xs text-muted">{value.length} selected</span>
      {list.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(Array.from(new Set([...value, ...list.map((p) => p.id)])))}>All</Button>}{value.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>None</Button>}</div>
    <div className="max-h-[200px] overflow-y-auto p-2">
      {!products.length ? <p className="px-1 py-2 text-xs text-muted">Add products in Settings → Products first.</p> : cats.map((c) => <div key={c} className="mb-1.5">
        <div className="px-1 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{c}</div>
        <div className="flex flex-wrap gap-1.5">{list.filter((p) => (p.category || 'Other') === c).map((p) => { const on = value.includes(p.id);
          return <button type="button" key={p.id} aria-pressed={on} onClick={() => toggle(p.id)} className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'}`}>{on ? '✓ ' : ''}{p.name}</button>; })}</div>
      </div>)}
    </div>
  </div>;
}

/* ---------------- contact ---------------- */
function ContactForm({ initial, onClose }: FP) {
  const { me, settings, customFields } = useApp(); const isNew = !initial.id;
  const [coType, setCoType] = useState<{ name: string; type: string } | null>(null);
  useEffect(() => { if (initial.companyId) resolveRecords('company', [String(initial.companyId)]).then((h) => h[0] && setCoType({ name: h[0].label, type: String(h[0].extra?.accountType || '') })); }, [initial.companyId]);
  const [v, set, setV] = useObj({ firstName: '', lastName: '', jobTitle: '', companyId: '', email: '', phone: '', mobile: '', whatsapp: '', source: '', ownerId: me.id, consent: false, doNotContact: false, ...initial, productIds: (initial.productIds as string[]) || [], tags: tagsOf(initial.tags).join(', ') } as Record<string, unknown>);
  const [custom, setCustom] = useState<Record<string, unknown>>((initial.custom as Record<string, unknown>) || {});
  const { busy, error, run } = useSubmit(onClose);
  const co = v.companyId ? coType : null; const handles = !!co && PRODUCT_HANDLING_TYPES.includes(co.type);
  const router = useRouter(); const [dupPh, setDupPh] = useState<{ id: string; msg: string } | null>(null);
  const savePh = (allow: boolean) => run(async () => {
    const r = await A.saveContact({ ...(v as object), productIds: handles ? v.productIds : [], custom, allowPhoneDuplicate: allow } as never);
    if (!r.ok && r.error.startsWith('DUP_PHONE:')) { const [, id, ...m] = r.error.split(':'); setDupPh({ id, msg: m.join(':') }); return { ok: false as const, error: 'Possible duplicate — see above.' }; }
    return r;
  }, isNew ? 'Contact added' : 'Saved', isNew ? (id) => `/contacts/${id}` : undefined);
  return <Modal open onClose={onClose} title={isNew ? 'New contact' : 'Edit contact'} footer={<Footer busy={busy} error={error} onClose={onClose} label={isNew ? 'Add contact' : 'Save'} />}>
    <Grid onSubmit={() => { setDupPh(null); savePh(false); }}>
      {dupPh && <div className="col-span-full rounded-xl border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{dupPh.msg}
        <div className="mt-2 flex gap-2"><Button type="button" size="sm" onClick={() => { onClose(); router.push(`/contacts/${dupPh.id}`); }}>Open that contact</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setDupPh(null); savePh(true); }}>Save anyway</Button></div></div>}
      <Field label="First name" required><Input autoFocus value={s_(v.firstName)} onChange={set('firstName')} /></Field>
      <Field label="Last name"><Input value={s_(v.lastName)} onChange={set('lastName')} /></Field>
      <Field label="Job title"><Input value={s_(v.jobTitle)} onChange={set('jobTitle')} /></Field>
      <Field label="Company"><RecordPicker type="company" value={s_(v.companyId)} placeholder="Search companies" ariaLabel="Company" onChange={(id, h) => { setV((o) => ({ ...o, companyId: id })); setCoType(h ? { name: h.label, type: String(h.extra?.accountType || '') } : null); }} /></Field>
      {handles && <div className="col-span-full"><div className="mb-1.5 flex items-baseline gap-2"><span className="text-[12.5px] font-semibold">Products handled at {co!.name}</span><span className="text-xs text-faint">Which of your products this person looks after at the distributor</span></div>
        <ProductPicker value={v.productIds as string[]} onChange={(ids) => setV((o) => ({ ...o, productIds: ids }))} /></div>}
      <Field label="Department"><Input value={s_(v.department)} onChange={set('department')} /></Field>
      <Field label="Buying role"><Select value={s_(v.buyingRole)} onChange={set('buyingRole')}><Opts list={BUYING_ROLES} /></Select></Field>
      <Section>Reach</Section>
      <Field label="Email"><Input type="email" value={s_(v.email)} onChange={set('email')} /></Field>
      <Field label="Office phone"><Input type="tel" value={s_(v.phone)} onChange={set('phone')} placeholder="02 123 4567" /></Field>
      <Field label="Mobile"><Input type="tel" value={s_(v.mobile)} onChange={set('mobile')} placeholder="050 123 4567" /></Field>
      <Field label="WhatsApp" hint="Leave blank if same as mobile"><Input type="tel" value={s_(v.whatsapp)} onChange={set('whatsapp')} /></Field>
      <Field label="LinkedIn"><Input value={s_(v.linkedin)} onChange={set('linkedin')} placeholder="linkedin.com/in/…" /></Field>
      <Field label="Preferred language"><Select value={s_(v.language)} onChange={set('language')}><Opts list={LANGUAGES} /></Select></Field>
      <Field label="Birthday"><Input type="date" value={s_(v.birthday)} onChange={set('birthday')} /></Field>
      <Field label="Source"><Select value={s_(v.source)} onChange={set('source')}><Opts list={settings.leadSources} /></Select></Field>
      <Check label="Agreed to be contacted" checked={!!v.consent} onChange={set('consent')} />
      <Check label="Do not contact" checked={!!v.doNotContact} onChange={set('doNotContact')} />
      <OwnerSelect value={s_(v.ownerId)} onChange={set('ownerId')} />
      <Field label="Tags" hint="Comma separated"><Input value={s_(v.tags)} onChange={set('tags')} /></Field>
      <CustomInputs fields={customFields.filter((f) => f.module === 'contact')} values={custom} onChange={setCustom} />
    </Grid>
  </Modal>;
}

/* ---------------- company ---------------- */
function CompanyForm({ initial, onClose }: FP) {
  const { me, customFields } = useApp(); const isNew = !initial.id;
  const [v, set, setV] = useObj({ name: '', industry: '', website: '', phone: '', city: '', country: 'United Arab Emirates', vatTrn: '', accountType: 'Prospect', ownerId: me.id, ...initial } as Record<string, unknown>);
  const [custom, setCustom] = useState<Record<string, unknown>>((initial.custom as Record<string, unknown>) || {});
  const { busy, error, run } = useSubmit(onClose);
  const trn = s_(v.vatTrn).replace(/\s/g, ''); const trnBad = trn !== '' && !/^\d{15}$/.test(trn);
  return <Modal open onClose={onClose} title={isNew ? 'New company' : 'Edit company'} footer={<Footer busy={busy} error={error} onClose={onClose} label={isNew ? 'Add company' : 'Save'} />}>
    <Grid onSubmit={() => run(() => A.saveCompany({ ...(v as object), custom } as never), isNew ? 'Company added' : 'Saved', isNew ? (id) => `/companies/${id}` : undefined)}>
      <Field label="Company name" required className="col-span-full"><Input autoFocus value={s_(v.name)} onChange={set('name')} /></Field>
      <Field label="Account type" hint={PRODUCT_HANDLING_TYPES.includes(s_(v.accountType)) ? 'Contacts here can list the products they handle' : undefined}><Select value={s_(v.accountType)} onChange={set('accountType')}><Opts list={ACCOUNT_TYPES} blank={false} /></Select></Field>
      <Field label="Tier"><Select value={s_(v.tier)} onChange={set('tier')}><Opts list={TIERS} /></Select></Field>
      <Field label="Industry"><Input value={s_(v.industry)} onChange={set('industry')} /></Field>
      <Field label="Sector"><Select value={s_(v.sector)} onChange={set('sector')}><Opts list={SECTORS} /></Select></Field>
      <Field label="Website"><Input value={s_(v.website)} onChange={set('website')} placeholder="example.ae" /></Field>
      <Field label="Phone"><Input type="tel" value={s_(v.phone)} onChange={set('phone')} /></Field>
      <Field label="LinkedIn"><Input value={s_(v.linkedin)} onChange={set('linkedin')} /></Field>
      <Field label="Employees"><Select value={s_(v.employees)} onChange={set('employees')}><Opts list={EMPLOYEE_RANGES} /></Select></Field>
      <Field label="Annual revenue (AED)"><Input type="number" min={0} value={s_(v.annualRevenue)} onChange={set('annualRevenue')} /></Field>
      <Field label="Parent company" hint="For branches and group companies"><RecordPicker type="company" value={s_(v.parentId)} placeholder="None" ariaLabel="Parent company" onChange={(id) => setV((o) => ({ ...o, parentId: id }))} /></Field>
      <Field label="Customer since" hint="Filled automatically on the first won deal"><Input type="date" value={s_(v.customerSince)} onChange={set('customerSince')} /></Field>
      <Section>Location & licence</Section>
      <Field label="Emirate"><Select value={s_(v.emirate)} onChange={set('emirate')}><Opts list={EMIRATES} /></Select></Field>
      <Field label="Mainland / free zone"><Select value={s_(v.zone)} onChange={set('zone')}><Opts list={ZONES} /></Select></Field>
      <Field label="City"><Input value={s_(v.city)} onChange={set('city')} /></Field>
      <Field label="Country"><Input value={s_(v.country)} onChange={set('country')} /></Field>
      <Field label="VAT TRN" hint={trnBad ? 'A UAE TRN has exactly 15 digits' : '15-digit UAE tax registration number'}><Input value={s_(v.vatTrn)} onChange={set('vatTrn')} inputMode="numeric" className={trnBad ? '!border-bad' : ''} aria-invalid={trnBad} /></Field>
      <Field label="Trade licence no."><Input value={s_(v.tradeLicenceNo)} onChange={set('tradeLicenceNo')} /></Field>
      <Field label="Licence expiry" hint="The owner gets a reminder before it expires"><Input type="date" value={s_(v.tradeLicenceExpiry)} onChange={set('tradeLicenceExpiry')} /></Field>
      <OwnerSelect value={s_(v.ownerId)} onChange={set('ownerId')} />
      <CustomInputs fields={customFields.filter((f) => f.module === 'company')} values={custom} onChange={setCustom} />
    </Grid>
  </Modal>;
}

/* ---------------- deal ---------------- */
function DealForm({ initial, onClose }: FP) {
  const { me, pipelines, customFields, settings } = useApp(); const isNew = !initial.id;
  const p0 = pipelines.find((p) => p.id === initial.pipelineId) || pipelines[0];
  const sub0 = p0?.subs.find((s) => s.id === initial.subPipelineId) || p0?.subs[0];
  const [v, set, setV] = useObj({ name: '', pipelineId: p0?.id, subPipelineId: sub0?.id, stageId: sub0?.stages[0]?.id, amount: '', currency: 'AED', companyId: '', contactId: '', closingDate: '', priority: 'Medium', ownerId: me.id, description: '', dealType: 'New business', ...initial, tags: tagsOf(initial.tags).join(', ') } as Record<string, unknown>);
  const [custom, setCustom] = useState<Record<string, unknown>>((initial.custom as Record<string, unknown>) || {});
  const [more, setMore] = useState(!isNew && !!(initial.contractStart || initial.tenderNumber || initial.poNumber || initial.paymentTerms || initial.recurringValue || initial.dealRegNumber));
  const { busy, error, run } = useSubmit(onClose);
  const pipe = pipelines.find((p) => p.id === v.pipelineId); const sub = pipe?.subs.find((s) => s.id === v.subPipelineId) || pipe?.subs[0];
  const cfs = customFields.filter((f) => f.module === 'deal' && (!f.pipelineId || f.pipelineId === v.pipelineId));
  const endHint = !v.contractEnd && v.contractStart && v.termMonths ? contractEndFrom(s_(v.contractStart), +s_(v.termMonths)) : null;
  return <Modal open onClose={onClose} title={isNew ? `New ${pipe?.recordName.toLowerCase() || 'deal'}` : `Edit ${String(initial.name)}`} footer={<Footer busy={busy} error={error} onClose={onClose} label={isNew ? 'Create' : 'Save'} />}>
    <Grid onSubmit={() => run(() => A.saveDeal({ ...(v as object), subPipelineId: sub?.id, custom } as never), isNew ? 'Created' : 'Saved', isNew ? (id) => `/deals/${id}` : undefined)}>
      <Field label="Name" required className="col-span-full"><Input autoFocus value={s_(v.name)} onChange={set('name')} placeholder="e.g. Meridian Bank – SOC rollout" /></Field>
      <Field label="Pipeline"><Select value={s_(v.pipelineId)} onChange={(e) => { const p = pipelines.find((x) => x.id === e.target.value)!; setV((o) => ({ ...o, pipelineId: p.id, subPipelineId: p.subs[0]?.id, stageId: p.subs[0]?.stages[0]?.id })); }}>{pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      {(pipe?.subs.length || 0) > 1 ? <Field label="Sub-pipeline"><Select value={s_(sub?.id)} onChange={(e) => { const x = pipe!.subs.find((y) => y.id === e.target.value)!; setV((o) => ({ ...o, subPipelineId: x.id, stageId: x.stages[0]?.id })); }}>{pipe!.subs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field> : <span className="hidden sm:block" />}
      <Field label="Stage">{isNew ? <Select value={s_(v.stageId)} onChange={set('stageId')}>{sub?.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select> : <Input disabled value={sub?.stages.find((x) => x.id === v.stageId)?.name || 'Use the stage bar on the deal'} />}</Field>
      <div className="flex gap-2"><Field label="Amount" className="flex-1"><Input type="number" min={0} step="any" value={s_(v.amount)} onChange={set('amount')} /></Field>
        <Field label="Currency" className="w-24"><Select value={s_(v.currency)} onChange={set('currency')}>{Object.keys(settings.currencies).map((c) => <option key={c}>{c}</option>)}</Select></Field></div>
      <Field label="Company (end customer)"><RecordPicker type="company" value={s_(v.companyId)} placeholder="Search companies" ariaLabel="Company" onChange={(id) => setV((o) => ({ ...o, companyId: id }))} /></Field>
      <Field label="Primary contact"><RecordPicker type="contact" value={s_(v.contactId)} company={s_(v.companyId) || null} placeholder={v.companyId ? 'People at this company' : 'Search contacts'} ariaLabel="Contact" onChange={(id, h) => setV((o) => ({ ...o, contactId: id, companyId: o.companyId || String(h?.extra?.companyId || '') }))} /></Field>
      <Field label="Distributor" hint="Partner the deal goes through"><RecordPicker type="company" value={s_(v.distributorId)} placeholder="Search distributors" ariaLabel="Distributor" onChange={(id) => setV((o) => ({ ...o, distributorId: id }))} /></Field>
      <Field label="Reseller"><RecordPicker type="company" value={s_(v.resellerId)} placeholder="Search resellers" ariaLabel="Reseller" onChange={(id) => setV((o) => ({ ...o, resellerId: id }))} /></Field>
      <Field label="Closing date"><Input type="date" value={s_(v.closingDate)} onChange={set('closingDate')} /></Field>
      <Field label="Priority"><Select value={s_(v.priority)} onChange={set('priority')}>{['High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
      <Field label="Deal type"><Select value={s_(v.dealType)} onChange={set('dealType')}><Opts list={DEAL_TYPES} blank={false} /></Select></Field>
      <Field label="Lead source"><Select value={s_(v.leadSource)} onChange={set('leadSource')}><Opts list={settings.leadSources} /></Select></Field>
      <Field label="Forecast category" hint="Commit = you expect to close it this period"><Select value={s_(v.forecastCategory || 'Pipeline')} onChange={set('forecastCategory')}><Opts list={FORECAST_CATEGORIES} blank={false} /></Select></Field>
      <span className="hidden sm:block" />
      <Field label="Next step" className="col-span-full" hint="One line, shown on the board card"><Input value={s_(v.nextStep)} onChange={set('nextStep')} placeholder="e.g. Technical workshop with IT team" /></Field>
      <OwnerSelect value={s_(v.ownerId)} onChange={set('ownerId')} />
      <Field label="Tags" hint="Comma separated"><Input value={s_(v.tags)} onChange={set('tags')} /></Field>
      <div className="col-span-full"><button type="button" onClick={() => setMore((m) => !m)} className="text-[12.5px] font-semibold text-accent hover:underline">{more ? '− Hide' : '+ Add'} contract, registration, tender & PO details</button></div>
      {more && <>
        <Field label="Deal registration no." hint="Registered with the vendor"><Input value={s_(v.dealRegNumber)} onChange={set('dealRegNumber')} /></Field>
        <Field label="Registration expires" hint={`Owner is reminded ${settings.dealRegReminderDays} days before`}><Input type="date" value={s_(v.dealRegExpiry)} onChange={set('dealRegExpiry')} /></Field>
        <Field label="Contract start"><Input type="date" value={s_(v.contractStart)} onChange={set('contractStart')} /></Field>
        <Field label="Term (months)"><Input type="number" min={1} value={s_(v.termMonths)} onChange={set('termMonths')} /></Field>
        <Field label="Contract end" hint={endHint ? `Will be ${endHint} — a renewal opens ${settings.renewalDays} days before` : `A renewal opens ${settings.renewalDays} days before this date`}><Input type="date" value={s_(v.contractEnd)} onChange={set('contractEnd')} /></Field>
        <Field label={`Recurring value / year (${s_(v.currency)})`}><Input type="number" min={0} value={s_(v.recurringValue)} onChange={set('recurringValue')} /></Field>
        <Field label="Tender / RFP no."><Input value={s_(v.tenderNumber)} onChange={set('tenderNumber')} /></Field>
        <Field label="Submission deadline"><Input type="date" value={s_(v.submissionDeadline)} onChange={set('submissionDeadline')} /></Field>
        <Field label="PO number"><Input value={s_(v.poNumber)} onChange={set('poNumber')} /></Field>
        <Field label="Payment terms"><Select value={s_(v.paymentTerms)} onChange={set('paymentTerms')}><Opts list={PAYMENT_TERMS} /></Select></Field>
      </>}
      <Field label="Description" className="col-span-full"><Textarea value={s_(v.description)} onChange={set('description')} /></Field>
      <CustomInputs fields={cfs} values={custom} onChange={setCustom} />
    </Grid>
  </Modal>;
}

/* ---------------- activity ---------------- */
export const ACT_TYPES: [string, string][] = [['task', 'Task'], ['call', 'Call'], ['meeting', 'Meeting'], ['email', 'Email'], ['whatsapp', 'WhatsApp']];
function ActivityForm({ initial, onClose }: FP) {
  const { me } = useApp(); const isNew = !initial.id;
  const [v, set, setV] = useObj({ title: '', type: 'task', dueDate: todayISO(), dueTime: '', ownerId: me.id, details: '', ...initial, rel: initial.relatedType ? `${initial.relatedType}:${initial.relatedId}` : '' } as Record<string, unknown>);
  const { busy, error, run } = useSubmit(onClose);
  return <Modal open onClose={onClose} title={isNew ? 'Schedule activity' : 'Edit activity'} footer={<Footer busy={busy} error={error} onClose={onClose} label={isNew ? 'Schedule' : 'Save'} />}>
    <Grid onSubmit={() => { const [relatedType, relatedId] = String(v.rel || ':').split(':'); run(() => A.saveActivity({ ...(v as object), relatedType, relatedId } as never), isNew ? 'Activity scheduled' : 'Saved'); }}>
      <Field label="Title" required className="col-span-full"><Input autoFocus value={String(v.title)} onChange={set('title')} placeholder="e.g. Call Omar about the PoC" /></Field>
      <div className="col-span-full flex flex-wrap gap-1.5">{ACT_TYPES.map(([k, l]) => <button type="button" key={k} onClick={() => setV((o) => ({ ...o, type: k }))} className={`rounded-full border px-3 py-1 text-xs font-semibold ${v.type === k ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'}`}>{l}</button>)}</div>
      <Field label="Due date"><Input type="date" value={String(v.dueDate ?? '')} onChange={set('dueDate')} /></Field>
      <Field label="Time"><Input type="time" value={String(v.dueTime ?? '')} onChange={set('dueTime')} /></Field>
      <div className="col-span-full grid gap-2 sm:grid-cols-[150px_1fr]">
        <Field label="Related to"><Select value={String(v.rel || ':').split(':')[0]} onChange={(e) => setV((o) => ({ ...o, rel: e.target.value ? `${e.target.value}:` : '' }))}><option value="">Nothing</option><option value="deal">Deal</option><option value="lead">Lead</option><option value="contact">Contact</option><option value="company">Company</option></Select></Field>
        {String(v.rel || '').split(':')[0] ? <Field label="Record"><RecordPicker type={String(v.rel).split(':')[0] as 'deal'} value={String(v.rel).split(':')[1]} ariaLabel="Related record" onChange={(id) => setV((o) => ({ ...o, rel: `${String(o.rel).split(':')[0]}:${id}` }))} /></Field> : <span />}
      </div>
      <OwnerSelect teamOnly value={String(v.ownerId)} onChange={set('ownerId')} />
      <Field label="Repeat" hint="The next one is created when this is done"><Select value={s_(v.repeat)} onChange={set('repeat')}><option value="">Does not repeat</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="quarterly">Every quarter</option></Select></Field>
      {v.type === 'meeting' || v.type === 'call' ? <Field label="Duration (min)"><Input type="number" min={0} step={5} value={s_(v.durationMin)} onChange={set('durationMin')} /></Field> : <span />}
      {v.type === 'meeting' && <><Field label="Location" hint="Office, Teams link…"><Input value={s_(v.location)} onChange={set('location')} /></Field><Field label="Attendees"><Input value={s_(v.attendees)} onChange={set('attendees')} placeholder="Names, comma separated" /></Field></>}
      {(v.type === 'meeting' || v.type === 'call') && (!isNew || !!v.done) && <Field label="Outcome"><Select value={s_(v.outcome)} onChange={set('outcome')}><Opts list={OUTCOMES} /></Select></Field>}
      <Field label="Details" className="col-span-full"><Textarea value={String(v.details ?? '')} onChange={set('details')} /></Field>
    </Grid>
  </Modal>;
}

/* ---------------- product ---------------- */
function ProductForm({ initial, onClose }: FP) {
  const { me } = useApp();
  const isNew = !initial.id;
  const [v, set] = useObj({ name: '', sku: '', category: '', unitPrice: '', costPrice: '', billingType: 'One-time', unit: '', description: '', active: true, ...initial } as Record<string, unknown>);
  const { busy, error, run } = useSubmit(onClose);
  const price = +s_(v.unitPrice) || 0; const cost = s_(v.costPrice) === '' ? null : +s_(v.costPrice);
  return <Modal open onClose={onClose} title={isNew ? 'New product' : 'Edit product'} footer={<Footer busy={busy} error={error} onClose={onClose} label={isNew ? 'Add product' : 'Save'} />}>
    <Grid onSubmit={() => run(() => A.saveProduct({ ...(v as object), unitPrice: +String(v.unitPrice || 0) } as never), isNew ? 'Product added' : 'Saved')}>
      <Field label="Product name" required className="col-span-full"><Input autoFocus value={s_(v.name)} onChange={set('name')} /></Field>
      <Field label="SKU"><Input value={s_(v.sku)} onChange={set('sku')} /></Field>
      <Field label="Category"><Input value={s_(v.category)} onChange={set('category')} /></Field>
      <Field label="Unit price (AED)"><Input type="number" min={0} step="any" value={s_(v.unitPrice)} onChange={set('unitPrice')} /></Field>
      {me.perms.viewCost && <Field label="Cost price (AED)" hint={cost != null && price > 0 ? `Margin ${Math.round((1 - cost / price) * 100)}%` : 'Optional, for margin'}><Input type="number" min={0} step="any" value={s_(v.costPrice)} onChange={set('costPrice')} /></Field>}
      <Field label="Billing"><Select value={s_(v.billingType)} onChange={set('billingType')}><Opts list={BILLING_TYPES} blank={false} /></Select></Field>
      <Field label="Unit" hint="e.g. licence, user, device, day"><Input value={s_(v.unit)} onChange={set('unit')} /></Field>
      <Check label="Active" checked={!!v.active} onChange={set('active')} />
      <Field label="Description" className="col-span-full"><Textarea value={s_(v.description)} onChange={set('description')} /></Field>
    </Grid>
  </Modal>;
}

/* ---------------- ticket ---------------- */
function TicketForm({ initial, onClose }: FP) {
  const { me, desk, settings, products, customFields } = useApp();
  const [v, set, setV] = useObj({ subject: '', description: '', departmentId: desk?.myDeptIds[0] || desk?.departments[0]?.id || '', priority: 'Medium', type: '', category: '', channel: 'phone', contactId: '', companyId: '', requesterName: '', requesterEmail: '', requesterPhone: '', productId: '', assigneeId: '', tags: '', ...initial } as Record<string, unknown>);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const { busy, error, run } = useSubmit(onClose);
  const deps = (desk?.departments || []).filter((d) => me.deskRole === 'admin' || me.ticketScope === 'all' || desk?.myDeptIds.includes(d.id));
  const assignees = (desk?.agents || []).filter((a) => a.deskRole !== 'light' && (a.deskRole === 'admin' || a.deptIds.includes(String(v.departmentId))) && (me.deskRole === 'admin' || me.ticketScope === 'all' || me.ticketScope === 'department' || a.id === me.id));
  return <Modal open onClose={onClose} title="New ticket" sub="Log a request that came in by phone, WhatsApp or in person." footer={<Footer busy={busy} error={error} onClose={onClose} label="Create ticket" />}>
    <Grid onSubmit={() => run(() => D.createTicket({ ...(v as object), custom } as never), 'Ticket created', (id) => `/desk/tickets/${id}`)}>
      <Field label="Subject" required className="col-span-full"><Input autoFocus value={s_(v.subject)} onChange={set('subject')} placeholder="e.g. Firewall licence not activating" /></Field>
      <Field label="Contact" className="col-span-full" hint="Or fill in the requester below for someone not in the CRM yet"><RecordPicker type="contact" value={s_(v.contactId)} placeholder="Search contacts" ariaLabel="Contact" onChange={(id, h) => setV((o) => ({ ...o, contactId: id, companyId: String(h?.extra?.companyId || ''), requesterEmail: String(h?.extra?.email || o.requesterEmail || '') }))} /></Field>
      {!v.contactId && <><Field label="Requester name"><Input value={s_(v.requesterName)} onChange={set('requesterName')} /></Field><Field label="Requester email"><Input type="email" value={s_(v.requesterEmail)} onChange={set('requesterEmail')} /></Field>
        <Field label="Requester phone"><Input type="tel" value={s_(v.requesterPhone)} onChange={set('requesterPhone')} /></Field><span className="hidden sm:block" /></>}
      <Field label="Department" required><Select value={s_(v.departmentId)} onChange={(e) => setV((o) => ({ ...o, departmentId: e.target.value, assigneeId: '' }))}>{deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Assign to"><Select value={s_(v.assigneeId)} onChange={set('assigneeId')}><option value="">Unassigned (rules decide)</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === me.id ? ' (you)' : ''}</option>)}</Select></Field>
      <Field label="Priority"><Select value={s_(v.priority)} onChange={set('priority')}><Opts list={PRIORITIES} blank={false} /></Select></Field>
      <Field label="Channel"><Select value={s_(v.channel)} onChange={set('channel')}>{TICKET_CHANNELS.filter((c) => !['email', 'web', 'portal'].includes(c)).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select></Field>
      <Field label="Type"><Select value={s_(v.type)} onChange={set('type')}><Opts list={settings.ticketTypes} /></Select></Field>
      <Field label="Category"><Select value={s_(v.category)} onChange={set('category')}><Opts list={settings.ticketCategories} /></Select></Field>
      <Field label="Product"><Select value={s_(v.productId)} onChange={set('productId')}><option value="">—</option>{products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Tags" hint="Comma separated"><Input value={s_(v.tags)} onChange={set('tags')} /></Field>
      <Field label="Description" className="col-span-full"><Textarea value={s_(v.description)} onChange={set('description')} placeholder="What the customer reported" className="min-h-[120px]" /></Field>
      <CustomInputs fields={customFields.filter((f) => f.module === 'ticket')} values={custom} onChange={setCustom} />
    </Grid>
  </Modal>;
}
