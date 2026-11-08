'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Download, FileText, Mail, MessageCircle, Paperclip, Phone, Sparkles, Star, Trash2, Video, ListTodo } from 'lucide-react';
import { Avatar, Button, Chip, ConfirmButton, Empty, Field, Input, Modal, Panel, Select, Textarea, useToast } from './ui';
import { useApp, useUserName } from './app-context';
import { useForms } from './forms';
import * as A from '@/lib/actions';
import type { Activity, Attachment, Note } from '@/db/schema';
import { cn, fmtDate, formatPhone, fullName, timeAgo, todayISO } from '@/lib/utils';
import { OUTCOMES } from '@/lib/options';

export const ACT_ICON: Record<string, typeof Phone> = { task: ListTodo, call: Phone, meeting: Video, email: Mail, whatsapp: MessageCircle };
export const ACT_LABEL: Record<string, string> = { task: 'Task', call: 'Call', meeting: 'Meeting', email: 'Email', whatsapp: 'WhatsApp' };

export function Owner({ id, withName = true }: { id?: string | null; withName?: boolean }) {
  const name = useUserName()(id); const { me } = useApp();
  return <span className="inline-flex items-center gap-2 whitespace-nowrap"><Avatar id={id} name={name === 'You' ? me.name : name} size={22} />{withName && <span className="text-[13px]">{name}</span>}</span>;
}

/* ---------- activity row ---------- */
export function ActivityRow({ a, relLabel, relHref }: { a: Activity; relLabel?: string; relHref?: string }) {
  const toast = useToast(); const router = useRouter(); const openForm = useForms(); const who = useUserName();
  const [pending, setPending] = useState(false); const [ask, setAsk] = useState(false);
  const t = todayISO(); const od = !a.done && a.dueDate && a.dueDate < t; const Icon = ACT_ICON[a.type] || ListTodo;
  const toggle = async (outcome?: string) => { setPending(true); const r = await A.toggleActivity(a.id, outcome); setPending(false); setAsk(false); if (!r.ok) toast(r.error, 'bad'); else { toast(a.done ? 'Reopened' : 'Done'); router.refresh(); } };
  const tip = [ACT_LABEL[a.type], a.dueDate ? fmtDate(a.dueDate) + (a.dueTime ? ` ${a.dueTime}` : '') : null, a.durationMin ? `${a.durationMin} min` : null, a.location, relLabel, who(a.ownerId)].filter(Boolean).join(' · ');
  return <div className="group flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-raised">
    <button aria-label={a.done ? 'Mark not done' : 'Mark done'} disabled={pending} onClick={() => (!a.done && (a.type === 'call' || a.type === 'meeting') ? setAsk(true) : toggle())}
      className={cn('grid h-[20px] w-[20px] flex-none place-items-center rounded-full border-[1.5px] transition', a.done ? 'border-good bg-good text-white' : 'border-faint hover:border-good')}>{a.done && <Check size={12} strokeWidth={3} />}</button>
    <span className={cn('grid h-8 w-8 flex-none place-items-center rounded-lg', od ? 'bg-bad-soft text-bad' : 'bg-sunken text-muted')}><Icon size={15} /></span>
    <button onClick={() => openForm('activity', a as never)} className="min-w-0 flex-1 text-left" title={tip}>
      <div className={cn('truncate text-[13.5px] font-medium', a.done && 'text-faint line-through')}>{a.title}</div>
      <div className="truncate text-xs text-muted">{ACT_LABEL[a.type]}{a.outcome && <> · <b className="font-semibold">{a.outcome}</b></>}{a.location && <> · {a.location}</>}{relLabel && <> · {relHref ? <Link href={relHref} onClick={(e) => e.stopPropagation()} className="hover:text-accent hover:underline">{relLabel}</Link> : relLabel}</>}{a.ownerId && <> · {who(a.ownerId)}</>}{a.automation && <> · auto</>}</div>
    </button>
    <Chip tone={od ? 'bad' : a.dueDate === t ? 'warn' : 'neutral'}>{a.dueDate ? (a.dueDate === t ? 'Today' : fmtDate(a.dueDate)) : 'No date'}{a.dueTime ? ` ${a.dueTime}` : ''}</Chip>
    <Modal open={ask} onClose={() => setAsk(false)} title={`How did the ${ACT_LABEL[a.type].toLowerCase()} go?`} sub={a.title}
      footer={<><Button variant="ghost" onClick={() => toggle()}>Skip</Button></>}>
      <div className="grid gap-2 pb-3 sm:grid-cols-2">{OUTCOMES.map((o) => <Button key={o} disabled={pending} onClick={() => toggle(o)} className="justify-start">{o}</Button>)}</div>
    </Modal>
  </div>;
}
export function ActivityPanel({ items, relatedType, relatedId }: { items: Activity[]; relatedType: string; relatedId: string }) {
  const openForm = useForms();
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
  return <Panel title="Activities" count={`${items.filter((a) => !a.done).length} open`} actions={<Button size="sm" variant="soft" onClick={() => openForm('activity', { relatedType, relatedId })}>Schedule</Button>}>
    {sorted.length ? sorted.map((a) => <ActivityRow key={a.id} a={a} />) : <p className="px-5 py-6 text-[13px] text-muted">Nothing scheduled. Every open deal should have a next step.</p>}
  </Panel>;
}

