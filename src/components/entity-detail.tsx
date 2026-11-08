'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Globe, Linkedin, Mail, MessageCircle, Package, Pencil, Plus } from 'lucide-react';
import type { Activity, Attachment, Company, Contact, Note } from '@/db/schema';
import { Avatar, Button, Chip, ConfirmButton, Kpi, Modal, Panel, useToast } from './ui';
import { ProductPicker, useForms } from './forms';
import { useApp } from './app-context';
import { ActivityPanel, AttachmentsPanel, CopyText, DetailGrid, EmailComposer, FavoriteStar, HistoryPanel, NotesPanel, Owner, PhoneText, RelatedList, rememberRecent, useCustomItems, type HistoryRow } from './records';
import { TypeChip } from './people';
import { EmailsPanel, HealthCard, LicencesPanel, SupportSummary, type ContractView, type EmailRow, type HealthView, type LicenceRow } from './customer-360';
import * as A from '@/lib/actions';
import { daysBetweenISO, fmtDate, fmtMoney, fullName, timeAgo, todayISO } from '@/lib/utils';
import { PRODUCT_HANDLING_TYPES } from '@/lib/options';

type DealLite = { id: string; name: string; amount: number | null; currency: string; base: number; type: string; pipe: string; stage: string };
type TicketLite = { id: string; number: number; subject: string; statusCategory: string };
function TicketsPanel({ tickets, contactId, companyId }: { tickets: TicketLite[]; contactId?: string; companyId?: string | null }) {
  const { me, settings } = useApp(); const openForm = useForms();
  if (me.deskRole === 'none') return null;
  return <RelatedList title="Support tickets" empty="No support tickets." action={me.deskRole !== 'light' ? <Button size="sm" variant="soft" onClick={() => openForm('ticket', { contactId, companyId })}><Plus size={14} />Ticket</Button> : undefined}
    items={tickets.map((t) => ({ id: t.id, href: `/desk/tickets/${t.id}`, title: t.subject, sub: `#${settings.ticketPrefix}-${1000 + t.number}`, right: <Chip tone={t.statusCategory === 'closed' ? 'good' : t.statusCategory === 'onhold' ? 'warn' : 'accent'}>{t.statusCategory === 'closed' ? 'Closed' : t.statusCategory === 'onhold' ? 'On hold' : 'Open'}</Chip> }))} />;
}
const url = (v: string) => /^https?:/.test(v) ? v : `https://${v}`;
function Header({ back, backLabel, eyebrow, title, chips, actions, avatar }: { back: string; backLabel: string; eyebrow: string; title: string; chips?: React.ReactNode; actions: React.ReactNode; avatar?: React.ReactNode }) {
  return <><Link href={back} className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />{backLabel}</Link>
    <div className="flex flex-wrap items-start gap-4">{avatar}<div className="min-w-0 flex-1"><p className="eyebrow">{eyebrow}</p><h1 className="font-display text-[30px] font-bold leading-tight tracking-tight">{title}</h1>{chips && <div className="mt-2 flex flex-wrap items-center gap-2">{chips}</div>}</div><div className="flex flex-wrap gap-2">{actions}</div></div></>;
}
const DoNotContact = () => <div className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft px-4 py-2.5 text-[13px] font-semibold text-bad"><AlertTriangle size={16} />Do not contact — this person asked not to be contacted for sales.</div>;

