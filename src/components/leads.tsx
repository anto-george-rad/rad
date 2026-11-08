'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Filter, Plus } from 'lucide-react';
import type { Lead } from '@/db/schema';
import { Button, Chip, Empty, Field, Modal, Segmented, Select, Tabs, useToast } from './ui';
import { useApp } from './app-context';
import { useForms } from './forms';
import { BulkActions, DataTable, InlineCell, Owner } from './records';
import { ImportButton } from './import-modal';
import { PageHeader } from './shell';
import { Pager, SearchBox, useListParams, ViewsMenu, type View } from './list-controls';
import * as A from '@/lib/actions';
import { daysSince, fmtDate, fullName } from '@/lib/utils';
import { DISQUAL_REASONS, EMIRATES } from '@/lib/options';

export const STATUS_TONE: Record<string, 'neutral' | 'good' | 'bad' | 'accent' | 'warn'> = { New: 'accent', Contacted: 'warn', Qualified: 'good', Unqualified: 'bad', Converted: 'neutral' };
export function ScoreChip({ score, hot, warm }: { score: number; hot: number; warm: number }) {
  return score >= hot ? <Chip tone="bad">Hot {score}</Chip> : score >= warm ? <Chip tone="warn">Warm {score}</Chip> : <Chip>Cold {score}</Chip>;
}
/** Age of an open lead, coloured when nobody has contacted it yet. */
export function AgeChip({ l }: { l: Lead }) {
  if (['Converted', 'Unqualified'].includes(l.status)) return <span className="text-faint">—</span>;
  const d = daysSince(l.createdAt);
  return <Chip tone={!l.firstContactedAt && d >= 3 ? 'bad' : !l.firstContactedAt && d >= 1 ? 'warn' : 'neutral'}>{d === 0 ? 'Today' : `${d}d`}{!l.firstContactedAt && ' · not contacted'}</Chip>;
}
type L = Lead & { score: number };
export default function LeadsView({ leads, hot, warm, total, page, size, counts, views, sources }: { leads: L[]; hot: number; warm: number; total: number; page: number; size: number; counts: Record<string, number>; views: View[]; sources: string[] }) {
  const { me, users } = useApp(); const openForm = useForms(); const toast = useToast(); const router = useRouter(); const lp = useListParams();
  const [statusFor, setStatusFor] = useState<string[] | null>(null); const [st, setSt] = useState('Contacted'); const [why, setWhy] = useState('');
  const tab = lp.get('tab') || 'open';
  const mayEdit = (l: Lead) => me.role !== 'rep' || !l.ownerId || l.ownerId === me.id;
  return <>
    <PageHeader title="Leads" sub="New people and companies to qualify. Convert the good ones into contacts and deals."
      actions={<>{me.role !== 'rep' && <><ImportButton entity="lead" /><a href="/api/export/leads"><Button><Download size={15} />Export</Button></a></>}<Button variant="primary" onClick={() => openForm('lead')}><Plus size={16} />New lead</Button></>} />
    <Tabs value={tab} onChange={(t) => lp.set({ tab: t === 'open' ? '' : t })} tabs={[['open', 'Open', counts.open || 0], ['New', 'New', counts.New || 0], ['Contacted', 'Contacted', counts.Contacted || 0], ['Qualified', 'Qualified', counts.Qualified || 0], ['Unqualified', 'Unqualified', counts.Unqualified || 0], ['Converted', 'Converted', counts.Converted || 0], ['all', 'All', counts.all || 0]]} />
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <SearchBox placeholder="Search name, company, email, phone" />
      <Segmented value={lp.get('mine') ? 'mine' : 'all'} onChange={(v) => lp.set({ mine: v === 'mine' ? 1 : '' })} options={[['all', 'Everyone'], ['mine', 'Mine']]} />
      <Select className="h-9 w-auto" value={lp.get('source')} onChange={(e) => lp.set({ source: e.target.value })} aria-label="Source"><option value="">Any source</option>{sources.map((x) => <option key={x}>{x}</option>)}</Select>
      <Select className="h-9 w-auto" value={lp.get('emirate')} onChange={(e) => lp.set({ emirate: e.target.value })} aria-label="Emirate"><option value="">Any emirate</option>{EMIRATES.map((x) => <option key={x}>{x}</option>)}</Select>
      <ViewsMenu page="leads" views={views} />
    </div>
    <DataTable rows={leads} href={(l) => `/leads/${l.id}`} selectable serverSort={lp.sort || ['added', -1]} onSort={lp.onSort}
      empty={<Empty icon={<Filter />} title="No leads here" action={<Button variant="primary" onClick={() => openForm('lead')}>Add a lead</Button>}>{lp.get('q') ? 'Nothing matches that search.' : 'Add one, or import a CSV from your website forms or event lists.'}</Empty>}
      bulk={(ids, clear) => <BulkActions entity="lead" ids={ids} clear={clear} extra={<Button size="sm" onClick={() => setStatusFor(ids)}>Set status</Button>} />}
      cols={[
        { key: 'name', label: 'Name', cell: (l) => <div><div className="font-semibold">{fullName(l)}{l.doNotContact && <Chip tone="bad" className="ml-1.5">Do not contact</Chip>}</div>{l.jobTitle && <div className="text-xs text-muted">{l.jobTitle}</div>}</div>, sort: () => 0 },
        { key: 'company', label: 'Company', cell: (l) => <InlineCell entity="lead" id={l.id} field="companyName" value={l.companyName} canEdit={mayEdit(l)} />, sort: () => 0 },
        { key: 'score', label: 'Score', cell: (l) => <ScoreChip score={l.score} hot={hot} warm={warm} />, sort: () => 0 },
        { key: 'status', label: 'Status', cell: (l) => l.status === 'Converted' ? <Chip tone="neutral">Converted</Chip> : <InlineCell entity="lead" id={l.id} field="status" kind="select" value={l.status} display={<Chip tone={STATUS_TONE[l.status]}>{l.status}</Chip>} canEdit={mayEdit(l)} options={['New', 'Contacted', 'Qualified'].concat(l.status === 'Unqualified' ? ['Unqualified'] : []).map((x) => [x, x])} />, sort: () => 0 },
        { key: 'source', label: 'Source', cell: (l) => l.source || <span className="text-faint">—</span>, sort: () => 0 },
        { key: 'age', label: 'Age', cell: (l) => <AgeChip l={l} /> },
        { key: 'owner', label: 'Owner', cell: (l) => <InlineCell entity="lead" id={l.id} field="ownerId" kind="select" value={l.ownerId} display={<Owner id={l.ownerId} />} canEdit={me.role !== 'rep'} options={users.filter((u) => u.active || u.id === l.ownerId).map((u) => [u.id, u.name])} />, sort: () => 0 },
        { key: 'added', label: 'Added', cell: (l) => <span className="text-muted">{fmtDate(l.createdAt)}</span>, sort: () => 0 },
      ]} />
    <Pager page={page} size={size} total={total} />
    <Modal open={!!statusFor} onClose={() => setStatusFor(null)} title="Set lead status" sub={`${statusFor?.length} selected`}
      footer={<><Button variant="ghost" onClick={() => setStatusFor(null)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await A.setLeadStatus(statusFor!, st as Lead['status'], why || undefined); if (!r.ok) return toast(r.error, 'bad'); setStatusFor(null); toast('Status updated'); r.ran.forEach((n) => toast(`Automation ran: ${n}`)); router.refresh(); }}>Update</Button></>}>
      <div className="grid gap-3 pb-3 sm:grid-cols-2">
        <Field label="Status"><Select value={st} onChange={(e) => setSt(e.target.value)}>{['New', 'Contacted', 'Qualified', 'Unqualified'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        {st === 'Unqualified' && <Field label="Reason" required><Select value={why} onChange={(e) => setWhy(e.target.value)}><option value="">—</option>{DISQUAL_REASONS.map((x) => <option key={x}>{x}</option>)}</Select></Field>}
      </div>
    </Modal>
  </>;
}