/* ---------- notes ---------- */
export function NotesPanel({ items, relatedType, relatedId }: { items: Note[]; relatedType: string; relatedId: string }) {
  const toast = useToast(); const router = useRouter(); const who = useUserName();
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  return <Panel title="Notes" count={items.length} bodyClass="p-5">
    <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); const r = await A.addNote(relatedType, relatedId, text); setBusy(false); if (!r.ok) toast(r.error, 'bad'); else { setText(''); router.refresh(); } }}>
      <Textarea aria-label="New note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" className="min-h-[44px] flex-1" rows={2} />
      <Button variant="primary" disabled={busy || !text.trim()}>Add</Button>
    </form>
    <div className="mt-4 flex flex-col gap-3">
      {[...items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map((n) => <div key={n.id} className="group">
        <div className="whitespace-pre-wrap break-words rounded-xl border border-line bg-raised px-3.5 py-2.5 text-[13.5px]">{n.body}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted">{n.automation ? 'Automation' : who(n.authorId)} · {timeAgo(n.createdAt)}
          <ConfirmButton size="sm" className="h-6 px-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100" confirmText="Delete?" onConfirm={async () => { const r = await A.deleteNote(n.id); if (!r.ok) toast(r.error, 'bad'); else router.refresh(); }}>Delete</ConfirmButton></div>
      </div>)}
    </div>
  </Panel>;
}