export function ContactDetail({ c, company, deals, acts, notes, files, fav, history, tickets, emails }: { c: Contact; company: Company | null; deals: DealLite[]; acts: Activity[]; notes: Note[]; files: Attachment[]; fav: boolean; history: HistoryRow[]; tickets: TicketLite[]; emails: EmailRow[] }) {
  const openForm = useForms(); const toast = useToast(); const router = useRouter(); const custom = useCustomItems(); const { products, me } = useApp(); const [email, setEmail] = useState(false); const [pick, setPick] = useState<string[] | null>(null);
  useEffect(() => { rememberRecent({ type: 'contact', id: c.id, label: fullName(c), href: `/contacts/${c.id}` }); }, [c]);
  const handles = !!company && PRODUCT_HANDLING_TYPES.includes(company.accountType);
  const canEdit = me.role !== 'rep' || !c.ownerId || c.ownerId === me.id;
  const wa = (c.whatsapp || c.mobile || '').replace(/[^\d]/g, '');
  const prodList = c.productIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as typeof products;
  return <div className="flex flex-col gap-4">
    <Header back="/contacts" backLabel="Contacts" eyebrow="Contact" title={fullName(c)} avatar={<Avatar id={c.id} name={fullName(c)} size={56} />}
      chips={<>{(c.jobTitle || company) && <span className="text-[13.5px] text-muted">{c.jobTitle}{company && <>{c.jobTitle ? ' at ' : ''}<Link href={`/companies/${company.id}`} className="font-semibold text-accent hover:underline">{company.name}</Link></>}</span>}
        {company && company.accountType !== 'Prospect' && <TypeChip t={company.accountType} />}{c.buyingRole && <Chip tone="accent">{c.buyingRole}</Chip>}
        {c.consent && <Chip tone="good">Consent {c.consentAt ? fmtDate(c.consentAt) : ''}</Chip>}{c.tags.map((t) => <Chip key={t} tone="outline">{t}</Chip>)}</>}
      actions={<><FavoriteStar type="contact" id={c.id} label={fullName(c)} on={fav} /><Button onClick={() => setEmail(true)} disabled={c.doNotContact} title={c.doNotContact ? 'Marked do not contact' : undefined}><Mail size={15} />Email</Button><Button onClick={() => openForm('contact', c as never)}><Pencil size={15} />Edit</Button>
        <ConfirmButton confirmText="Delete contact?" onConfirm={async () => { const r = await A.deleteRecords('contact', [c.id]); if (!r.ok) toast(r.error, 'bad'); else { toast('Contact deleted'); router.push('/contacts'); } }}>Delete</ConfirmButton></>} />
    {c.doNotContact && <DoNotContact />}
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        {handles && <Panel title={<span className="inline-flex items-center gap-2"><Package size={15} className="text-accent" />Products handled at {company!.name}</span>} count={prodList.length}
          actions={canEdit && <Button size="sm" variant="soft" onClick={() => setPick(c.productIds)}>{prodList.length ? 'Change' : 'Choose'}</Button>} bodyClass="p-5">
          {prodList.length ? <div className="flex flex-wrap gap-1.5">{prodList.map((p) => <Chip key={p.id} tone="accent">{p.name}{p.category && <span className="font-normal opacity-70"> · {p.category}</span>}</Chip>)}</div>
            : <p className="text-[13px] text-muted">Record which of your products {c.firstName} looks after at this distributor, so you know who to call for each line.</p>}
        </Panel>}
        <Panel title="Details"><DetailGrid items={[
          ['Email', <CopyText key="e" value={c.email} />], ['Mobile', <PhoneText key="m" value={c.mobile} />], ['Office phone', <PhoneText key="p" value={c.phone} />],
          ['WhatsApp', wa ? <a key="w" className="inline-flex items-center gap-1 text-accent hover:underline" href={`https://wa.me/${wa}`} target="_blank" rel="noopener"><MessageCircle size={13} />Open chat</a> : null],
          ['Department', c.department], ['Preferred language', c.language],
          ['LinkedIn', c.linkedin ? <a key="l" className="inline-flex items-center gap-1 text-accent hover:underline" href={url(c.linkedin)} target="_blank" rel="noopener"><Linkedin size={13} />Profile</a> : null],
          ['Last contacted', c.lastContactedAt ? timeAgo(c.lastContactedAt) : 'Never'], ['Birthday', c.birthday ? new Date(c.birthday + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : null],
          ['Source', c.source], ['Owner', <Owner key="o" id={c.ownerId} />], ['Added', fmtDate(c.createdAt)], ...custom('contact', c.custom)]} /></Panel>
        <ActivityPanel items={acts} relatedType="contact" relatedId={c.id} />
        <EmailsPanel items={emails} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <RelatedList title="Deals" empty="No deals with this contact yet." action={<Button size="sm" variant="soft" onClick={() => openForm('deal', { contactId: c.id, companyId: c.companyId })}><Plus size={14} />Add</Button>}
          items={deals.map((d) => ({ id: d.id, href: `/deals/${d.id}`, title: d.name, sub: `${d.pipe} · ${fmtMoney(d.amount, d.currency)}`, right: <StageTag d={d} /> }))} />
        <TicketsPanel tickets={tickets} contactId={c.id} companyId={c.companyId} />
        <NotesPanel items={notes} relatedType="contact" relatedId={c.id} />
        <AttachmentsPanel items={files} relatedType="contact" relatedId={c.id} />
        <HistoryPanel rows={history} />
      </div>
    </div>
    <EmailComposer open={email} onClose={() => setEmail(false)} to={c.email} ctx={{ firstName: c.firstName, lastName: c.lastName, company: company?.name }} relatedType="contact" relatedId={c.id} />
    {pick && <Modal open onClose={() => setPick(null)} title="Products handled" sub={`What ${c.firstName} looks after at ${company?.name}`}
      footer={<><Button variant="ghost" onClick={() => setPick(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await A.setContactProducts(c.id, pick); if (!r.ok) return toast(r.error, 'bad'); setPick(null); toast('Products updated'); router.refresh(); }}>Save</Button></>}>
      <div className="pb-3"><ProductPicker value={pick} onChange={setPick} /></div>
    </Modal>}
  </div>;
}
const StageTag = ({ d }: { d: { type: string; stage: string } }) => <Chip tone={d.type === 'won' ? 'good' : d.type === 'lost' ? 'bad' : 'accent'}>{d.stage}</Chip>;

/** Product → people at a distributor, plus catalogue lines nobody covers yet. */
function ProductCoverage({ people }: { people: Contact[] }) {
  const { products } = useApp(); const openForm = useForms();
  const covered = products.filter((p) => people.some((c) => c.productIds.includes(p.id)));
  const gaps = products.filter((p) => p.active && !covered.includes(p));
  return <Panel title={<span className="inline-flex items-center gap-2"><Package size={15} className="text-accent" />Product coverage</span>} count={`${covered.length} of ${products.filter((p) => p.active).length}`}>
    {covered.length ? <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Product</th><th>Handled by</th></tr></thead><tbody>
      {covered.map((p) => <tr key={p.id}><td className="font-medium">{p.name}{p.category && <div className="text-xs text-muted">{p.category}</div>}</td>
        <td><div className="flex flex-wrap gap-1.5">{people.filter((c) => c.productIds.includes(p.id)).map((c) => <Link key={c.id} href={`/contacts/${c.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-xs font-semibold hover:border-accent hover:text-accent"><Avatar id={c.id} name={fullName(c)} size={20} />{fullName(c)}</Link>)}</div></td></tr>)}
    </tbody></table></div> : <p className="px-5 py-5 text-[13px] text-muted">No one here has products assigned yet. Open a contact and choose the products they handle{people.length ? '' : ' — add a contact first'}.</p>}
    {gaps.length > 0 && <div className="border-t border-line px-5 py-3.5"><div className="eyebrow !text-[10.5px]">Not covered by anyone</div><div className="mt-2 flex flex-wrap gap-1.5">{gaps.map((p) => <Chip key={p.id} tone="outline">{p.name}</Chip>)}</div>
      {people.length === 0 && <Button size="sm" variant="soft" className="mt-3" onClick={() => openForm('contact')}><Plus size={14} />Add a contact</Button>}</div>}
  </Panel>;
}

export function CompanyDetail({ c, people, deals, acts, notes, files, fav, parent, subs, partnerDeals, groupTotals, history, tickets, licences, contracts, emails, support, health }: { c: Company; people: Contact[]; deals: DealLite[]; acts: Activity[]; notes: Note[]; files: Attachment[]; fav: boolean;
  parent: { id: string; name: string } | null; subs: { id: string; name: string }[]; partnerDeals: (DealLite & { role: string })[]; groupTotals: { open: number; won: number } | null; history: HistoryRow[]; tickets: TicketLite[];
  licences: LicenceRow[]; contracts: ContractView[]; emails: EmailRow[]; support: { ratings: { good: number; ok: number; bad: number }; openTickets: number }; health: HealthView }) {
  const openForm = useForms(); const toast = useToast(); const router = useRouter(); const custom = useCustomItems(); const { products, me } = useApp();
  const canEditCo = me.role !== 'rep' || !c.ownerId || c.ownerId === me.id;
  useEffect(() => { rememberRecent({ type: 'company', id: c.id, label: c.name, href: `/companies/${c.id}` }); }, [c]);
  const sum = (t: string) => deals.filter((d) => d.type === t).reduce((s, d) => s + d.base, 0);
  const handles = PRODUCT_HANDLING_TYPES.includes(c.accountType);
  const lic = c.tradeLicenceExpiry ? daysBetweenISO(todayISO(), c.tradeLicenceExpiry) : null;
  const prodNames = (ids: string[]) => ids.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean).join(', ');
  return <div className="flex flex-col gap-4">
    <Header back="/companies" backLabel="Companies" eyebrow={[c.accountType, c.industry].filter(Boolean).join(' · ') || 'Company'} title={c.name}
      avatar={<span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft font-display text-xl font-bold text-accent">{c.name.replace(/^Sample:\s*/, '').slice(0, 2).toUpperCase()}</span>}
      chips={<><TypeChip t={c.accountType} />{c.tier && <Chip tone="accent">{c.tier}</Chip>}
        {c.website && <a href={url(c.website)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline"><Globe size={13} />{c.website}</a>}
        <span className="text-[13px] text-muted">{[c.emirate, c.zone, c.city !== c.emirate ? c.city : null, c.country !== 'United Arab Emirates' ? c.country : null].filter(Boolean).join(' · ')}</span>
        {lic != null && lic <= 60 && <Chip tone={lic < 0 ? 'bad' : 'warn'}>{lic < 0 ? 'Licence expired' : `Licence expires in ${lic} days`}</Chip>}</>}
      actions={<><FavoriteStar type="company" id={c.id} label={c.name} on={fav} /><Button onClick={() => openForm('company', c as never)}><Pencil size={15} />Edit</Button>
        <ConfirmButton confirmText="Delete company?" onConfirm={async () => { const r = await A.deleteRecords('company', [c.id]); if (!r.ok) toast(r.error, 'bad'); else { toast('Company deleted'); router.push('/companies'); } }}>Delete</ConfirmButton></>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Open value" value={fmtMoney(sum('open'))} sub={`${deals.filter((d) => d.type === 'open').length} open deals`} />
      <Kpi label="Won to date" value={fmtMoney(sum('won'))} sub={c.customerSince ? `Customer since ${fmtDate(c.customerSince)}` : `${deals.filter((d) => d.type === 'won').length} won`} />
      <Kpi label="Active licences" value={licences.filter((l) => l.status === 'active').length} sub={licences.some((l) => l.status === 'active' && l.endDate && l.endDate <= todayISO()) ? 'Some have expired' : `${people.length} contact${people.length === 1 ? '' : 's'}`} />
      <Kpi label="Open activities" value={acts.filter((a) => !a.done).length} />
    </div>
    <HealthCard h={health} />
    {(parent || subs.length > 0) && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-4 py-2.5 text-[13px]">
      {parent && <>Part of <Link className="font-semibold text-accent hover:underline" href={`/companies/${parent.id}`}>{parent.name}</Link></>}
      {subs.length > 0 && <>{parent && <span className="text-faint">·</span>}<span>{subs.length} {subs.length === 1 ? 'branch' : 'branches'}:</span>{subs.map((x) => <Link key={x.id} href={`/companies/${x.id}`} className="font-semibold text-accent hover:underline">{x.name}</Link>)}
        {groupTotals && <span className="text-muted">· group open {fmtMoney(sum('open') + groupTotals.open)}, won {fmtMoney(sum('won') + groupTotals.won)}</span>}</>}
    </div>}
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        {handles && <ProductCoverage people={people} />}
        <Panel title="Details"><DetailGrid items={[['Industry', c.industry], ['Sector', c.sector], ['Phone', <PhoneText key="p" value={c.phone} />],
          ['VAT TRN', c.vatTrn ? <span className="num">{c.vatTrn}</span> : null], ['Trade licence', c.tradeLicenceNo ? <span className="num">{c.tradeLicenceNo}{c.tradeLicenceExpiry && <span className="text-muted"> · expires {fmtDate(c.tradeLicenceExpiry)}</span>}</span> : c.tradeLicenceExpiry ? `Expires ${fmtDate(c.tradeLicenceExpiry)}` : null],
          ['Employees', c.employees], ['Annual revenue', c.annualRevenue != null ? fmtMoney(c.annualRevenue) : null],
          ['LinkedIn', c.linkedin ? <a key="l" className="text-accent hover:underline" href={url(c.linkedin)} target="_blank" rel="noopener">Company page</a> : null],
          ['Customer since', c.customerSince ? fmtDate(c.customerSince) : null], ['Owner', <Owner key="o" id={c.ownerId} />], ['Added', fmtDate(c.createdAt)], ...custom('company', c.custom)]} /></Panel>
        <RelatedList title="Deals" empty="No deals with this company yet." action={<Button size="sm" variant="soft" onClick={() => openForm('deal', { companyId: c.id, contactId: people[0]?.id })}><Plus size={14} />Add</Button>}
          items={deals.map((d) => ({ id: d.id, href: `/deals/${d.id}`, title: d.name, sub: `${d.pipe} · ${fmtMoney(d.amount, d.currency)}`, right: <StageTag d={d} /> }))} />
        {partnerDeals.length > 0 && <RelatedList title={`Deals through ${c.name}`} empty="" items={partnerDeals.map((d) => ({ id: d.id, href: `/deals/${d.id}`, title: d.name, sub: `${d.role} · ${d.pipe} · ${fmtMoney(d.amount, d.currency)}`, right: <StageTag d={d} /> }))}
          action={<span className="text-xs text-muted">open {fmtMoney(partnerDeals.filter((d) => d.type === 'open').reduce((a, d) => a + d.base, 0))} · won {fmtMoney(partnerDeals.filter((d) => d.type === 'won').reduce((a, d) => a + d.base, 0))}</span>} />}
        <LicencesPanel companyId={c.id} items={licences} canEdit={canEditCo} />
        <ActivityPanel items={acts} relatedType="company" relatedId={c.id} />
        <EmailsPanel items={emails} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <SupportSummary contracts={contracts} ratings={support.ratings} openTickets={support.openTickets} />
        <RelatedList title="People" empty="No contacts at this company yet." action={<Button size="sm" variant="soft" onClick={() => openForm('contact', { companyId: c.id })}><Plus size={14} />Add</Button>}
          items={people.map((p) => ({ id: p.id, href: `/contacts/${p.id}`, title: <>{fullName(p)}{p.doNotContact && <Chip tone="bad" className="ml-1.5">DNC</Chip>}</>, sub: (handles && p.productIds.length ? prodNames(p.productIds) : [p.jobTitle, p.buyingRole].filter(Boolean).join(' · ') || p.email) || undefined }))} />
        <TicketsPanel tickets={tickets} companyId={c.id} />
        <NotesPanel items={notes} relatedType="company" relatedId={c.id} />
        <AttachmentsPanel items={files} relatedType="company" relatedId={c.id} />
        <HistoryPanel rows={history} />
      </div>
    </div>
  </div>;
}
