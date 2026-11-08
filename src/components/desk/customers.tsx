'use client';
import { HealthCard, LicencesPanel, SupportSummary, type ContractView, type HealthView, type LicenceRow } from '../customer-360';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Building2, Copy, Plus, Users } from 'lucide-react';
import { Avatar, Button, Chip, ConfirmButton, Empty, IconButton, Input, Panel, Segmented, useToast } from '../ui';
import { useApp } from '../app-context';
import { useForms } from '../forms';
import { DataTable, DetailGrid } from '../records';
import { PageHeader } from '../shell';
import { Pager, SearchBox, useListParams } from '../list-controls';
import * as D from '@/lib/desk-actions';
import { fmtDate, formatPhone, timeAgo } from '@/lib/utils';
import { PriorityChip, useTag } from './bits';

type Row = { id: string; name: string; email: string | null; phone: string | null; company: string | null; companyId: string | null; portal: boolean; open: number; all: number };
export default function DeskCustomers({ rows, total, page, size }: { rows: Row[]; total: number; page: number; size: number }) {
  const lp = useListParams(); const { me } = useApp();
  return <>
    <PageHeader title="Customers" sub="People who contact support, with their tickets and portal access." actions={me.crmAccess ? <Link href="/contacts"><Button>Open in CRM</Button></Link> : undefined} />
    <div className="mb-3 flex flex-wrap items-center gap-2"><SearchBox placeholder="Search name, email, phone, company" />
      <Segmented value={lp.get('withTickets') ? 'with' : lp.get('portal') ? 'portal' : 'all'} onChange={(v) => lp.set({ withTickets: v === 'with' ? 1 : '', portal: v === 'portal' ? 1 : '' })} options={[['all', 'Everyone'], ['with', 'With tickets'], ['portal', 'Portal users']]} /></div>
    <DataTable rows={rows} href={(r) => `/desk/customers/${r.id}`} empty={<Empty icon={<Users />} title="No customers found">Customers are created automatically when they email support or use the web form.</Empty>}
      cols={[
        { key: 'name', label: 'Name', cell: (r) => <span className="inline-flex items-center gap-2 font-semibold"><Avatar id={r.id} name={r.name} size={24} />{r.name}{r.portal && <Chip tone="good">Portal</Chip>}</span> },
        { key: 'company', label: 'Company', cell: (r) => r.companyId ? <Link onClick={(e) => e.stopPropagation()} href={`/desk/customers/c-${r.companyId}`} className="hover:text-accent">{r.company}</Link> : <span className="text-faint">—</span> },
        { key: 'email', label: 'Email', cell: (r) => r.email || <span className="text-faint">—</span> },
        { key: 'phone', label: 'Phone', cell: (r) => <span className="num text-[13px]">{formatPhone(r.phone) || '—'}</span> },
        { key: 'open', label: 'Open tickets', num: true, cell: (r) => r.open || <span className="text-faint">0</span> },
        { key: 'all', label: 'All tickets', num: true, cell: (r) => r.all },
      ]} />
    <Pager page={page} size={size} total={total} />
  </>;
}
type TRow = { id: string; number: number; subject: string; statusCategory: string; priority: string; createdAt: Date; rating: string | null };
function TicketList({ tickets }: { tickets: TRow[] }) {
  const tag = useTag();
  return <Panel title="Tickets" count={tickets.length}>{tickets.length ? tickets.map((t) => <Link key={t.id} href={`/desk/tickets/${t.id}`} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-raised">
    <span className="num text-xs text-muted">{tag(t.number)}</span><span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{t.subject}</span><PriorityChip p={t.priority} />
    <Chip tone={t.statusCategory === 'closed' ? 'good' : t.statusCategory === 'onhold' ? 'warn' : 'accent'}>{t.statusCategory === 'closed' ? 'Closed' : t.statusCategory === 'onhold' ? 'On hold' : 'Open'}</Chip><span className="hidden text-xs text-muted sm:block">{fmtDate(t.createdAt)}</span></Link>)
    : <p className="px-5 py-6 text-[13px] text-muted">No tickets you can see.</p>}</Panel>;
}
export function CustomerContact({ ct, company, tickets }: { ct: { id: string; name: string; email: string | null; phone: string | null; mobile: string | null; jobTitle: string | null; portalEnabled: boolean; portalCompanyAccess: boolean; portalLastLogin: Date | null; language: string | null }; company: { id: string; name: string; tier: string | null } | null; tickets: TRow[] }) {
  const { me } = useApp(); const openForm = useForms(); const toast = useToast(); const router = useRouter(); const [link, setLink] = useState<string | null>(null); const [coAccess, setCoAccess] = useState(ct.portalCompanyAccess);
  const canAct = me.deskRole !== 'light';
  return <div className="flex flex-col gap-4">
    <Link href="/desk/customers" className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />Customers</Link>
    <div className="flex flex-wrap items-start gap-4"><Avatar id={ct.id} name={ct.name} size={56} /><div className="min-w-0 flex-1"><p className="eyebrow">Customer</p><h1 className="font-display text-[30px] font-bold leading-tight">{ct.name}</h1>
      <p className="text-[13.5px] text-muted">{[ct.jobTitle, company?.name].filter(Boolean).join(' at ')}</p></div>
      <div className="flex gap-2">{me.crmAccess && <Link href={`/contacts/${ct.id}`}><Button>Open in CRM</Button></Link>}{canAct && <Button variant="primary" onClick={() => openForm('ticket', { contactId: ct.id, companyId: company?.id })}><Plus size={15} />New ticket</Button>}</div></div>
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <TicketList tickets={tickets} />
      <div className="flex flex-col gap-4">
        <Panel title="Details"><DetailGrid items={[['Email', ct.email], ['Mobile', formatPhone(ct.mobile)], ['Office phone', formatPhone(ct.phone)], ['Language', ct.language], ['Company', company ? <Link className="text-accent hover:underline" href={`/desk/customers/c-${company.id}`}>{company.name}</Link> : null], ['Tier', company?.tier]]} /></Panel>
        <Panel title="Customer portal" bodyClass="grid gap-3 p-5 text-[13px]">
          <p>{ct.portalEnabled ? <>Has access{ct.portalLastLogin ? ` · last signed in ${timeAgo(ct.portalLastLogin)}` : ' · hasn’t signed in yet'}.</> : 'No access yet. Invite them so they can follow their tickets and read help articles.'}</p>
          {canAct && ct.email && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={coAccess} onChange={(e) => setCoAccess(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />Can see all tickets from {company?.name || 'their company'}</label>}
          {canAct && <div className="flex flex-wrap gap-2">{ct.email ? <Button size="sm" variant="soft" onClick={async () => { const r = await D.invitePortal(ct.id, coAccess); if (!r.ok) return toast(r.error, 'bad'); setLink(r.link.startsWith('/') ? location.origin + r.link : r.link); toast(r.emailed ? 'Invitation emailed' : 'Invitation link created'); router.refresh(); }}>{ct.portalEnabled ? 'Update & resend invite' : 'Invite to portal'}</Button> : <span className="text-xs text-muted">Add an email address to invite them.</span>}
            {ct.portalEnabled && <ConfirmButton size="sm" confirmText="Remove access?" onConfirm={async () => { const r = await D.revokePortal(ct.id); if (!r.ok) toast(r.error, 'bad'); else { toast('Portal access removed'); router.refresh(); } }}>Remove access</ConfirmButton>}</div>}
          {link && <div className="flex gap-1.5"><Input readOnly value={link} onFocus={(e) => e.target.select()} className="!h-8 text-[11px]" /><IconButton label="Copy" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Copied'); } catch { toast('Select the link to copy it'); } }}><Copy size={14} /></IconButton></div>}
        </Panel>
      </div>
    </div>
  </div>;
}
export function CustomerCompany({ co, people, tickets, health, contracts, licences, support }: { co: { id: string; name: string; tier: string | null; accountType: string; phone: string | null; website: string | null; emirate: string | null }; people: { id: string; name: string; email: string | null; jobTitle: string | null; portal: boolean }[]; tickets: TRow[] ; health: HealthView; contracts: ContractView[]; licences: LicenceRow[]; support: { ratings: { good: number; ok: number; bad: number }; openTickets: number } }) {
  const { me } = useApp(); const openForm = useForms();
  return <div className="flex flex-col gap-4">
    <Link href="/desk/customers" className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />Customers</Link>
    <div className="flex flex-wrap items-start gap-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent"><Building2 /></span><div className="min-w-0 flex-1"><p className="eyebrow">{co.accountType}</p><h1 className="font-display text-[30px] font-bold leading-tight">{co.name}</h1>
      <div className="mt-1 flex gap-2">{co.tier && <Chip tone="accent">{co.tier}</Chip>}{co.emirate && <span className="text-[13px] text-muted">{co.emirate}</span>}</div></div>
      <div className="flex gap-2">{me.crmAccess && <Link href={`/companies/${co.id}`}><Button>Open in CRM</Button></Link>}{me.deskRole !== 'light' && <Button variant="primary" onClick={() => openForm('ticket', { companyId: co.id })}><Plus size={15} />New ticket</Button>}</div></div>
    <HealthCard h={health} />
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]"><div className="flex min-w-0 flex-col gap-4"><TicketList tickets={tickets} />{licences.length > 0 && <LicencesPanel companyId={co.id} items={licences} canEdit={false} />}</div><div className="flex min-w-0 flex-col gap-4"><SupportSummary contracts={contracts} ratings={support.ratings} openTickets={support.openTickets} />
      <Panel title="People" count={people.length}>{people.map((p) => <Link key={p.id} href={`/desk/customers/${p.id}`} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-raised"><Avatar id={p.id} name={p.name} size={26} /><div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{p.name}</div><div className="truncate text-xs text-muted">{[p.jobTitle, p.email].filter(Boolean).join(' · ')}</div></div>{p.portal && <Chip tone="good">Portal</Chip>}</Link>)}</Panel></div></div>
  </div>;
}