/* ---------- data table with sort + selection ---------- */
export type Col<T> = { key: string; label: string; cell: (r: T) => ReactNode; sort?: (r: T) => string | number; num?: boolean; className?: string };
export function DataTable<T extends { id: string }>({ rows, cols, href, selectable, bulk, empty, initialSort, serverSort, onSort }: {
  rows: T[]; cols: Col<T>[]; href?: (r: T) => string; selectable?: boolean; empty?: ReactNode; initialSort?: [string, 1 | -1];
  bulk?: (ids: string[], clear: () => void) => ReactNode;
  /** When the server sorts (paged lists), pass the current sort and a handler; rows are then shown as given. */
  serverSort?: [string, 1 | -1]; onSort?: (key: string, dir: 1 | -1) => void;
}) {
  const router = useRouter();
  const [localSort, setLocalSort] = useState<[string, 1 | -1]>(initialSort || [cols[0].key, 1]);
  const sort = serverSort || localSort;
  const setSort = (f: (s: [string, 1 | -1]) => [string, 1 | -1]) => { const n = f(sort); if (onSort) onSort(n[0], n[1]); else setLocalSort(n); };
  const [sel, setSel] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => {
    if (serverSort) return rows;
    const c = cols.find((x) => x.key === sort[0]); if (!c?.sort) return rows;
    return [...rows].sort((a, b) => { const va = c.sort!(a), vb = c.sort!(b); return (va > vb ? 1 : va < vb ? -1 : 0) * sort[1]; });
  }, [rows, cols, sort, serverSort]);
  const ids = sorted.map((r) => r.id); const all = ids.length > 0 && ids.every((i) => sel.has(i));
  if (!rows.length) return <div className="panel">{empty || <Empty title="Nothing here yet" />}</div>;
  return <>
    {selectable && sel.size > 0 && bulk && <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 animate-rise"><b className="text-[13px] text-accent">{sel.size} selected</b>{bulk([...sel], () => setSel(new Set()))}<span className="flex-1" /><Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button></div>}
    <div className="panel overflow-x-auto"><table className="tbl min-w-[720px]">
      <thead><tr>
        {selectable && <th className="w-10 !pr-0"><input type="checkbox" aria-label="Select all" checked={all} onChange={(e) => setSel(e.target.checked ? new Set(ids) : new Set())} className="h-4 w-4 accent-[rgb(var(--accent))]" /></th>}
        {cols.map((c) => <th key={c.key} className={cn(c.num && 'text-right', c.sort && 'cursor-pointer select-none hover:text-ink')} onClick={() => c.sort && setSort(([k, d]) => [c.key, k === c.key ? (d === 1 ? -1 : 1) : 1])}>
          <span className="inline-flex items-center gap-1">{c.label}{sort[0] === c.key && (sort[1] === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span></th>)}
      </tr></thead>
      <tbody>{sorted.map((r) => <tr key={r.id} className={cn(href && 'cursor-pointer', sel.has(r.id) && '!bg-accent-soft')} onClick={(e) => { if (href && !(e.target as HTMLElement).closest('input,button,a,select,label')) router.push(href(r)); }}>
        {selectable && <td className="!pr-0"><input type="checkbox" aria-label="Select row" checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} className="h-4 w-4 accent-[rgb(var(--accent))]" /></td>}
        {cols.map((c) => <td key={c.key} className={cn(c.num && 'num text-right', c.className)}>{c.cell(r)}</td>)}
      </tr>)}</tbody>
    </table></div>
  </>;
}
/** Common bulk actions: assign owner, tag, delete. */
export function BulkActions({ entity, ids, clear, extra }: { entity: 'lead' | 'deal' | 'contact' | 'company'; ids: string[]; clear: () => void; extra?: ReactNode }) {
  const { users, me } = useApp(); const toast = useToast(); const router = useRouter();
  const [mode, setMode] = useState<'' | 'owner' | 'tag'>(''); const [val, setVal] = useState('');
  const after = (r: A.Result, msg: string) => { if (!r.ok) toast(r.error, 'bad'); else { toast(msg); clear(); setMode(''); router.refresh(); } };
  return <>
    {entity !== 'company' && me.role !== 'rep' && <Button size="sm" onClick={() => { setMode('owner'); setVal(me.id); }}>Assign owner</Button>}
    {entity !== 'company' && <Button size="sm" onClick={() => { setMode('tag'); setVal(''); }}>Add tag</Button>}
    {extra}
    <ConfirmButton size="sm" variant="secondary" confirmText={`Delete ${ids.length}?`} onConfirm={async () => after(await A.deleteRecords(entity, ids), `Deleted ${ids.length}`)}>Delete</ConfirmButton>
    <Modal open={!!mode} onClose={() => setMode('')} title={mode === 'owner' ? 'Assign owner' : 'Add tag'} sub={`${ids.length} selected`}
      footer={<><Button variant="ghost" onClick={() => setMode('')}>Cancel</Button><Button variant="primary" onClick={async () => after(mode === 'owner' ? await A.bulkAssign(entity as 'lead', ids, val) : await A.bulkTag(entity as 'lead', ids, val), mode === 'owner' ? 'Owner updated' : 'Tagged')}>Apply</Button></>}>
      {mode === 'owner' ? <Field label="Owner"><Select value={val} onChange={(e) => setVal(e.target.value)}>{users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        : <Field label="Tag(s)" hint="Comma separated"><Input autoFocus value={val} onChange={(e) => setVal(e.target.value)} /></Field>}
    </Modal>
  </>;
}

/* ---------- copy button ---------- */
export function CopyText({ value }: { value?: string | null }) {
  const toast = useToast();
  if (!value) return <span className="text-faint">—</span>;
  return <span className="inline-flex items-center gap-1.5"><span className="select-all">{value}</span><button aria-label="Copy" title="Copy" onClick={async () => { try { await navigator.clipboard.writeText(value); toast('Copied'); } catch { toast('Select the text to copy it'); } }} className="text-faint hover:text-ink"><Copy size={13} /></button></span>;
}

/* ---------- email composer ---------- */
export function EmailComposer({ open, onClose, to, ctx, relatedType, relatedId }: { open: boolean; onClose: () => void; to?: string | null; ctx: { firstName?: string | null; lastName?: string | null; company?: string | null; deal?: string | null; amount?: string | null }; relatedType: string; relatedId: string }) {
  const { templates, me, aiEnabled } = useApp(); const toast = useToast(); const router = useRouter();
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [goal, setGoal] = useState(''); const [busy, setBusy] = useState(false);
  const merge = (s: string) => s.replace(/\{\{first_name\}\}/g, ctx.firstName || 'there').replace(/\{\{last_name\}\}/g, ctx.lastName || '').replace(/\{\{company\}\}/g, ctx.company || 'your team').replace(/\{\{deal\}\}/g, ctx.deal || '').replace(/\{\{amount\}\}/g, ctx.amount || '').replace(/\{\{my_name\}\}/g, me.name);
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast('Select the text and copy it', 'bad'); } };
  return <Modal open={open} onClose={onClose} wide title="Compose email" sub={to ? 'Write here, copy into your mail app, then log it.' : 'No email address on file — add one to the contact first, or copy the text anyway.'}
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await A.logEmail(relatedType, relatedId, subject, body); if (!r.ok) toast(r.error, 'bad'); else { toast('Email logged'); onClose(); router.refresh(); } }}>Log as sent</Button></>}>
    <div className="grid gap-3.5 pb-2">
      <div className="flex items-center gap-2 text-[13px]"><span className="text-muted">To</span><CopyText value={to} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template"><Select defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) { setSubject(merge(t.subject)); setBody(merge(t.body)); } }}><option value="">Choose a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        {aiEnabled && <Field label="Or draft with AI"><div className="flex gap-2"><Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. ask for a security review next week" /><Button type="button" variant="soft" disabled={busy} onClick={async () => { setBusy(true); const r = await A.aiEmail(goal, { recipient: fullName(ctx), company: ctx.company, deal: ctx.deal, amount: ctx.amount }); setBusy(false); if (!r.ok) toast(r.error, 'bad'); else { setSubject(r.subject); setBody(r.body); } }}><Sparkles size={15} />{busy ? 'Drafting…' : 'Draft'}</Button></div></Field>}
      </div>
      <Field label="Subject"><div className="flex gap-2"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /><Button type="button" onClick={() => copy(subject)}>Copy</Button></div></Field>
      <Field label="Message"><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[220px]" /></Field>
      <div><Button type="button" onClick={() => copy(body)}><Copy size={14} />Copy message</Button></div>
    </div>
  </Modal>;
}

