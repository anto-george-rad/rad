'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon, ArrowLeft, Bell, BellOff, BookOpen, Building2, Clock, Copy, FileSignature, GitBranch, Lock, Mail, MessageSquare, MoreHorizontal, Paperclip, Phone, Scissors, Send, Sparkles, Timer, Truck, User, Users, X } from 'lucide-react';
import type { Attachment, Ticket, TicketEventRow, TicketThread, TicketTime, Team } from '@/db/schema';
import { Avatar, Button, Chip, ConfirmButton, Field, IconButton, Input, Menu, Modal, Panel, Select, Textarea, useToast } from '../ui';
import { useApp } from '../app-context';
import { AttachmentsPanel, FavoriteStar, rememberRecent } from '../records';
import { RecordPicker } from '../record-picker';
import * as D from '@/lib/desk-actions';
import * as DX from '@/lib/desk-ext-actions';
import { CHANNEL_LABEL, PRIORITIES, VENDOR_STATUSES } from '@/lib/options';
import { cn, fmtDate, fmtMoney, tagsOf, timeAgo, todayISO } from '@/lib/utils';
import { PriorityChip, SlaChip, StatusChip, useTag } from './bits';

type Lite = { id: string; number: number; subject: string; statusCategory: string };
type Props = {
  ticket: Ticket; threads: TicketThread[]; events: TicketEventRow[]; time: TicketTime[]; watching: boolean; files: Attachment[]; fav: boolean;
  contact: { id: string; name: string; email: string | null; phone: string | null; jobTitle: string | null; portalEnabled: boolean; portalLastLogin: Date | null; doNotContact: boolean } | null;
  company: { id: string; name: string; tier: string | null; accountType: string } | null;
  related: (Lite & { parentId: string | null; mergedIntoId: string | null })[]; others: (Lite & { createdAt: Date })[]; deals: { id: string; name: string; amount: number | null; currency: string }[];
  policyName: string | null; canWork: boolean; assignable: { id: string; name: string; available: boolean }[]; canUnassign: boolean; teams: Team[]; userNames: Record<string, string>;
  contract: { id: string; name: string; tier: string; endDate: string; hoursIncluded: number | null; hours: number; usedPct: number | null } | null; lapsedContract: string | null;
  incident: { master: Lite | null; linked: Lite[] }; aiOn: boolean;
};
const dt = (v: Date | string | null) => v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export default function TicketDetail(p: Props) {
  const t = p.ticket; const { me, desk, settings, products } = useApp(); const toast = useToast(); const router = useRouter(); const tag = useTag();
  const st = desk?.statuses.find((s) => s.id === t.statusId); const dept = desk?.departments.find((d) => d.id === t.departmentId);
  const [others, setOthers] = useState<{ userId: string; name: string; replying: boolean }[]>([]); const [replying, setReplying] = useState(false);
  const [stale, setStale] = useState(false); const loadedAt = useRef(+new Date(t.updatedAt));
  const [merge, setMerge] = useState(false); const [mergeId, setMergeId] = useState('');
  const run = async (r: Promise<{ ok: boolean; error?: string }>, ok?: string) => { const x = await r; if (!x.ok) { toast(x.error || 'Failed', 'bad'); return false; } if (ok) toast(ok); router.refresh(); return true; };
  const upd = (patch: D.TicketPatch, ok = 'Saved') => run(D.updateTicket(t.id, patch), ok);
  useEffect(() => { rememberRecent({ type: 'ticket', id: t.id, label: `${tag(t.number)} ${t.subject}`, href: `/desk/tickets/${t.id}` }); }, [t.id, t.number, t.subject]); // eslint-disable-line react-hooks/exhaustive-deps
  // Collision detection: tell others I'm here, see who else is, and notice if the ticket changed underneath me.
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch('/api/desk/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticketId: t.id, replying }) });
        if (r.ok && alive) { const j = await r.json(); setOthers(j.others); if (+new Date(j.updatedAt) > loadedAt.current + 1000) setStale(true); }
      } catch { /* offline */ }
    };
    ping(); const iv = setInterval(ping, 15_000);
    return () => { alive = false; clearInterval(iv); navigator.sendBeacon?.('/api/desk/presence', new Blob([JSON.stringify({ ticketId: t.id, leave: true })], { type: 'application/json' })); };
  }, [t.id, replying]);
  useEffect(() => { loadedAt.current = +new Date(t.updatedAt); setStale(false); }, [t.updatedAt]);
  const timeline = useMemo(() => [...p.threads], [p.threads]);
  const totalMin = p.time.reduce((s, x) => s + x.minutes, 0);
  const canTake = p.canWork && !t.assigneeId && p.assignable.some((a) => a.id === me.id);
  return <div className="flex flex-col gap-4">
    <Link href="/desk/tickets" className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />Tickets</Link>
    {t.mergedIntoId && <div className="rounded-xl bg-sunken px-4 py-2.5 text-[13px]">This ticket was merged. <Link className="font-semibold text-accent hover:underline" href={`/desk/tickets/${t.mergedIntoId}`}>Open the ticket it was merged into</Link></div>}
    {others.length > 0 && <div role="status" className={cn('flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium', others.some((o) => o.replying) ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}><Users size={15} />
      {others.map((o) => o.name).join(', ')} {others.some((o) => o.replying) ? `${others.length > 1 ? 'are' : 'is'} writing a reply right now — check before you answer.` : `${others.length > 1 ? 'are' : 'is'} also viewing this ticket.`}</div>}
    {p.incident.master && <div className="flex items-center gap-2 rounded-xl bg-bad-soft px-4 py-2.5 text-[13px] text-bad"><AlertOctagon size={15} />Part of major incident <Link className="font-semibold underline" href={`/desk/tickets/${p.incident.master.id}`}>{tag(p.incident.master.number)} {p.incident.master.subject}</Link> — updates sent there reach this customer too.</div>}
    {!p.contract && p.lapsedContract && t.statusCategory !== 'closed' && <div className="flex items-center gap-2 rounded-xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn"><FileSignature size={15} />This customer’s support contract ended {fmtDate(p.lapsedContract)}. Check with the account owner before doing chargeable work.</div>}
    {stale && <div className="flex items-center gap-3 rounded-xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn">Someone updated this ticket while you had it open.<Button size="sm" onClick={() => router.refresh()}>Show latest</Button></div>}
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{tag(t.number)} · {dept?.name} · {CHANNEL_LABEL[t.channel] || t.channel}</p>
        <EditableTitle value={t.subject} canEdit={p.canWork} onSave={(v) => upd({ subject: v })} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {st && <StatusChip name={st.name} category={st.category} />}<PriorityChip p={t.priority} />
          <SlaChip due={t.firstRespondedAt || !t.firstResponseDueAt ? t.dueAt : t.firstResponseDueAt} label={t.firstRespondedAt || !t.firstResponseDueAt ? 'Due' : 'First reply'} breached={t.breachedAt || t.frBreachedAt} category={t.statusCategory} />
          {t.escalated && t.statusCategory !== 'closed' && <Chip tone="bad">Escalated{t.escalationLevel ? ` · level ${t.escalationLevel}` : ''}</Chip>}{t.isSpam && <Chip tone="bad">Spam</Chip>}
          {t.isIncident && <Chip tone="bad"><AlertOctagon size={12} className="mr-1 inline" />Major incident · {p.incident.linked.length} linked</Chip>}
          {t.sentiment === 'negative' && t.statusCategory !== 'closed' && <Chip tone="bad">Customer frustrated</Chip>}{t.language && t.language !== 'English' && <Chip tone="outline">{t.language}</Chip>}
          {t.vendorStatus && <Chip tone="warn"><Truck size={12} className="mr-1 inline" />{t.vendorName}{t.vendorCaseNo ? ` #${t.vendorCaseNo}` : ''} · {t.vendorStatus}</Chip>}
          {t.rating && <Chip tone={t.rating === 'good' ? 'good' : t.rating === 'bad' ? 'bad' : 'warn'}>Rated {t.rating === 'good' ? 'great' : t.rating === 'ok' ? 'okay' : 'not good'}</Chip>}
          {t.tags.map((x) => <Chip key={x} tone="outline">{x}</Chip>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <FavoriteStar type="ticket" id={t.id} label={`${tag(t.number)} ${t.subject}`} on={p.fav} />
        <IconButton label={p.watching ? 'Stop following' : 'Follow (get notified)'} className="h-9 w-9 border border-line bg-surface" onClick={() => run(D.toggleWatch(t.id), p.watching ? 'Unfollowed' : 'Following')}>{p.watching ? <BellOff size={16} /> : <Bell size={16} />}</IconButton>
        {p.aiOn && <Summarise ticketId={t.id} />}
        {canTake && <Button variant="primary" onClick={() => run(D.takeTicket(t.id), 'Assigned to you')}>Take it</Button>}
        {p.canWork && t.statusCategory !== 'closed' && <Button onClick={() => { const r = desk?.statuses.find((s) => s.category === 'closed' && !/^closed/i.test(s.name)) || desk?.statuses.find((s) => s.category === 'closed'); if (r) upd({ statusId: r.id }, 'Resolved'); }}>Resolve</Button>}
        {p.canWork && <Menu trigger={(o) => <IconButton label="More actions" className="h-9 w-9 border border-line bg-surface" onClick={o}><MoreHorizontal size={16} /></IconButton>}
          items={[['Clone ticket', async () => { const r = await D.cloneTicket(t.id); if (r.ok) router.push(`/desk/tickets/${r.id}`); else toast(r.error, 'bad'); }],
            ['Create child ticket', async () => { const r = await D.cloneTicket(t.id, true); if (r.ok) router.push(`/desk/tickets/${r.id}`); else toast(r.error, 'bad'); }],
            ['Merge into another ticket…', () => setMerge(true)],
            ...(!t.incidentId ? [[t.isIncident ? 'Not a major incident' : 'Mark as major incident', () => run(DX.setMajorIncident(t.id, !t.isIncident), t.isIncident ? 'Updated' : 'Marked as major incident — link affected tickets from the ticket list')] as [string, () => void]] : [['Unlink from major incident', () => run(DX.linkToIncident([t.id], null), 'Unlinked')] as [string, () => void]]),
            ...(me.crmAccess && !t.dealId ? [['Create sales opportunity', async () => { const r = await D.ticketToDeal(t.id); if (r.ok) { toast('Deal created'); router.push(`/deals/${r.id}`); } else toast(r.error, 'bad'); }] as [string, () => void]] : []),
            ...(!t.assigneeId ? [['Auto-assign now', () => run(D.autoAssignNow(t.id), 'Assigned')] as [string, () => void]] : []),
            null, [t.isSpam ? 'Not spam' : 'Mark as spam', () => run(D.bulkUpdateTickets([t.id], { spam: !t.isSpam }), t.isSpam ? 'Restored' : 'Marked as spam')],
            ...(me.deskRole === 'admin' ? [['Delete ticket', async () => { const r = await D.deleteTickets([t.id]); if (r.ok) { toast('Moved to recycle bin'); router.push('/desk/tickets'); } else toast(r.error, 'bad'); }, 'danger'] as [string, () => void, 'danger']] : [])]} />}
      </div>
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="panel">
          <header className="panel-h"><h3 className="panel-t">Conversation</h3><Chip>{timeline.length}</Chip></header>
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            {t.description && !timeline.some((x) => x.body.trim() === t.description?.trim()) && <Message kind="incoming" who={t.requesterName || t.requesterEmail || 'Customer'} at={t.createdAt} body={t.description} />}
            {timeline.map((m) => <Message key={m.id} files={p.files.filter((f) => m.attachmentIds?.includes(f.id))} kind={m.kind} who={m.kind === 'incoming' ? (m.fromName || m.fromEmail || 'Customer') : m.authorId ? p.userNames[m.authorId] || m.fromName || 'Agent' : m.fromName || 'System'} at={m.createdAt} body={m.body}
              meta={m.kind === 'reply' ? [m.to && `To ${m.to}`, m.cc && `Cc ${m.cc}`, m.delivery && m.delivery !== 'sent' ? (m.delivery === 'email not set up' ? 'Not emailed — email isn’t set up (visible in portal)' : /whatsapp/i.test(m.delivery) ? m.delivery : `Email ${m.delivery}`) : null].filter(Boolean).join(' · ') : m.fromEmail && m.kind === 'incoming' ? m.fromEmail : undefined}
              onSplit={p.canWork && m.kind === 'incoming' ? async () => { const r = await D.splitTicket(m.id); if (r.ok) { toast('New ticket created'); router.push(`/desk/tickets/${r.id}`); } else toast(r.error, 'bad'); } : undefined} />)}
            {!timeline.length && !t.description && <p className="text-[13px] text-muted">No messages yet.</p>}
          </div>
          {!t.mergedIntoId && <Composer t={t} canReply={p.canWork} onTyping={setReplying} contactDnc={!!p.contact?.doNotContact} linked={t.isIncident ? p.incident.linked.filter((x) => x.statusCategory !== 'closed').length : 0} aiOn={p.aiOn} />}
        </section>
        <AttachmentsPanel items={p.files} relatedType="ticket" relatedId={t.id} />
        <Panel title="History" bodyClass="p-5">
          <ol className="relative flex flex-col gap-3 border-l border-line pl-5">{p.events.slice(0, 40).map((e) => <li key={e.id} className="relative">
            <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-faint ring-4 ring-surface" />
            <div className="text-[13px]">{e.text}</div><div className="text-xs text-muted">{timeAgo(e.at)} · {e.userId ? p.userNames[e.userId] || 'Former user' : 'System'}</div></li>)}</ol>
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Properties" bodyClass="grid gap-3 p-5">
          {!p.canWork && <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-muted"><Lock size={12} className="mr-1 inline" />{me.deskRole === 'light' ? 'Light agents can read tickets and add private notes.' : 'You can view this ticket but not change it.'}</p>}
          <Prop label="Status"><Select disabled={!p.canWork} value={t.statusId} onChange={(e) => upd({ statusId: e.target.value }, 'Status updated')}>{(['open', 'onhold', 'closed'] as const).map((cat) => <optgroup key={cat} label={cat === 'onhold' ? 'On hold (SLA paused)' : cat === 'open' ? 'Open' : 'Closed'}>{desk?.statuses.filter((s) => s.category === cat).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}</Select></Prop>
          <Prop label="Priority"><Select disabled={!p.canWork} value={t.priority} onChange={(e) => upd({ priority: e.target.value }, 'Priority updated')}>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</Select></Prop>
          <Prop label="Assignee"><Select disabled={!p.canWork || (!p.assignable.length && !p.canUnassign)} value={t.assigneeId || ''} onChange={(e) => upd({ assigneeId: e.target.value || null }, e.target.value ? 'Assigned' : 'Unassigned')}>
            <option value="" disabled={!p.canUnassign && !!t.assigneeId}>Unassigned</option>
            {t.assigneeId && !p.assignable.some((a) => a.id === t.assigneeId) && <option value={t.assigneeId} disabled>{p.userNames[t.assigneeId] || 'Former user'}</option>}
            {p.assignable.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === me.id ? ' (you)' : ''}{a.available ? '' : ' · away'}</option>)}</Select></Prop>
          <Prop label="Department"><Select disabled={!p.canWork} value={t.departmentId} onChange={(e) => upd({ departmentId: e.target.value }, 'Moved')}>{desk?.departments.filter((d) => d.active || d.id === t.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Prop>
          {p.teams.length > 0 && <Prop label="Team"><Select disabled={!p.canWork} value={t.teamId || ''} onChange={(e) => upd({ teamId: e.target.value || null })}><option value="">No team</option>{p.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Prop>}
          <div className="grid grid-cols-2 gap-3">
            <Prop label="Type"><Select disabled={!p.canWork} value={t.type || ''} onChange={(e) => upd({ type: e.target.value || null })}><option value="">—</option>{settings.ticketTypes.map((x) => <option key={x}>{x}</option>)}</Select></Prop>
            <Prop label="Category"><Select disabled={!p.canWork} value={t.category || ''} onChange={(e) => upd({ category: e.target.value || null })}><option value="">—</option>{settings.ticketCategories.map((x) => <option key={x}>{x}</option>)}</Select></Prop>
          </div>
          <Prop label="Product"><Select disabled={!p.canWork} value={t.productId || ''} onChange={(e) => upd({ productId: e.target.value || null })}><option value="">—</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Prop>
          <Prop label="Tags"><Input disabled={!p.canWork} defaultValue={t.tags.join(', ')} onBlur={(e) => { if (tagsOf(e.target.value).join() !== t.tags.join()) upd({ tags: e.target.value }); }} placeholder="Comma separated" /></Prop>
        </Panel>

        <Panel title={<span className="inline-flex items-center gap-2"><Timer size={15} />SLA</span>} bodyClass="grid gap-2 p-5 text-[13px]">
          <Row k="Policy" v={p.policyName || 'No SLA applies'} />
          <Row k="First response" v={t.firstRespondedAt ? <span className={t.frBreachedAt ? 'text-bad' : 'text-good'}>{t.frBreachedAt ? 'Late' : 'Met'} · {dt(t.firstRespondedAt)}</span> : t.firstResponseDueAt ? <span className={t.frBreachedAt ? 'font-semibold text-bad' : ''}>Due {dt(t.firstResponseDueAt)}</span> : '—'} />
          <Row k="Resolution" v={t.resolvedAt ? <span className={t.breachedAt ? 'text-bad' : 'text-good'}>{t.breachedAt ? 'Late' : 'Met'} · {dt(t.resolvedAt)}</span> : t.dueAt ? <span className={t.breachedAt ? 'font-semibold text-bad' : ''}>Due {dt(t.dueAt)}</span> : '—'} />
          {t.statusCategory === 'onhold' && <p className="text-xs text-warn">Clock paused while on hold (since {dt(t.onHoldSince)}).</p>}
          {p.canWork && t.statusCategory !== 'closed' && <DueOverride value={t.dueAt} onSave={(v) => upd({ dueAt: v }, 'Due date changed')} />}
          <p className="text-xs text-muted">Created {dt(t.createdAt)}{t.reopenedCount ? ` · reopened ${t.reopenedCount}×` : ''}</p>
        </Panel>

        {p.contract && <Panel title={<span className="inline-flex items-center gap-2"><FileSignature size={15} />Support contract</span>} bodyClass="grid gap-1.5 p-5 text-[13px]">
          <Row k="Contract" v={<Link className="font-semibold text-accent hover:underline" href={`/desk/contracts?id=${p.contract.id}`}>{p.contract.name}</Link>} /><Row k="Tier" v={<Chip tone="accent">{p.contract.tier}</Chip>} /><Row k="Ends" v={fmtDate(p.contract.endDate)} />
          <Row k="Hours" v={p.contract.hoursIncluded ? `${p.contract.hours} of ${p.contract.hoursIncluded} used` : `${p.contract.hours} logged`} />
          {p.contract.usedPct != null && <div className="h-1.5 rounded-full bg-sunken"><div className={cn('h-full rounded-full', p.contract.usedPct >= 100 ? 'bg-bad' : p.contract.usedPct >= settings.lowHoursPct ? 'bg-warn' : 'bg-good')} style={{ width: `${Math.min(100, p.contract.usedPct)}%` }} /></div>}
        </Panel>}
        <VendorPanel t={t} canWork={p.canWork} />
        {t.isIncident && <Panel title={<span className="inline-flex items-center gap-2"><AlertOctagon size={15} className="text-bad" />Linked tickets</span>} count={p.incident.linked.length}>
          {p.incident.linked.map((r) => <Link key={r.id} href={`/desk/tickets/${r.id}`} className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[13px] last:border-0 hover:bg-raised"><span className="num text-xs text-muted">{tag(r.number)}</span><span className="min-w-0 flex-1 truncate">{r.subject}</span><Chip tone={r.statusCategory === 'closed' ? 'good' : 'accent'}>{r.statusCategory === 'closed' ? 'Closed' : 'Open'}</Chip></Link>)}
          {!p.incident.linked.length && <p className="px-5 py-4 text-[13px] text-muted">Select tickets in the ticket list and choose “Link to major incident”.</p>}</Panel>}
        <CustomerPanel t={t} contact={p.contact} company={p.company} others={p.others} deals={p.deals} canWork={p.canWork} />
        {t.handoffLeadId && me.crmAccess && <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[13px] text-accent">Sales was told about this request. <Link className="font-semibold underline" href={`/leads/${t.handoffLeadId}`}>Open the lead</Link></p>}

        <Panel title={<span className="inline-flex items-center gap-2"><Clock size={15} />Time spent</span>} count={totalMin ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : undefined} bodyClass="p-5">
          {p.canWork && <TimeLogger ticketId={t.id} />}
          <div className="mt-3 flex flex-col gap-2">{p.time.map((x) => <div key={x.id} className="flex items-center gap-2 text-[13px]"><span className="num w-14 font-semibold">{x.minutes}m</span><span className="min-w-0 flex-1 truncate text-muted">{x.note || '—'}{x.billable ? ' · billable' : ''}</span><span className="text-xs text-faint">{p.userNames[x.userId]?.split(' ')[0]} · {fmtDate(x.date)}</span>
            {(x.userId === me.id || me.deskRole === 'admin') && <ConfirmButton size="sm" className="h-6 px-1.5" confirmText="×?" onConfirm={() => run(D.deleteTime(x.id))}>×</ConfirmButton>}</div>)}</div>
        </Panel>

        {p.related.length > 0 && <Panel title={<span className="inline-flex items-center gap-2"><GitBranch size={15} />Related tickets</span>}>
          {p.related.map((r) => <Link key={r.id} href={`/desk/tickets/${r.id}`} className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[13px] last:border-0 hover:bg-raised"><span className="num text-xs text-muted">{tag(r.number)}</span><span className="min-w-0 flex-1 truncate">{r.subject}</span>
            <Chip>{r.id === t.parentId ? 'Parent' : r.parentId === t.id ? 'Child' : r.mergedIntoId === t.id ? 'Merged in' : 'Merged into'}</Chip></Link>)}
        </Panel>}
      </div>
    </div>

    <Modal open={merge} onClose={() => setMerge(false)} title="Merge into another ticket" sub="This ticket’s conversation, files and time move into the one you pick, and this ticket closes as merged."
      footer={<><Button variant="ghost" onClick={() => setMerge(false)}>Cancel</Button><Button variant="primary" disabled={!mergeId || mergeId === t.id} onClick={async () => { const r = await D.mergeTickets(mergeId, [t.id]); if (!r.ok) return toast(r.error, 'bad'); toast('Merged'); router.push(`/desk/tickets/${mergeId}`); }}>Merge</Button></>}>
      <div className="pb-24"><Field label="Ticket to keep"><RecordPicker type="ticket" value={mergeId} onChange={(id) => setMergeId(id)} placeholder="Search by number or subject" ariaLabel="Ticket to keep" /></Field></div>
    </Modal>
  </div>;
}

function EditableTitle({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState(value);
  if (edit) return <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { setEdit(false); if (v.trim() && v !== value) onSave(v); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); setEdit(false); } }} className="!h-auto !py-1 font-display !text-[24px] font-bold" />;
  return <h1 onClick={() => canEdit && setEdit(true)} title={canEdit ? 'Click to edit' : undefined} className={cn('font-display text-[26px] font-bold leading-tight tracking-tight', canEdit && 'cursor-text rounded-md hover:bg-sunken')}>{value}</h1>;
}
const Prop = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field">{<span>{label}</span>}{children}</label>;
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="text-right">{v}</span></div>;

function Message({ kind, who, at, body, meta, onSplit, files }: { kind: string; who: string; at: Date; body: string; meta?: string; onSplit?: () => void; files?: Attachment[] }) {
  const out = kind === 'reply'; const note = kind === 'note';
  return <article className={cn('group rounded-2xl border px-4 py-3', note ? 'border-warn/30 bg-warn-soft/60' : out ? 'ml-6 border-accent/25 bg-accent-soft/60' : 'mr-6 border-line bg-raised')}>
    <header className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold text-ink">{note ? <Lock size={12} /> : out ? <Send size={12} /> : <User size={12} />}{who}</span>
      <span className="text-muted">{note ? 'Private note' : out ? 'Reply' : 'Customer'} · {dt(at)}</span>{meta && <span className="text-muted">· {meta}</span>}
      {onSplit && <button onClick={onSplit} className="ml-auto inline-flex items-center gap-1 text-muted opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100"><Scissors size={12} />Split into new ticket</button>}
    </header>
    <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{body}</div>
    {!!files?.length && <div className="mt-2 flex flex-wrap gap-1.5">{files.map((f) => <a key={f.id} href={`/api/files/${f.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold hover:border-accent"><Paperclip size={12} />{f.fileName}</a>)}</div>}
  </article>;
}

function Composer({ t, canReply, onTyping, contactDnc, linked, aiOn }: { t: Ticket; canReply: boolean; onTyping: (b: boolean) => void; contactDnc: boolean; linked: number; aiOn: boolean }) {
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]); const [toLinked, setToLinked] = useState(linked > 0); const [uploading, setUploading] = useState(false); const [drafting, setDrafting] = useState(false);
  const { desk, me, settings } = useApp(); const toast = useToast(); const router = useRouter();
  const [kind, setKind] = useState<'reply' | 'note'>(canReply ? 'reply' : 'note'); const [body, setBody] = useState(''); const [cc, setCc] = useState(t.cc || ''); const [after, setAfter] = useState(''); const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState<{ canned: { id: string; name: string; body: string }[]; articles: { id: string; title: string; slug: string; visibility: string }[] } | null>(null);
  useEffect(() => { D.myCannedAndArticles(t.departmentId).then((r) => r.ok && setLib({ canned: r.canned, articles: r.articles })); }, [t.departmentId]);
  useEffect(() => { onTyping(!!body.trim()); }, [body, onTyping]);
  const fill = (s: string) => s.replace(/\{\{customer_name\}\}/g, t.requesterName?.split(' ')[0] || 'there').replace(/\{\{ticket_number\}\}/g, `${settings.ticketPrefix}-${1000 + t.number}`).replace(/\{\{subject\}\}/g, t.subject).replace(/\{\{agent_name\}\}/g, me.name);
  const waiting = desk?.statuses.find((s) => s.category === 'onhold'); const resolved = desk?.statuses.find((s) => s.category === 'closed' && !/^closed/i.test(s.name));
  const send = async () => {
    if (!body.trim() && !files.length) return; setBusy(true);
    const r = await D.replyTicket(t.id, { kind, body, cc: kind === 'reply' ? cc : undefined, statusId: after || undefined, attachmentIds: files.map((f) => f.id), toLinked: kind === 'reply' && toLinked && linked > 0 }); setBusy(false);
    if (!r.ok) return toast(r.error, 'bad');
    toast(kind === 'note' ? (r.notSeen.length ? `Note added · ${r.notSeen.join(', ')} can’t open this ticket, so wasn’t notified` : 'Note added') : r.delivery === 'sent' || r.delivery === 'sent via WhatsApp' ? (r.delivery === 'sent' ? 'Reply sent' : 'Reply sent on WhatsApp') : r.delivery === 'email not set up' ? 'Reply saved (email isn’t set up — the customer sees it in the portal)' : `Reply saved · ${r.delivery || 'no email address'}`);
    if (r.linked) toast(`Also sent to ${r.linked} linked ticket${r.linked === 1 ? '' : 's'}`);
    setBody(''); setAfter(''); setFiles([]); router.refresh();
  };
  const upload = async (fl: FileList | null) => {
    if (!fl?.length) return; setUploading(true);
    for (const f of Array.from(fl).slice(0, 10)) { const fd = new FormData(); fd.append('file', f); fd.append('relatedType', 'ticket'); fd.append('relatedId', t.id); const r = await fetch('/api/files', { method: 'POST', body: fd }).catch(() => null); const j = await r?.json().catch(() => null); if (!r?.ok) toast(j?.error || `Couldn’t upload ${f.name}`, 'bad'); else setFiles((x) => [...x, { id: j.id || j.file?.id, name: f.name }]); }
    setUploading(false);
  };
  const suggest = async () => { setDrafting(true); const r = await DX.aiSuggestReply(t.id); setDrafting(false); if (!r.ok) return toast(r.error, 'bad'); setKind('reply'); setBody(r.text); if (r.sources.length) toast(`Drafted from: ${r.sources.slice(0, 3).join(' · ')}`); };
  const agentNames = (desk?.agents || []).filter((a) => a.active && a.id !== me.id).map((a) => a.name);
  return <div className="border-t border-line p-4 sm:p-5">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div role="tablist" className="inline-flex gap-0.5 rounded-[10px] border border-line bg-sunken p-0.5">
        {canReply && <button role="tab" aria-selected={kind === 'reply'} onClick={() => setKind('reply')} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold', kind === 'reply' ? 'bg-surface shadow-sm' : 'text-muted')}><Mail size={13} />Reply to customer</button>}
        <button role="tab" aria-selected={kind === 'note'} onClick={() => setKind('note')} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold', kind === 'note' ? 'bg-surface shadow-sm' : 'text-muted')}><Lock size={13} />Private note</button>
      </div>
      {aiOn && canReply && <Button size="sm" variant="soft" disabled={drafting} onClick={suggest}><Sparkles size={13} />{drafting ? 'Drafting…' : 'Suggest reply'}</Button>}
      {lib && lib.canned.length > 0 && <Select className="!h-8 w-auto text-xs" value="" onChange={(e) => { const c = lib.canned.find((x) => x.id === e.target.value); if (c) setBody((b) => (b ? b + '\n\n' : '') + fill(c.body)); }} aria-label="Insert canned response"><option value="">Canned response…</option>{lib.canned.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
      {lib && lib.articles.length > 0 && <Select className="!h-8 w-auto text-xs" value="" onChange={(e) => { const a = lib.articles.find((x) => x.id === e.target.value); if (a) setBody((b) => `${b}${b ? '\n' : ''}${a.title}: ${location.origin}/portal/kb/${a.slug}`); }} aria-label="Insert help article"><option value="">Help article…</option>{lib.articles.filter((a) => a.visibility === 'public' || kind === 'note').map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select>}
    </div>
    {kind === 'reply' && <div className="mb-2 grid gap-2 text-[12.5px] sm:grid-cols-2"><div className="flex items-center gap-2 truncate text-muted">To <b className="truncate text-ink">{t.channel === 'whatsapp' && t.requesterPhone ? `${t.requesterPhone} on WhatsApp` : t.requesterEmail || 'no email — reply shows in the portal only'}</b></div><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc (optional)" className="!h-8 text-[12.5px]" /></div>}
    {kind === 'reply' && contactDnc && <p className="mb-2 rounded-lg bg-bad-soft px-3 py-1.5 text-xs text-bad">This contact is marked do-not-contact for sales. Support replies are fine; don’t include offers.</p>}
    <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'note' ? `Only your team sees this. Type @Name to notify a colleague${agentNames[0] ? ` (e.g. @${agentNames[0]})` : ''}.` : 'Write your reply…'}
      className={cn('min-h-[130px]', kind === 'note' && 'bg-warn-soft/40')} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} aria-label={kind === 'note' ? 'Private note' : 'Reply'} />
    {files.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{files.map((f) => <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold"><Paperclip size={12} />{f.name}<button aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} className="text-muted hover:text-bad"><X size={12} /></button></span>)}</div>}
    {kind === 'reply' && linked > 0 && <label className="mt-2 flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-1.5 text-[12.5px] text-bad"><input type="checkbox" checked={toLinked} onChange={(e) => setToLinked(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />Also send this update (and the status change) to the {linked} linked ticket{linked === 1 ? '' : 's'}</label>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12.5px] font-semibold', uploading && 'opacity-50')}><Paperclip size={14} />{uploading ? 'Uploading…' : 'Attach'}<input type="file" multiple className="sr-only" disabled={uploading} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
      <span className="hidden text-xs text-faint sm:inline">Ctrl/⌘+Enter to send</span><span className="flex-1" />
      {canReply && <Select className="!h-9 w-auto text-[12.5px]" value={after} onChange={(e) => setAfter(e.target.value)} aria-label="Status after sending"><option value="">Keep status</option>{waiting && <option value={waiting.id}>Then: {waiting.name}</option>}{resolved && <option value={resolved.id}>Then: {resolved.name}</option>}</Select>}
      <Button variant="primary" disabled={busy || uploading || (!body.trim() && !files.length)} onClick={send}>{kind === 'note' ? <><MessageSquare size={15} />Add note</> : <><Send size={15} />Send reply</>}</Button>
    </div>
  </div>;
}

function DueOverride({ value, onSave }: { value: Date | null; onSave: (v: string | null) => void }) {
  const [open, setOpen] = useState(false); const [v, setV] = useState(value ? new Date(+new Date(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  if (!open) return <button onClick={() => setOpen(true)} className="w-max text-xs font-semibold text-accent hover:underline">Change due date</button>;
  return <div className="flex gap-2"><Input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} className="!h-8 text-xs" /><Button size="sm" onClick={() => { onSave(v ? new Date(v).toISOString() : null); setOpen(false); }}>Save</Button></div>;
}

function TimeLogger({ ticketId }: { ticketId: string }) {
  const toast = useToast(); const router = useRouter(); const [m, setM] = useState(''); const [note, setNote] = useState(''); const [bill, setBill] = useState(false);
  const [timer, setTimer] = useState<number | null>(null); const [, tick] = useState(0);
  useEffect(() => { try { const s = localStorage.getItem('rad-timer-' + ticketId); if (s) setTimer(+s); } catch { /* storage off */ } }, [ticketId]);
  useEffect(() => { if (!timer) return; const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, [timer]);
  const elapsed = timer ? Math.floor((Date.now() - timer) / 1000) : 0;
  const save = async (mins: number) => { const r = await D.logTime(ticketId, mins, note, bill, todayISO()); if (!r.ok) return toast(r.error, 'bad'); toast('Time logged'); setM(''); setNote(''); router.refresh(); };
  return <div className="grid gap-2">
    <div className="flex gap-2">
      {timer ? <Button size="sm" variant="danger" onClick={() => { const mins = Math.max(1, Math.round(elapsed / 60)); setTimer(null); try { localStorage.removeItem('rad-timer-' + ticketId); } catch { /* */ } save(mins); }}>Stop · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</Button>
        : <Button size="sm" onClick={() => { const n = Date.now(); setTimer(n); try { localStorage.setItem('rad-timer-' + ticketId, String(n)); } catch { /* */ } }}><Timer size={13} />Start timer</Button>}
      <Input type="number" min={1} value={m} onChange={(e) => setM(e.target.value)} placeholder="Minutes" className="!h-8 w-24 text-[12.5px]" aria-label="Minutes" />
      <Button size="sm" variant="soft" disabled={!+m} onClick={() => save(+m)}>Log</Button>
    </div>
    <div className="flex items-center gap-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (optional)" className="!h-8 flex-1 text-[12.5px]" aria-label="Time note" /><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={bill} onChange={(e) => setBill(e.target.checked)} className="accent-[rgb(var(--accent))]" />Billable</label></div>
  </div>;
}

function CustomerPanel({ t, contact, company, others, deals, canWork }: { t: Ticket; contact: Props['contact']; company: Props['company']; others: Props['others']; deals: Props['deals']; canWork: boolean }) {
  const { me } = useApp(); const toast = useToast(); const router = useRouter(); const tag = useTag();
  const [link, setLink] = useState<string | null>(null); const [change, setChange] = useState(false);
  const crm = me.crmAccess;
  return <Panel title={<span className="inline-flex items-center gap-2"><User size={15} />Customer</span>} actions={canWork && <Button size="sm" variant="ghost" onClick={() => setChange((x) => !x)}>{change ? 'Done' : 'Change'}</Button>} bodyClass="grid gap-3 p-5 text-[13px]">
    {change && <RecordPicker type="contact" value={t.contactId} placeholder="Search contacts" ariaLabel="Change contact" onChange={async (id) => { const r = await D.updateTicket(t.id, { contactId: id || null }); if (!r.ok) toast(r.error, 'bad'); else { setChange(false); router.refresh(); } }} />}
    {contact ? <div className="flex items-start gap-3"><Avatar id={contact.id} name={contact.name} size={36} /><div className="min-w-0 flex-1">
      <Link href={crm ? `/contacts/${contact.id}` : `/desk/customers/${contact.id}`} className="font-semibold hover:text-accent">{contact.name}</Link>
      {contact.jobTitle && <div className="text-xs text-muted">{contact.jobTitle}</div>}
      {contact.email && <div className="mt-1 flex items-center gap-1.5 text-xs"><Mail size={12} className="text-faint" /><span className="select-all truncate">{contact.email}</span></div>}
      {contact.phone && <div className="flex items-center gap-1.5 text-xs"><Phone size={12} className="text-faint" /><span className="select-all">{contact.phone}</span></div>}
    </div></div> : <div><div className="font-semibold">{t.requesterName || 'Unknown requester'}</div><div className="text-xs text-muted">{t.requesterEmail || 'No email'}</div></div>}
    {company && <div className="flex items-center gap-2"><Building2 size={14} className="text-faint" /><Link href={crm ? `/companies/${company.id}` : `/desk/customers/c-${company.id}`} className="font-medium hover:text-accent">{company.name}</Link>{company.tier && <Chip tone="accent">{company.tier}</Chip>}</div>}
    {contact && canWork && me.deskRole !== 'light' && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-3 py-2 text-xs">
      <span className="flex-1">Portal: {contact.portalEnabled ? <b className="text-good">active{contact.portalLastLogin ? ` · last in ${timeAgo(contact.portalLastLogin)}` : ' · not signed in yet'}</b> : 'no access'}</span>
      {contact.email && <Button size="sm" variant="ghost" onClick={async () => { const r = await D.invitePortal(contact.id); if (!r.ok) return toast(r.error, 'bad'); setLink(r.link.startsWith('/') ? location.origin + r.link : r.link); toast(r.emailed ? 'Invitation emailed' : 'Invitation link created'); router.refresh(); }}>{contact.portalEnabled ? 'Resend invite' : 'Invite to portal'}</Button>}
      {contact.portalEnabled && <ConfirmButton size="sm" confirmText="Remove access?" onConfirm={async () => { const r = await D.revokePortal(contact.id); if (!r.ok) toast(r.error, 'bad'); else router.refresh(); }}>Remove</ConfirmButton>}
    </div>}
    {link && <div className="grid gap-1"><span className="text-xs text-muted">Send this link privately (valid 7 days):</span><div className="flex gap-1.5"><Input readOnly value={link} onFocus={(e) => e.target.select()} className="!h-8 text-[11px]" /><IconButton label="Copy" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Copied'); } catch { toast('Select the link to copy it'); } }}><Copy size={14} /></IconButton></div></div>}
    {others.length > 0 && <div><div className="eyebrow mb-1 !text-[10.5px]">Other tickets</div>{others.map((o) => <Link key={o.id} href={`/desk/tickets/${o.id}`} className="flex items-center gap-2 py-1 text-xs hover:text-accent"><span className="num text-muted">{tag(o.number)}</span><span className="min-w-0 flex-1 truncate">{o.subject}</span><span className={o.statusCategory === 'closed' ? 'text-good' : 'text-accent'}>{o.statusCategory === 'closed' ? 'closed' : 'open'}</span></Link>)}</div>}
    {crm && deals.length > 0 && <div><div className="eyebrow mb-1 !text-[10.5px]">Open deals with this company</div>{deals.map((d) => <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center gap-2 py-1 text-xs hover:text-accent"><span className="min-w-0 flex-1 truncate">{d.name}</span><span className="num text-muted">{fmtMoney(d.amount, d.currency)}</span></Link>)}</div>}
    {crm && t.dealId && <Link href={`/deals/${t.dealId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"><BookOpen size={12} />Linked sales opportunity</Link>}
    <p className="text-[11px] text-faint"><Paperclip size={10} className="inline" /> Customers see your replies, never private notes or files your team uploads here.</p>
  </Panel>;
}

/** AI summary for whoever picks the ticket up. */
function Summarise({ ticketId }: { ticketId: string }) {
  const toast = useToast(); const [text, setText] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  return <><Button disabled={busy} onClick={async () => { setBusy(true); const r = await DX.aiSummarize(ticketId); setBusy(false); if (!r.ok) return toast(r.error, 'bad'); setText(r.text); }}><Sparkles size={15} />{busy ? 'Summarising…' : 'Summarise'}</Button>
    <Modal open={text != null} onClose={() => setText(null)} title="Ticket summary" sub="Written by AI from the conversation — check before relying on it." footer={<Button variant="primary" onClick={() => setText(null)}>Close</Button>}>
      <div className="whitespace-pre-wrap pb-3 text-[14px] leading-relaxed">{text}</div></Modal></>;
}
/** Vendor escalation: their case number and status; waiting on the vendor pauses the SLA. */
function VendorPanel({ t, canWork }: { t: Ticket; canWork: boolean }) {
  const toast = useToast(); const router = useRouter(); const [open, setOpen] = useState(false);
  const [v, setV] = useState({ vendorName: t.vendorName || '', vendorCaseNo: t.vendorCaseNo || '', vendorStatus: t.vendorStatus || 'Opened with vendor' });
  if (!t.vendorStatus && !canWork) return null;
  const save = async (status: string | null) => { const r = await DX.setVendorCase(t.id, { ...v, vendorStatus: status }); if (!r.ok) return toast(r.error, 'bad'); toast(status === 'Waiting on vendor' ? 'Saved — SLA paused while waiting on the vendor' : 'Saved'); setOpen(false); router.refresh(); };
  return <Panel title={<span className="inline-flex items-center gap-2"><Truck size={15} />Vendor case</span>} actions={canWork && !open && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{t.vendorStatus ? 'Update' : 'Escalate to vendor'}</Button>} bodyClass="grid gap-2 p-5 text-[13px]">
    {open ? <>
      <Field label="Vendor"><Input value={v.vendorName} onChange={(e) => setV({ ...v, vendorName: e.target.value })} placeholder="e.g. Sophos, Fortinet" /></Field>
      <Field label="Vendor case number"><Input value={v.vendorCaseNo} onChange={(e) => setV({ ...v, vendorCaseNo: e.target.value })} className="num" /></Field>
      <Field label="Status"><Select value={v.vendorStatus} onChange={(e) => setV({ ...v, vendorStatus: e.target.value })}>{VENDOR_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" onClick={() => save(v.vendorStatus)}>Save</Button>{t.vendorStatus && <Button size="sm" variant="ghost" onClick={() => save(null)}>Remove</Button>}<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </> : t.vendorStatus ? <><Row k="Vendor" v={t.vendorName} /><Row k="Case" v={<span className="num">{t.vendorCaseNo || '—'}</span>} /><Row k="Status" v={<Chip tone={t.vendorStatus === 'Waiting on vendor' ? 'warn' : 'accent'}>{t.vendorStatus}</Chip>} />{t.vendorOpenedAt && <Row k="With vendor since" v={dt(t.vendorOpenedAt)} />}</>
      : <p className="text-muted">Escalating to the vendor records their case number; while you wait on them the SLA is paused.</p>}
  </Panel>;
}
