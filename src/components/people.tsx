'use client';
import { HealthChip, type HealthView } from './customer-360';
import Link from 'next/link';
import { Building2, Download, Plus, Users } from 'lucide-react';
import type { Company, Contact } from '@/db/schema';
import { Button, Chip, Empty, Segmented, Select } from './ui';
import { useApp } from './app-context';
import { useForms } from './forms';
import { BulkActions, DataTable, InlineCell, Owner } from './records';
import { ImportButton } from './import-modal';
import { PageHeader } from './shell';
import { Pager, SearchBox, useListParams, ViewsMenu, type View } from './list-controls';
import { cn, fmtMoney, formatPhone, fullName, timeAgo } from '@/lib/utils';
import { ACCOUNT_TYPES, BUYING_ROLES, EMIRATES, TIERS } from '@/lib/options';

function Switch({ on }: { on: 'people' | 'companies' }) {
  return <div className="mb-4 inline-flex gap-0.5 rounded-[10px] border border-line bg-sunken p-0.5">
    {([['people', 'People', '/contacts', Users], ['companies', 'Companies', '/companies', Building2]] as const).map(([k, l, h, I]) => <Link key={k} href={h} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold', on === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}><I size={14} />{l}</Link>)}
  </div>;
}
const TYPE_TONE: Record<string, 'neutral' | 'good' | 'accent' | 'warn' | 'bad' | 'outline'> = { Customer: 'good', Distributor: 'accent', Reseller: 'accent', Partner: 'accent', Competitor: 'bad', Prospect: 'neutral', Vendor: 'outline' };
export const TypeChip = ({ t }: { t: string }) => <Chip tone={TYPE_TONE[t] || 'neutral'}>{t}</Chip>;

export function PeopleView({ contacts, total, page, size, tags, views }: { contacts: (Contact & { openDeals: number; companyName: string | null; companyType: string | null })[]; total: number; page: number; size: number; tags: string[]; views: View[] }) {
  const { me, products, users } = useApp(); const openForm = useForms(); const lp = useListParams();
  const prodName = (id: string) => products.find((p) => p.id === id)?.name;
  const mayEdit = (c: Contact) => me.role !== 'rep' || !c.ownerId || c.ownerId === me.id;
  const showProducts = contacts.some((c) => c.productIds.length) || !!lp.get('product');
  return <>
    <PageHeader title="Contacts" sub={`${total} ${total === 1 ? 'person' : 'people'}${lp.sp.toString() ? ' match these filters' : ''}`} actions={<>{me.role !== 'rep' && <><ImportButton entity="contact" /><a href="/api/export/contacts"><Button><Download size={15} />Export</Button></a></>}<Button variant="primary" onClick={() => openForm('contact')}><Plus size={16} />New contact</Button></>} />
    <Switch on="people" />
    <div className="mb-3 flex flex-wrap items-center gap-2"><SearchBox placeholder="Search name, email, phone, company" /><Segmented value={lp.get('mine') ? 'mine' : 'all'} onChange={(v) => lp.set({ mine: v === 'mine' ? 1 : '' })} options={[['all', 'Everyone'], ['mine', 'Mine']]} />
      <Select className="h-9 w-auto" value={lp.get('type')} onChange={(e) => lp.set({ type: e.target.value })} aria-label="Company type"><option value="">Any company type</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
      <Select className="h-9 w-auto max-w-[200px]" value={lp.get('product')} onChange={(e) => lp.set({ product: e.target.value })} aria-label="Product handled"><option value="">Any product handled</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Select className="h-9 w-auto" value={lp.get('role')} onChange={(e) => lp.set({ role: e.target.value })} aria-label="Buying role"><option value="">Any role</option>{BUYING_ROLES.map((t) => <option key={t}>{t}</option>)}</Select>
      {tags.length > 0 && <Select className="h-9 w-auto" value={lp.get('tag')} onChange={(e) => lp.set({ tag: e.target.value })} aria-label="Tag"><option value="">All tags</option>{tags.map((t) => <option key={t}>{t}</option>)}</Select>}
      <ViewsMenu page="contacts" views={views} /></div>
    <DataTable rows={contacts} href={(c) => `/contacts/${c.id}`} selectable bulk={(ids, clear) => <BulkActions entity="contact" ids={ids} clear={clear} />} serverSort={lp.sort || ['name', 1]} onSort={lp.onSort}
      empty={<Empty icon={<Users />} title={lp.sp.toString() ? 'No matches' : 'No contacts yet'} action={<Button variant="primary" onClick={() => openForm('contact')}>Add a contact</Button>}>{lp.sp.toString() ? 'Try a different search or clear the filters.' : 'Add people, convert leads, or import a CSV.'}</Empty>}
      cols={[
        { key: 'name', label: 'Name', cell: (c) => <div><div className="font-semibold">{fullName(c)}{c.doNotContact && <Chip tone="bad" className="ml-1.5">Do not contact</Chip>}</div>{(c.jobTitle || c.buyingRole) && <div className="text-xs text-muted">{[c.jobTitle, c.buyingRole].filter(Boolean).join(' · ')}</div>}</div>, sort: () => 0 },
        { key: 'company', label: 'Company', cell: (c) => c.companyName ? <span className="inline-flex items-center gap-1.5">{c.companyName}{c.companyType && c.companyType !== 'Prospect' && c.companyType !== 'Customer' && <TypeChip t={c.companyType} />}</span> : <span className="text-faint">—</span>, sort: () => 0 },
        ...(showProducts ? [{ key: 'products', label: 'Products handled', cell: (c: Contact & { companyName: string | null }) => c.productIds.length ? <div className="flex max-w-[260px] flex-wrap gap-1">{c.productIds.slice(0, 3).map((id) => <Chip key={id} tone="accent">{prodName(id) || 'Removed'}</Chip>)}{c.productIds.length > 3 && <Chip>+{c.productIds.length - 3}</Chip>}</div> : <span className="text-faint">—</span> }] : []),
        { key: 'email', label: 'Email', cell: (c) => c.email || <span className="text-faint">—</span>, sort: () => 0 },
        { key: 'phone', label: 'Phone', cell: (c) => <InlineCell entity="contact" id={c.id} field="mobile" value={c.mobile || c.phone} display={<span className="num text-[13px]">{formatPhone(c.mobile || c.phone) || '—'}</span>} canEdit={mayEdit(c) && !(!c.mobile && c.phone)} /> },
        { key: 'last', label: 'Last contacted', cell: (c) => c.lastContactedAt ? <span className="text-[13px] text-muted">{timeAgo(c.lastContactedAt)}</span> : <span className="text-faint">Never</span>, sort: () => 0 },
        { key: 'deals', label: 'Open deals', num: true, cell: (c) => c.openDeals },
        { key: 'owner', label: 'Owner', cell: (c) => <InlineCell entity="contact" id={c.id} field="ownerId" kind="select" value={c.ownerId} display={<Owner id={c.ownerId} />} canEdit={me.role !== 'rep'} options={users.filter((u) => u.active || u.id === c.ownerId).map((u) => [u.id, u.name])} />, sort: () => 0 },
      ]} />
    <Pager page={page} size={size} total={total} />
  </>;
}
export function CompaniesView({ companies, total, page, size, openTotal, views }: { companies: (Company & { contacts: number; open: number; won: number; health?: HealthView })[]; total: number; page: number; size: number; openTotal: number; views: View[] }) {
  const openForm = useForms(); const { me, users } = useApp(); const lp = useListParams();
  const mayEdit = (c: Company) => me.role !== 'rep' || !c.ownerId || c.ownerId === me.id;
  return <>
    <PageHeader title="Companies" sub={`${total} account${total === 1 ? '' : 's'} · ${fmtMoney(openTotal)} open`} actions={<>{me.role !== 'rep' && <><ImportButton entity="company" /><a href="/api/export/companies"><Button><Download size={15} />Export</Button></a></>}<Button variant="primary" onClick={() => openForm('company')}><Plus size={16} />New company</Button></>} />
    <Switch on="companies" />
    <div className="mb-3 flex flex-wrap items-center gap-2"><SearchBox placeholder="Search name, industry, TRN, licence" />
      <Segmented value={lp.get('mine') ? 'mine' : 'all'} onChange={(v) => lp.set({ mine: v === 'mine' ? 1 : '' })} options={[['all', 'Everyone'], ['mine', 'Mine']]} />
      <Select className="h-9 w-auto" value={lp.get('type')} onChange={(e) => lp.set({ type: e.target.value })} aria-label="Account type"><option value="">Any type</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
      <Select className="h-9 w-auto" value={lp.get('emirate')} onChange={(e) => lp.set({ emirate: e.target.value })} aria-label="Emirate"><option value="">Any emirate</option>{EMIRATES.map((t) => <option key={t}>{t}</option>)}</Select>
      <Select className="h-9 w-auto" value={lp.get('tier')} onChange={(e) => lp.set({ tier: e.target.value })} aria-label="Tier"><option value="">Any tier</option>{TIERS.map((t) => <option key={t}>{t}</option>)}</Select>
      <Select className="h-9 w-auto" value={lp.get('licence')} onChange={(e) => lp.set({ licence: e.target.value })} aria-label="Licence"><option value="">Any licence</option><option value="soon">Licence expiring ≤ 60 days</option></Select>
      <ViewsMenu page="companies" views={views} /></div>
    <DataTable rows={companies} href={(c) => `/companies/${c.id}`} selectable bulk={(ids, clear) => <BulkActions entity="company" ids={ids} clear={clear} />} serverSort={lp.sort || ['open', -1]} onSort={lp.onSort}
      empty={<Empty icon={<Building2 />} title={lp.sp.toString() ? 'No matches' : 'No companies yet'} action={<Button variant="primary" onClick={() => openForm('company')}>Add a company</Button>} />}
      cols={[
        { key: 'name', label: 'Company', cell: (c) => <span className="font-semibold">{c.name}</span>, sort: () => 0 },
        { key: 'type', label: 'Type', cell: (c) => <InlineCell entity="company" id={c.id} field="accountType" kind="select" value={c.accountType} display={<TypeChip t={c.accountType} />} canEdit={mayEdit(c)} options={ACCOUNT_TYPES.map((t) => [t, t])} />, sort: () => 0 },
        { key: 'industry', label: 'Industry', cell: (c) => c.industry || <span className="text-faint">—</span>, sort: () => 0 },
        { key: 'emirate', label: 'Emirate', cell: (c) => [c.emirate, c.zone === 'Free zone' ? 'FZ' : null].filter(Boolean).join(' · ') || <span className="text-faint">—</span>, sort: () => 0 },
        { key: 'health', label: 'Health', cell: (c) => <span title={c.health?.reasons.join(' · ') || 'No warning signs'}><HealthChip h={c.health} /></span> },
        { key: 'contacts', label: 'Contacts', num: true, cell: (c) => c.contacts, sort: () => 0 },
        { key: 'open', label: 'Open value', num: true, cell: (c) => fmtMoney(c.open), sort: () => 0 },
        { key: 'won', label: 'Won to date', num: true, cell: (c) => fmtMoney(c.won), sort: () => 0 },
        { key: 'owner', label: 'Owner', cell: (c) => <InlineCell entity="company" id={c.id} field="ownerId" kind="select" value={c.ownerId} display={<Owner id={c.ownerId} />} canEdit={me.role !== 'rep'} options={users.filter((u) => u.active || u.id === c.ownerId).map((u) => [u.id, u.name])} />, sort: () => 0 },
      ]} />
    <Pager page={page} size={size} total={total} />
  </>;
}