/* ---------- detail page building blocks ---------- */
export function DetailGrid({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 sm:grid-cols-2">{items.map(([k, v]) => <div key={k} className="min-w-0"><dt className="eyebrow !text-[10.5px]">{k}</dt><dd className="mt-1 break-words text-[13.5px]">{v ?? <span className="text-faint">—</span>}</dd></div>)}</dl>;
}
export function useCustomItems() {
  const { customFields } = useApp();
  return (module: string, custom: Record<string, unknown> | null | undefined, pipelineId?: string | null): [string, ReactNode][] =>
    customFields.filter((f) => f.module === module && (!f.pipelineId || f.pipelineId === pipelineId)).map((f) => {
      const v = custom?.[f.id];
      const out = v == null || v === '' ? null : f.type === 'checkbox' ? (v ? 'Yes' : 'No') : f.type === 'date' ? fmtDate(String(v)) : f.type === 'url' ? <a className="text-accent hover:underline" target="_blank" rel="noopener" href={/^https?:/.test(String(v)) ? String(v) : `https://${v}`}>{String(v)}</a> : String(v);
      return [f.label, out];
    });
}
export function RelatedList({ title, items, empty, action }: { title: string; items: { id: string; href: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }[]; empty: string; action?: ReactNode }) {
  return <Panel title={title} count={items.length} actions={action}>
    {items.length ? items.map((i) => <Link key={i.id} href={i.href} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0 hover:bg-raised"><div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{i.title}</div>{i.sub && <div className="truncate text-xs text-muted">{i.sub}</div>}</div>{i.right}</Link>)
      : <p className="px-5 py-6 text-[13px] text-muted">{empty}</p>}
  </Panel>;
}

/* ---------- phone ---------- */
export function PhoneText({ value }: { value?: string | null }) { return value ? <CopyText value={formatPhone(value)} /> : <span className="text-faint">—</span>; }

/* ---------- favourite star ---------- */
export function FavoriteStar({ type, id, label, on }: { type: string; id: string; label: string; on: boolean }) {
  const toast = useToast(); const router = useRouter(); const [v, setV] = useState(on);
  return <button aria-pressed={v} aria-label={v ? 'Remove from favourites' : 'Add to favourites'} title={v ? 'Remove from favourites' : 'Add to favourites'}
    onClick={async () => { setV(!v); const r = await A.toggleFavorite(type, id, label); if (!r.ok) { setV(v); toast(r.error, 'bad'); } else router.refresh(); }}
    className={cn('grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface transition hover:border-faint', v ? 'text-warn' : 'text-faint')}><Star size={16} fill={v ? 'currentColor' : 'none'} /></button>;
}

/* ---------- recent items (this browser only) ---------- */
export type Recent = { type: string; id: string; label: string; href: string };
export function rememberRecent(r: Recent) {
  try { const list: Recent[] = JSON.parse(localStorage.getItem('rd-recent') || '[]'); localStorage.setItem('rd-recent', JSON.stringify([r, ...list.filter((x) => x.id !== r.id)].slice(0, 8))); window.dispatchEvent(new Event('rd-recent')); } catch { /* storage unavailable */ }
}
export function readRecent(): Recent[] { try { return JSON.parse(localStorage.getItem('rd-recent') || '[]'); } catch { return []; } }

/* ---------- attachments ---------- */
const fmtSize = (n: number) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
export function AttachmentsPanel({ items, relatedType, relatedId }: { items: Attachment[]; relatedType: string; relatedId: string }) {
  const toast = useToast(); const router = useRouter(); const who = useUserName(); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    for (const f of Array.from(files)) {
      if (f.size > 15e6) { toast(`${f.name} is over 15 MB`, 'bad'); continue; }
      const fd = new FormData(); fd.append('file', f); fd.append('relatedType', relatedType); fd.append('relatedId', relatedId);
      const r = await fetch('/api/files', { method: 'POST', body: fd }).catch(() => null);
      if (!r?.ok) toast((await r?.json().catch(() => null))?.error || `Couldn’t upload ${f.name}`, 'bad');
    }
    setBusy(false); router.refresh();
  };
  return <Panel title={<span className="inline-flex items-center gap-2"><Paperclip size={15} />Files</span>} count={items.length}
    actions={<label className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 text-xs font-semibold text-accent hover:brightness-95', busy && 'opacity-50')}>{busy ? 'Uploading…' : 'Upload'}<input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>}>
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }} className={cn(drag && 'bg-accent-soft')}>
      {items.length ? [...items].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).map((f) => <div key={f.id} className="group flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
        <FileText size={16} className="flex-none text-muted" />
        <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium hover:text-accent">{f.fileName}</div><div className="text-xs text-muted">{fmtSize(f.size)} · {who(f.uploadedBy)} · {timeAgo(f.createdAt)}</div></a>
        <a href={`/api/files/${f.id}?download=1`} aria-label="Download" title="Download" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink"><Download size={14} /></a>
        <ConfirmButton size="sm" className="h-8 px-2" confirmText="Delete?" onConfirm={async () => { const r = await A.deleteAttachment(f.id); if (!r.ok) toast(r.error, 'bad'); else router.refresh(); }}><Trash2 size={14} /></ConfirmButton>
      </div>) : <p className="px-5 py-6 text-[13px] text-muted">{relatedType === 'ticket' ? 'Drop screenshots, logs or documents here (up to 15 MB each).' : 'Drop proposals, contracts, POs or licences here (up to 15 MB each).'}</p>}
    </div>
  </Panel>;
}

