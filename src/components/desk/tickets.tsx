'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Download, Inbox, Plus } from 'lucide-react';
import type { TicketRow } from '@/lib/ticket-list';
import { Avatar, Button, Chip, ConfirmButton, Empty, Field, Modal, Select, useToast } from '../ui';
import { useApp } from '../app-context';
import { useForms } from '../forms';
import { DataTable } from '../records';
import { PageHeader } from '../shell';
import { Pager, SearchBox, useListParams, ViewsMenu, type View } from '../list-controls';
import * as D from '@/lib/desk-actions';
import * as DX from '@/lib/desk-ext-actions';
import { ImportButton } from '../import-modal';
import { RecordPicker } from '../record-picker';
import { CHANNEL_LABEL, PRIORITIES, TICKET_CHANNELS } from '@/lib/options';
import { cn, timeAgo } from '@/lib/utils';
import { PriorityChip, SlaChip, StatusChip, useTag } from './bits';

const VIEW_LABELS: [string, string][] = [['open', 'All open'], ['mine', 'My open tickets'], ['unassigned', 'Unassigned'], ['overdue', 'Overdue'], ['today', 'Due today'], ['onhold', 'On hold'], ['escalated', 'Escalated'], ['team', 'My teams'], ['watching', 'Following'], ['closed', 'Closed'], ['all', 'All tickets'], ['spam', 'Spam']];

