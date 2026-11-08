'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, EyeOff, Lock, MessageSquare, Pin, Ticket as TicketIcon } from 'lucide-react';
import { Button, Chip, Field, Input, Select, Textarea, useToast } from './ui';
import * as P from '@/lib/portal-actions';
import * as DX from '@/lib/desk-ext-actions';
import { cn, timeAgo } from '@/lib/utils';

export type TopicLite = { id: string; title: string; category: string; authorName: string; replies: number; answered: boolean; pinned: boolean; locked: boolean; hidden: boolean; lastPostAt: Date; views: number };
export type PostLite = { id: string; body: string; authorName: string; agent: boolean; createdAt: Date; hidden: boolean };
export type TopicFull = TopicLite & { body: string; createdAt: Date; answerId: string | null; mine: boolean };

/** Topic list, used in the portal (base /portal/community) and by moderators (base /desk/community). */
export function TopicList({ topics, categories, base, cat, q, canPost }: { topics: TopicLite[]; categories: string[]; base: string; cat: string; q: string; canPost: boolean }) {
  const router = useRouter(); const [text, setText] = useState(q);
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><h1 className="font-display text-[26px] font-bold tracking-tight">Community</h1><p className="text-[13.5px] text-muted">Ask other customers and our engineers. Answers marked ✓ solved the question.</p></div>
      {canPost && <Link href="/portal/community/new"><Button variant="primary">Ask a question</Button></Link>}</div>
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); router.push(`${base}?${new URLSearchParams({ ...(cat ? { cat } : {}), ...(text ? { q: text } : {}) })}`); }}>
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search questions" className="h-10 max-w-sm" aria-label="Search the community" />
      <Select value={cat} onChange={(e) => router.push(`${base}?${new URLSearchParams({ ...(e.target.value ? { cat: e.target.value } : {}), ...(text ? { q: text } : {}) })}`)} className="h-10 w-auto" aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select></form>
    <div className="panel">{topics.map((t) => <Link key={t.id} href={`${base}/${t.id}`} className={cn('flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-raised', t.hidden && 'opacity-60')}>
      {t.answered ? <CheckCircle2 size={18} className="flex-none text-good" aria-label="Answered" /> : <MessageSquare size={18} className="flex-none text-muted" />}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold">{t.pinned && <Pin size={13} className="text-accent" />}{t.locked && <Lock size={13} className="text-muted" />}{t.hidden && <EyeOff size={13} className="text-bad" />}<span className="truncate">{t.title}</span></div>
        <div className="text-xs text-muted">{t.category} · {t.authorName} · active {timeAgo(t.lastPostAt)}</div></div>
      <span className="num text-xs text-muted">{t.replies} repl{t.replies === 1 ? 'y' : 'ies'}</span></Link>)}
      {!topics.length && <p className="px-5 py-10 text-center text-[13.5px] text-muted">No questions yet{q ? ' match your search' : ''}.</p>}</div>
  </div>;
}
export function NewTopic({ categories }: { categories: string[] }) {
  const router = useRouter(); const toast = useToast(); const [v, setV] = useState({ category: categories[0] || 'General', title: '', body: '' }); const [busy, setBusy] = useState(false);
  return <div className="mx-auto flex max-w-2xl flex-col gap-4"><Link href="/portal/community" className="text-[13px] font-semibold text-muted hover:text-ink">← Community</Link><h1 className="font-display text-[26px] font-bold">Ask the community</h1>
    <p className="text-[13.5px] text-muted">Other customers and our engineers can see this. Don’t include licence keys, passwords or private details — for those, <Link className="text-accent hover:underline" href="/portal/new">open a private request</Link>.</p>
    <div className="panel grid gap-3.5 p-5"><Field label="Category"><Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Question" required><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. How do I exclude a folder from scanning?" /></Field>
      <Field label="Details" required><Textarea className="min-h-[160px]" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
      <div><Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); const r = await P.forumCreateTopic(v); setBusy(false); if (!r.ok) return toast(r.error, 'bad'); router.push(`/portal/community/${r.id}`); }}>Post question</Button></div></div></div>;
}
/** One topic with its replies. `mode` portal = customer; desk = moderator (agent). */
export function TopicView({ t, posts, mode, signedIn }: { t: TopicFull; posts: PostLite[]; mode: 'portal' | 'desk'; signedIn: boolean }) {
  const router = useRouter(); const toast = useToast(); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (p: Promise<{ ok: boolean; error?: string }>, ok?: string) => { const r = await p; if (!r.ok) return toast(r.error || 'Something went wrong', 'bad'); if (ok) toast(ok); router.refresh(); };
  const canMark = (mode === 'portal' && t.mine) || mode === 'desk';
  const mark = (id: string | null) => act(mode === 'portal' ? P.forumMarkAnswer(t.id, id) : DX.moderateTopic(t.id, { answerId: id }), id ? 'Marked as the answer' : 'Unmarked');
  const answer = posts.find((p) => p.id === t.answerId);
  return <div className="mx-auto flex max-w-3xl flex-col gap-4">
    <Link href={mode === 'portal' ? '/portal/community' : '/desk/community'} className="text-[13px] font-semibold text-muted hover:text-ink">← Community</Link>
    <div><div className="flex flex-wrap items-center gap-2"><Chip tone="outline">{t.category}</Chip>{t.answerId && <Chip tone="good">Answered</Chip>}{t.locked && <Chip>Locked</Chip>}{t.pinned && <Chip tone="accent">Pinned</Chip>}{t.hidden && <Chip tone="bad">Hidden from customers</Chip>}</div>
      <h1 className="mt-2 font-display text-[26px] font-bold leading-tight">{t.title}</h1><p className="text-xs text-muted">{t.authorName} · {timeAgo(t.createdAt)} · {t.views} views</p></div>
    {mode === 'desk' && <div className="flex flex-wrap gap-2 rounded-xl bg-sunken p-2.5">
      <Button size="sm" onClick={() => act(DX.moderateTopic(t.id, { pinned: !t.pinned }))}><Pin size={13} />{t.pinned ? 'Unpin' : 'Pin'}</Button>
      <Button size="sm" onClick={() => act(DX.moderateTopic(t.id, { locked: !t.locked }))}><Lock size={13} />{t.locked ? 'Unlock' : 'Lock'}</Button>
      <Button size="sm" onClick={() => act(DX.moderateTopic(t.id, { hidden: !t.hidden }))}><EyeOff size={13} />{t.hidden ? 'Show to customers' : 'Hide'}</Button>
      <Button size="sm" onClick={async () => { const r = await DX.topicToTicket(t.id); if (!r.ok) return toast(r.error, 'bad'); router.push(`/desk/tickets/${r.id}`); }}><TicketIcon size={13} />Turn into a ticket</Button></div>}
    <article className="panel p-5"><div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{t.body}</div></article>
    {answer && <div className="rounded-2xl border border-good/40 bg-good-soft p-4"><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-good"><CheckCircle2 size={14} />Accepted answer · {answer.authorName}</div><div className="whitespace-pre-wrap text-[14px]">{answer.body}</div></div>}
    <h2 className="font-display text-[17px] font-bold">{posts.length} repl{posts.length === 1 ? 'y' : 'ies'}</h2>
    {posts.map((p) => <article key={p.id} className={cn('rounded-2xl border px-4 py-3', p.agent ? 'border-accent/30 bg-accent-soft/50' : 'border-line bg-surface', p.hidden && 'opacity-50')}>
      <header className="mb-1 flex flex-wrap items-center gap-2 text-xs"><b>{p.authorName}</b>{p.agent && <Chip tone="accent">Raidefend</Chip>}<span className="text-muted">{timeAgo(p.createdAt)}</span>{p.id === t.answerId && <Chip tone="good">Answer</Chip>}
        <span className="flex-1" />{canMark && !p.hidden && <button className="font-semibold text-accent hover:underline" onClick={() => mark(p.id === t.answerId ? null : p.id)}>{p.id === t.answerId ? 'Unmark answer' : 'Mark as answer'}</button>}
        {mode === 'desk' && <button className="font-semibold text-muted hover:text-bad" onClick={() => act(DX.hideForumPost(p.id, !p.hidden))}>{p.hidden ? 'Show' : 'Hide'}</button>}</header>
      <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{p.body}</div></article>)}
    {t.locked ? <p className="text-[13px] text-muted">This topic is locked.</p> : (signedIn || mode === 'desk') ? <div className="panel p-5"><Field label="Your reply"><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[110px]" /></Field>
      <Button className="mt-3" variant="primary" disabled={busy || !body.trim()} onClick={async () => { setBusy(true); const r = mode === 'portal' ? await P.forumReply(t.id, body) : await DX.agentForumReply(t.id, body); setBusy(false); if (!r.ok) return toast(r.error || 'Something went wrong', 'bad'); setBody(''); router.refresh(); }}>Post reply</Button></div>
      : <p className="text-[13px] text-muted"><Link href="/portal/login" className="font-semibold text-accent hover:underline">Sign in</Link> to reply.</p>}
  </div>;
}