/* ---------- inline cell editing ---------- */
export function InlineCell({ entity, id, field, value, display, kind = 'text', options, canEdit = true }: { entity: 'lead' | 'contact' | 'company' | 'deal'; id: string; field: string; value: string | number | null | undefined; display?: ReactNode; kind?: 'text' | 'number' | 'date' | 'select'; options?: [string, string][]; canEdit?: boolean }) {
  const toast = useToast(); const router = useRouter(); const [edit, setEdit] = useState(false); const [v, setV] = useState(String(value ?? ''));
  if (!canEdit) return <>{display ?? (value || <span className="text-faint">—</span>)}</>;
  const save = async (nv = v) => { setEdit(false); if (nv === String(value ?? '')) return; const r = await A.updateField(entity, id, field, nv); if (!r.ok) { toast(r.error, 'bad'); setV(String(value ?? '')); } else router.refresh(); };
  if (edit) {
    const common = { autoFocus: true, onClick: (e: React.MouseEvent) => e.stopPropagation(), className: '!h-8 !py-1 text-[13px]' };
    if (kind === 'select') return <Select {...common} value={v} onChange={(e) => { setV(e.target.value); save(e.target.value); }} onBlur={() => setEdit(false)}>{options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>;
    return <Input {...common} type={kind} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => save()} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setV(String(value ?? '')); setEdit(false); } }} />;
  }
  return <button type="button" title="Click to edit" onClick={(e) => { e.stopPropagation(); setV(String(value ?? '')); setEdit(true); }} className={cn('-mx-1.5 max-w-full rounded-md px-1.5 py-0.5 text-left hover:bg-sunken hover:ring-1 hover:ring-line', display ? 'whitespace-nowrap' : 'truncate')}>{display ?? (value || <span className="text-faint">—</span>)}</button>;
}

/* ---------- change history (leads, contacts, companies) ---------- */
export type HistoryRow = { id: string; text: string; userId: string | null; at: Date };
export function HistoryPanel({ rows }: { rows: HistoryRow[] }) {
  const who = useUserName(); const [all, setAll] = useState(false);
  return <Panel title="History" count={rows.length || undefined} bodyClass="p-5">
    {rows.length ? <ol className="relative flex flex-col gap-3.5 border-l border-line pl-5">{(all ? rows : rows.slice(0, 8)).map((e) => <li key={e.id} className="relative">
      <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-faint ring-4 ring-surface" />
      <div className="text-[13px]">{e.text}</div><div className="text-xs text-muted">{timeAgo(e.at)} · {who(e.userId)}</div></li>)}</ol>
      : <p className="text-[13px] text-muted">Changes to this record will be listed here.</p>}
    {rows.length > 8 && !all && <Button size="sm" variant="ghost" className="mt-3" onClick={() => setAll(true)}>Show all {rows.length}</Button>}
  </Panel>;
}
