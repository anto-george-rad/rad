'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { AlertTriangle, CalendarClock, Clock, KanbanSquare, Plus, Search } from 'lucide-react';
import type { Deal } from '@/db/schema';
import type { PipelineTreeT } from '@/lib/types';
import { Button, Chip, Empty, Field, Input, Modal, Segmented, Select, Textarea, useToast } from './ui';
import { useApp } from './app-context';
import { useForms, CustomInputs } from './forms';
import { BulkActions, DataTable, InlineCell, Owner } from './records';
import { RecordPicker } from './record-picker';
import { PageHeader } from './shell';
import * as A from '@/lib/actions';
import { cn, DAY, daysBetweenISO, fmtDate, fmtMoney, fmtShort, fullName, todayISO } from '@/lib/utils';

type Sub = PipelineTreeT['subs'][number];
export type DealRow = Deal & { base: number; companyName: string | null; next: { title: string; dueDate: string | null } | null };

export default function DealsView({ pipe, sub, deals, hiddenClosed }: { pipe: PipelineTreeT | null; sub: Sub | null; deals: DealRow[]; hiddenClosed: number }) {
  const { pipelines, me, users } = useApp(); const openForm = useForms(); const router = useRouter();
  const mayEdit = (d: Deal) => me.role !== 'rep' || !d.ownerId || d.ownerId === me.id;
  const [view, setView] = useState<'board' | 'list' | 'forecast'>('board'); const [q, setQ] = useState(''); const [scope, setScope] = useState<'all' | 'mine'>('all'); const [prio, setPrio] = useState('');
  if (!pipe || !sub) return <div className="panel"><Empty icon={<KanbanSquare />} title="No pipelines yet" action={<Link href="/settings?tab=pipelines"><Button variant="primary">Set up pipelines</Button></Link>}>Pipelines hold your deals and other processes, each with its own stages.</Empty></div>;
  const rows = deals.filter((d) => (scope === 'all' || d.ownerId === me.id) && (!prio || d.priority === prio) && (!q || [d.name, d.companyName, ...d.tags].join(' ').toLowerCase().includes(q.toLowerCase())));
  const stageType = new Map(sub.stages.map((s) => [s.id, s.type]));
  const open = rows.filter((d) => stageType.get(d.stageId) === 'open');
  return <>
    <PageHeader title={pipe.name} sub={`${open.length} open · ${fmtMoney(open.reduce((s, d) => s + d.base, 0))} · weighted ${fmtMoney(open.reduce((s, d) => s + d.base * ((sub.stages.find((x) => x.id === d.stageId)?.probability || 0) / 100), 0))}`}
      actions={<Button variant="primary" onClick={() => openForm('deal', { pipelineId: pipe.id, subPipelineId: sub.id })}><Plus size={16} />New {pipe.recordName.toLowerCase()}</Button>} />
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {pipelines.map((p) => <Link key={p.id} href={`/deals?p=${p.id}`} className={cn('rounded-[10px] border px-3.5 py-1.5 text-[13px] font-semibold transition', p.id === pipe.id ? 'border-line bg-surface shadow-card' : 'border-transparent text-muted hover:bg-sunken hover:text-ink')}>{p.name}</Link>)}
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {pipe.subs.length > 1 && <Select className="h-9 w-auto" value={sub.id} onChange={(e) => router.push(`/deals?p=${pipe.id}&s=${e.target.value}`)} aria-label="Sub-pipeline">{pipe.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
      <Segmented value={view} onChange={setView} options={[['board', 'Board'], ['list', 'List'], ['forecast', 'Forecast']]} />
      <div className="relative w-full max-w-[240px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, company, tag" className="pl-9" aria-label="Filter deals" /></div>
      <Select className="h-9 w-auto" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority"><option value="">Any priority</option><option>High</option><option>Medium</option><option>Low</option></Select>
      <Segmented value={scope} onChange={setScope} options={[['all', 'Everyone'], ['mine', 'Mine']]} />
    </div>
    {hiddenClosed > 0 && <p className="mb-2 text-xs text-muted">Showing deals closed in the last 90 days. <Link className="font-semibold text-accent hover:underline" href={`/deals?p=${pipe.id}&s=${sub.id}&closed=all`}>Show {hiddenClosed} older closed</Link></p>}
    {view === 'board' && <Board sub={sub} rows={rows} onAdd={(stageId) => openForm('deal', { pipelineId: pipe.id, subPipelineId: sub.id, stageId })} />}
    {view === 'forecast' && <Forecast sub={sub} rows={open} />}
    {view === 'list' && <DataTable rows={rows} href={(d) => `/deals/${d.id}`} selectable initialSort={['stage', 1]}
      bulk={(ids, clear) => <BulkActions entity="deal" ids={ids} clear={clear} />}
      cols={[
        { key: 'name', label: 'Name', cell: (d) => <div><div className="font-semibold">{d.name}</div>{d.tags.length > 0 && <div className="mt-1 flex gap-1">{d.tags.map((t) => <Chip key={t} tone="outline">{t}</Chip>)}</div>}</div>, sort: (d) => d.name.toLowerCase() },
        { key: 'stage', label: 'Stage', cell: (d) => <StageChip sub={sub} id={d.stageId} />, sort: (d) => sub.stages.findIndex((s) => s.id === d.stageId) },
        { key: 'amount', label: 'Amount', num: true, cell: (d) => <InlineCell entity="deal" id={d.id} field="amount" kind="number" value={d.amount} display={fmtMoney(d.amount, d.currency)} canEdit={mayEdit(d)} />, sort: (d) => d.base },
        { key: 'company', label: 'Company', cell: (d) => d.companyName || <span className="text-faint">—</span>, sort: (d) => d.companyName || '' },
        { key: 'close', label: 'Closing', cell: (d) => <InlineCell entity="deal" id={d.id} field="closingDate" kind="date" value={d.closingDate} display={fmtDate(d.closingDate)} canEdit={mayEdit(d)} />, sort: (d) => d.closingDate || '9' },
        { key: 'step', label: 'Next step', cell: (d) => <InlineCell entity="deal" id={d.id} field="nextStep" value={d.nextStep} canEdit={mayEdit(d)} />, sort: (d) => d.nextStep || '~' },
        { key: 'next', label: 'Next activity', cell: (d) => d.next ? <span className="text-[13px]">{d.next.title} <span className="text-muted">{fmtDate(d.next.dueDate)}</span></span> : stageType.get(d.stageId) === 'open' ? <Chip tone="warn">None</Chip> : '—', sort: (d) => d.next?.dueDate || '9' },
        { key: 'owner', label: 'Owner', cell: (d) => <InlineCell entity="deal" id={d.id} field="ownerId" kind="select" value={d.ownerId} display={<Owner id={d.ownerId} />} canEdit={me.role !== 'rep'} options={users.filter((u) => u.active || u.id === d.ownerId).map((u) => [u.id, u.name])} />, sort: (d) => d.ownerId || '' },
      ]} />}
  </>;
}
export function StageChip({ sub, id }: { sub: Sub; id: string }) {
  const st = sub.stages.find((s) => s.id === id); if (!st) return <>—</>;
  return <Chip tone={st.type === 'won' ? 'good' : st.type === 'lost' ? 'bad' : 'accent'}>{st.name}</Chip>;
}

/* ---------- board ---------- */
function useMove() {
  const [move, setMove] = useState<{ deal: DealRow | Deal; toStageId: string; missing: A.MissingItem[]; stageType: string; stageName: string } | null>(null);
  const toast = useToast(); const router = useRouter();
  const start = async (deal: DealRow | Deal, toStageId: string) => {
    const r = await A.checkMove(deal.id, toStageId); if (!r.ok) return toast(r.error, 'bad');
    if (r.missing.length || r.stageType !== 'open') return setMove({ deal, toStageId, missing: r.missing, stageType: r.stageType, stageName: r.stageName });
    const m = await A.moveDeal(deal.id, toStageId); if (!m.ok) return toast(m.error, 'bad');
    toast(`Moved to ${r.stageName}`); m.ran.forEach((n) => toast(`Automation ran: ${n}`)); router.refresh();
  };
  return { move, setMove, start };
}
export function useStageMover() { const m = useMove(); return { start: m.start, dialog: m.move && <MoveDialog {...m.move} onClose={() => m.setMove(null)} /> }; }

function Board({ sub, rows, onAdd }: { sub: Sub; rows: DealRow[]; onAdd: (stageId: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { start, dialog } = useStageMover();
  const onEnd = (e: DragEndEvent) => { const d = rows.find((x) => x.id === e.active.id); const to = e.over?.id as string | undefined; if (d && to && to !== d.stageId) start(d, to); };
  return <DndContext sensors={sensors} onDragEnd={onEnd}>
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-7 md:px-7"><div className="flex min-h-[420px] items-start gap-3.5">
      {sub.stages.map((st) => { const cs = rows.filter((d) => d.stageId === st.id).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
        return <Column key={st.id} id={st.id} title={st.name} tone={st.type} count={cs.length} total={cs.reduce((s, d) => s + d.base, 0)} prob={st.type === 'open' ? st.probability : null} onAdd={st.type === 'open' ? () => onAdd(st.id) : undefined}>
          {cs.map((d) => <DealCard key={d.id} d={d} idleDays={st.type === 'open' ? st.idleDays : null} open={st.type === 'open'} />)}
        </Column>; })}
    </div></div>
    {dialog}
  </DndContext>;
}
function Column({ id, title, tone, count, total, prob, children, onAdd }: { id: string; title: string; tone: string; count: number; total: number; prob?: number | null; children: React.ReactNode; onAdd?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={cn('flex w-[284px] flex-none flex-col rounded-2xl border border-line bg-sunken/70 transition', isOver && 'border-accent bg-accent-soft ring-2 ring-accent/30')}>
    <div className="px-3.5 pb-2 pt-3">
      <div className="flex items-center gap-2 text-[13px] font-bold"><span className={cn('h-2 w-2 rounded-full', tone === 'won' ? 'bg-good' : tone === 'lost' ? 'bg-bad' : 'bg-accent')} />{title}<span className="num ml-auto rounded-full bg-surface px-2 text-[11px] font-medium text-muted">{count}</span>{onAdd && <button onClick={onAdd} aria-label={`Add to ${title}`} title={`Add to ${title}`} className="-mr-1 grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface hover:text-accent"><Plus size={14} /></button>}</div>
      <div className="num mt-1 text-xs text-muted">AED {fmtShort(total)}{prob != null && ` · ${prob}%`}</div>
    </div>
    <div className="flex max-h-[calc(100dvh-330px)] min-h-[60px] flex-col gap-2 overflow-y-auto px-2.5 pb-3 scroll-thin">{children}{count === 0 && <div className="rounded-xl border border-dashed border-line py-6 text-center text-xs text-faint">Drop deals here</div>}</div>
  </div>;
}
function DealCard({ d, idleDays, open }: { d: DealRow; idleDays: number | null; open: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: d.id });
  const idle = Math.floor((Date.now() - +new Date(d.stageEnteredAt)) / DAY); const t = todayISO();
  return <div ref={setNodeRef} {...listeners} {...attributes} style={transform ? { transform: `translate(${transform.x}px,${transform.y}px) rotate(1.5deg)`, zIndex: 50 } : undefined}
    className={cn('group cursor-grab touch-none rounded-xl border border-line bg-surface p-3 shadow-[0_1px_2px_rgb(var(--shadow)/.06)] transition-shadow hover:border-accent/40 hover:shadow-card active:cursor-grabbing', isDragging && 'shadow-pop')}>
    <Link href={`/deals/${d.id}`} className="line-clamp-2 text-[13.5px] font-semibold leading-snug hover:text-accent" onPointerDown={(e) => e.stopPropagation()}>{d.name}</Link>
    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted"><span className="truncate">{d.companyName || 'No company'}</span><span className="num font-medium text-ink">{d.currency !== 'AED' && `${d.currency} `}{fmtShort(d.amount)}</span></div>
    {open && d.nextStep && <div className="mt-1.5 line-clamp-2 text-xs text-muted"><span className="font-semibold text-ink">Next:</span> {d.nextStep}</div>}
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {d.priority === 'High' && <Chip tone="bad">High</Chip>}
      {open && d.forecastCategory === 'Commit' && <Chip tone="good">Commit</Chip>}
      {open && (d.next ? <Chip tone={d.next.dueDate && d.next.dueDate < t ? 'bad' : 'accent'}><Clock size={11} />{d.next.dueDate && d.next.dueDate < t ? 'Overdue' : fmtDate(d.next.dueDate)}</Chip> : <Chip tone="warn"><AlertTriangle size={11} />No next step</Chip>)}
      {open && idleDays && idle > idleDays && <Chip tone="warn">{idle}d idle</Chip>}
      {open && d.submissionDeadline && (() => { const left = daysBetweenISO(t, d.submissionDeadline); return left <= 14 ? <Chip tone={left < 0 ? 'bad' : left <= 3 ? 'warn' : 'neutral'}><CalendarClock size={11} />{left < 0 ? 'Tender passed' : `Tender ${left}d`}</Chip> : null; })()}
      {d.tags.slice(0, 2).map((tg) => <Chip key={tg} tone="outline">{tg}</Chip>)}
      <span className="ml-auto"><Owner id={d.ownerId} withName={false} /></span>
    </div>
  </div>;
}

/* ---------- forecast ---------- */
function Forecast({ sub, rows }: { sub: Sub; rows: DealRow[] }) {
  const toast = useToast(); const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const months = useMemo(() => { const out: string[] = []; const d = new Date(); d.setDate(1); for (let i = 0; i < 6; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() + 1); } return out; }, []);
  const bucket = (d: DealRow) => !d.closingDate || d.closingDate.slice(0, 7) < months[0] ? 'past' : d.closingDate.slice(0, 7) > months[5] ? months[5] : d.closingDate.slice(0, 7);
  const prob = (d: DealRow) => (sub.stages.find((s) => s.id === d.stageId)?.probability || 0) / 100;
  const onEnd = async (e: DragEndEvent) => {
    const d = rows.find((x) => x.id === e.active.id); const to = e.over?.id as string | undefined; if (!d || !to || to === 'past' || to === bucket(d)) return;
    const [y, m] = to.split('-').map(Number); const last = new Date(y, m, 0); const iso = `${y}-${String(m).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    const r = await A.setDealClosing(d.id, iso); if (!r.ok) toast(r.error, 'bad'); else { toast(`Closing date moved to ${fmtDate(iso)}`); router.refresh(); }
  };
  return <DndContext sensors={sensors} onDragEnd={onEnd}>
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-7 md:px-7"><div className="flex min-h-[420px] items-start gap-3.5">
      {['past', ...months].map((k) => { const cs = rows.filter((d) => bucket(d) === k); const label = k === 'past' ? 'Overdue / no date' : new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        return <Column key={k} id={k} title={label} tone={k === 'past' ? 'lost' : 'open'} count={cs.length} total={cs.reduce((s, d) => s + d.base, 0)}>
          <div className="num -mt-1 mb-1 px-1 text-[11px] text-muted">weighted AED {fmtShort(cs.reduce((s, d) => s + d.base * prob(d), 0))}</div>
          {cs.map((d) => <DealCard key={d.id} d={d} idleDays={null} open />)}
        </Column>; })}
    </div></div>
    <p className="text-xs text-muted">Open deals by expected closing month. Drag a card to another month to move its closing date to that month’s last day.</p>
  </DndContext>;
}

/* ---------- stage move dialog (rules + loss reason) ---------- */
export function MoveDialog({ deal, toStageId, missing, stageType, stageName, onClose }: { deal: DealRow | Deal; toStageId: string; missing: A.MissingItem[]; stageType: string; stageName: string; onClose: () => void }) {
  const { settings } = useApp(); const isWon = stageType === 'won'; const toast = useToast(); const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({ dueDate: todayISO() }); const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  const cfFields = missing.filter((m) => m.field).map((m) => ({ id: m.field!.id, label: m.field!.label, type: m.field!.type, options: m.field!.options, required: true, module: 'deal', pipelineId: null, sortOrder: 0 }));
  const submit = async () => {
    setBusy(true); setErr('');
    const r = await A.moveDeal(deal.id, toStageId, { amount: v.amount ? +v.amount : undefined, closingDate: v.closingDate, contactId: v.contactId, companyId: v.companyId, note: v.note, nextActivity: v.actTitle ? { title: v.actTitle, dueDate: v.dueDate } : undefined, custom, lossReason: v.lossReason, competitor: v.competitor, winReason: v.winReason });
    setBusy(false); if (!r.ok) return setErr(r.error);
    toast(isWon ? `Won! Moved to ${stageName}` : `Moved to ${stageName}`); r.ran.forEach((n) => toast(`Automation ran: ${n}`)); onClose(); router.refresh();
  };
  const has = (k: string) => missing.some((m) => m.key === k);
  return <Modal open onClose={onClose} title={`Move to ${stageName}`} sub={missing.length ? 'This stage needs a few details before the deal can move.' : isWon ? 'Record why you won so the win/loss report shows what works.' : 'Record why this one was lost so the win/loss report stays useful.'}
    footer={<>{err && <span className="mr-auto text-[13px] text-bad">{err}</span>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || has('products')} onClick={submit}>{busy ? 'Moving…' : 'Move deal'}</Button></>}>
    <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
      {has('amount') && <Field label={`Amount (${deal.currency})`} required><Input type="number" min={0} value={v.amount || ''} onChange={set('amount')} autoFocus /></Field>}
      {has('closingDate') && <Field label="Closing date" required><Input type="date" value={v.closingDate || ''} onChange={set('closingDate')} /></Field>}
      {has('contact') && <Field label="Contact" required><RecordPicker type="contact" value={v.contactId} ariaLabel="Contact" onChange={(id) => setV((o) => ({ ...o, contactId: id }))} /></Field>}
      {has('company') && <Field label="Company" required><RecordPicker type="company" value={v.companyId} ariaLabel="Company" onChange={(id) => setV((o) => ({ ...o, companyId: id }))} /></Field>}
      {has('note') && <Field label="Note" required className="col-span-full"><Textarea value={v.note || ''} onChange={set('note')} placeholder="What happened at this stage?" /></Field>}
      {has('nextActivity') && <><Field label="Next activity" required><Input value={v.actTitle || ''} onChange={set('actTitle')} placeholder="e.g. Send proposal" /></Field><Field label="Due"><Input type="date" value={v.dueDate} onChange={set('dueDate')} /></Field></>}
      {has('products') && <p className="col-span-full rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Add at least one product to this deal first, then move it.</p>}
      <CustomInputs fields={cfFields} values={custom} onChange={setCustom} />
      {isWon && <Field label="Win reason" required className="col-span-full"><Select value={v.winReason || ''} onChange={set('winReason')} autoFocus={!missing.length}><option value="">—</option>{settings.winReasons.map((r) => <option key={r}>{r}</option>)}</Select></Field>}
      {stageType === 'lost' && <><Field label="Loss reason" required><Select value={v.lossReason || ''} onChange={set('lossReason')}><option value="">—</option>{settings.lossReasons.map((r) => <option key={r}>{r}</option>)}</Select></Field><Field label="Competitor"><Input value={v.competitor || ''} onChange={set('competitor')} /></Field></>}
    </div>
  </Modal>;
}