export default function TicketsView({ rows, total, page, size, counts, views }: { rows: TicketRow[]; total: number; page: number; size: number; counts: Record<string, number>; views: View[] }) {
  const { me, desk } = useApp(); const lp = useListParams(); const openForm = useForms(); const tag = useTag();
  const v = lp.get('v') || 'open'; const isAdmin = me.deskRole === 'admin'; const light = me.deskRole === 'light';
  const viewList = VIEW_LABELS.filter(([k]) => (k !== 'spam' || isAdmin) && (k !== 'team' || (desk?.myTeamIds.length || 0) > 0) && (k !== 'mine' || !light));
  return <>
    <PageHeader title="Tickets" sub={`${total} ${total === 1 ? 'ticket' : 'tickets'} in “${VIEW_LABELS.find((x) => x[0] === v)?.[1] || 'All open'}”`}
      actions={<><ImportButton entity="ticket" />{(me.deskRole === 'admin' || (me.deskRole === 'agent' && me.role !== 'rep')) && <a href="/api/export/tickets"><Button><Download size={15} />Export</Button></a>}{!light && <Button variant="primary" onClick={() => openForm('ticket')}><Plus size={16} />New ticket</Button>}</>} />
    <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="Ticket views" className="hidden flex-col gap-0.5 lg:flex">
        {viewList.map(([k, l]) => <button key={k} onClick={() => lp.set({ v: k === 'open' ? '' : k })} aria-current={v === k ? 'page' : undefined}
          className={cn('flex items-center rounded-lg px-3 py-2 text-left text-[13px] font-medium transition', v === k ? 'bg-surface font-semibold shadow-card' : 'text-muted hover:bg-sunken hover:text-ink')}>
          <span className="flex-1">{l}</span>{counts[k] != null && <span className={cn('num text-[11px]', k === 'overdue' && counts[k] ? 'font-bold text-bad' : 'text-muted')}>{counts[k]}</span>}</button>)}
      </nav>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select className="h-9 w-auto lg:hidden" value={v} onChange={(e) => lp.set({ v: e.target.value === 'open' ? '' : e.target.value })} aria-label="View">{viewList.map(([k, l]) => <option key={k} value={k}>{l}{counts[k] != null ? ` (${counts[k]})` : ''}</option>)}</Select>
          <SearchBox placeholder="Search subject, requester or #number" />
          {(desk?.departments.length || 0) > 1 && <Select className="h-9 w-auto" value={lp.get('dept')} onChange={(e) => lp.set({ dept: e.target.value })} aria-label="Department"><option value="">All departments</option>{desk!.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
          <Select className="h-9 w-auto" value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} aria-label="Status"><option value="">Any status</option>{desk?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select className="h-9 w-auto" value={lp.get('priority')} onChange={(e) => lp.set({ priority: e.target.value })} aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select>
          <Select className="h-9 w-auto" value={lp.get('assignee')} onChange={(e) => lp.set({ assignee: e.target.value })} aria-label="Assignee"><option value="">Anyone</option><option value="none">Unassigned</option>{desk?.agents.filter((a) => a.deskRole !== 'light' && a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select className="h-9 w-auto" value={lp.get('channel')} onChange={(e) => lp.set({ channel: e.target.value })} aria-label="Channel"><option value="">Any channel</option>{TICKET_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select>
          <ViewsMenu page="tickets" views={views} />
        </div>
        <DataTable rows={rows} href={(t) => `/desk/tickets/${t.id}`} selectable={!light} serverSort={lp.sort || ['updated', -1]} onSort={lp.onSort}
          bulk={(ids, clear) => <TicketBulk ids={ids} clear={clear} rows={rows} />}
          empty={<Empty icon={<Inbox />} title={lp.sp.toString() ? 'No tickets match' : 'No open tickets'} action={!light ? <Button variant="primary" onClick={() => openForm('ticket')}>New ticket</Button> : undefined}>{lp.sp.toString() ? 'Try another view or clear the filters.' : 'New requests from email, the web form and the portal appear here.'}</Empty>}
          cols={[
            { key: 'subject', label: 'Ticket', sort: () => 0, cell: (t) => <div className="min-w-[260px] max-w-[460px]"><div className="flex items-center gap-2"><span className="num text-[11.5px] text-muted">{tag(t.number)}</span>{t.escalated && t.statusCategory !== 'closed' && <Chip tone="bad">Escalated</Chip>}{t.lastCustomerReplyAt && (!t.lastAgentReplyAt || +new Date(t.lastCustomerReplyAt) > +new Date(t.lastAgentReplyAt)) && t.statusCategory !== 'closed' && <Chip tone="accent">Customer replied</Chip>}</div>
              <div className="truncate font-semibold">{t.subject}</div><div className="truncate text-xs text-muted">{[t.contactName || t.requesterName || t.requesterEmail, t.companyName].filter(Boolean).join(' · ') || 'No requester'}</div></div> },
            { key: 'status', label: 'Status', cell: (t) => <StatusChip name={t.statusName} category={t.statusCategory} /> },
            { key: 'priority', label: 'Priority', sort: () => 0, cell: (t) => <PriorityChip p={t.priority} /> },
            { key: 'assignee', label: 'Assignee', cell: (t) => t.assigneeId ? <span className="inline-flex items-center gap-2 whitespace-nowrap"><Avatar id={t.assigneeId} name={t.assigneeName || '?'} size={22} /><span className="text-[13px]">{t.assigneeId === me.id ? 'You' : t.assigneeName}</span></span> : <Chip tone="warn">Unassigned</Chip> },
            { key: 'due', label: 'SLA', sort: () => 0, cell: (t) => <SlaChip due={t.firstRespondedAt || !t.firstResponseDueAt ? t.dueAt : t.firstResponseDueAt} label={t.firstRespondedAt || !t.firstResponseDueAt ? 'Due' : 'Reply'} breached={t.breachedAt || t.frBreachedAt} category={t.statusCategory} /> },
            { key: 'dept', label: 'Department', cell: (t) => <span className="text-[13px] text-muted">{t.deptName}</span> },
            { key: 'updated', label: 'Updated', sort: () => 0, cell: (t) => <span className="whitespace-nowrap text-[13px] text-muted">{timeAgo(t.updatedAt)}</span> },
          ]} />
        <Pager page={page} size={size} total={total} />
      </div>
    </div>
  </>;
}

function TicketBulk({ ids, clear, rows }: { ids: string[]; clear: () => void; rows: TicketRow[] }) {
  const { me, desk } = useApp(); const toast = useToast(); const router = useRouter(); const tag = useTag();
  const [mode, setMode] = useState<'' | 'assign' | 'status' | 'priority' | 'dept' | 'merge' | 'incident'>(''); const [val, setVal] = useState('');
  const after = (r: D.TicketBulkResult | { ok: false; error: string }, msg: string) => { if (!r.ok) return toast(r.error, 'bad'); toast(r.skipped ? `${msg} · ${r.skipped} skipped (no permission)` : msg); clear(); setMode(''); router.refresh(); };
  const apply = async () => {
    if (mode === 'assign') return after(await D.bulkUpdateTickets(ids, { assigneeId: val || null }), 'Assigned');
    if (mode === 'status') return after(await D.bulkUpdateTickets(ids, { statusId: val }), 'Status updated');
    if (mode === 'priority') return after(await D.bulkUpdateTickets(ids, { priority: val }), 'Priority updated');
    if (mode === 'dept') return after(await D.bulkUpdateTickets(ids, { departmentId: val }), 'Moved');
    if (mode === 'incident') { const r = await DX.linkToIncident(ids, val); if (!r.ok) return toast(r.error, 'bad'); toast(`Linked ${r.linked} ticket${r.linked === 1 ? '' : 's'}`); clear(); setMode(''); router.refresh(); return; }
    if (mode === 'merge') { const r = await D.mergeTickets(val, ids.filter((x) => x !== val)); if (!r.ok) return toast(r.error, 'bad'); toast('Merged'); clear(); setMode(''); router.push(`/desk/tickets/${val}`); }
  };
  const agentsOk = (desk?.agents || []).filter((a) => a.active && a.deskRole !== 'light');
  return <>
    <Button size="sm" onClick={() => { setMode('assign'); setVal(me.id); }}>Assign</Button>
    <Button size="sm" onClick={() => { setMode('status'); setVal(desk?.statuses[0]?.id || ''); }}>Status</Button>
    <Button size="sm" onClick={() => { setMode('priority'); setVal('High'); }}>Priority</Button>
    {(desk?.departments.length || 0) > 1 && <Button size="sm" onClick={() => { setMode('dept'); setVal(desk!.departments[0].id); }}>Move</Button>}
    {ids.length > 1 && <Button size="sm" onClick={() => { setMode('merge'); setVal(ids[0]); }}>Merge</Button>}
    <Button size="sm" onClick={() => { setMode('incident'); setVal(rows.find((r) => ids.includes(r.id) && r.isIncident)?.id || ''); }}>Link to incident</Button>
    <Button size="sm" onClick={async () => after(await D.bulkUpdateTickets(ids, { spam: true }), 'Marked as spam')}>Spam</Button>
    {me.deskRole === 'admin' && <ConfirmButton size="sm" variant="secondary" confirmText={`Delete ${ids.length}?`} onConfirm={async () => { const r = await D.deleteTickets(ids); if (!r.ok) toast(r.error, 'bad'); else { toast('Moved to recycle bin'); clear(); router.refresh(); } }}>Delete</ConfirmButton>}
    <Modal open={!!mode} onClose={() => setMode('')} title={{ assign: 'Assign tickets', status: 'Change status', priority: 'Change priority', dept: 'Move to department', merge: 'Merge tickets', incident: 'Link to a major incident', '': '' }[mode]} sub={mode === 'merge' ? 'Conversations, files and time move into the ticket you keep. The others close as merged.' : `${ids.length} selected. Tickets you can’t change are skipped.`}
      footer={<><Button variant="ghost" onClick={() => setMode('')}>Cancel</Button><Button variant="primary" onClick={apply}>Apply</Button></>}>
      <div className="pb-3">
        {mode === 'assign' && <Field label="Assign to" hint="Only agents in each ticket’s department can receive it"><Select value={val} onChange={(e) => setVal(e.target.value)}><option value="">Unassigned</option>{agentsOk.map((a) => <option key={a.id} value={a.id}>{a.name}{a.available ? '' : ' (away)'}</option>)}</Select></Field>}
        {mode === 'status' && <Field label="Status"><Select value={val} onChange={(e) => setVal(e.target.value)}>{desk?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        {mode === 'priority' && <Field label="Priority"><Select value={val} onChange={(e) => setVal(e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>}
        {mode === 'dept' && <Field label="Department"><Select value={val} onChange={(e) => setVal(e.target.value)}>{desk?.departments.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>}
        {mode === 'incident' && <Field label="Major incident" hint="Updates posted on the incident can go to every linked ticket at once"><RecordPicker type="ticket" value={val} onChange={(id) => setVal(id)} placeholder="Search the incident ticket by number or subject" ariaLabel="Major incident" /></Field>}
        {mode === 'merge' && <Field label="Keep this ticket" hint="The others are merged into it"><Select value={val} onChange={(e) => setVal(e.target.value)}>{ids.map((id) => { const r = rows.find((x) => x.id === id); return <option key={id} value={id}>{r ? `${tag(r.number)} ${r.subject}` : id}</option>; })}</Select></Field>}
      </div>
    </Modal>
  </>;
}
