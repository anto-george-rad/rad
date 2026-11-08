'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, BookOpen, ExternalLink, Eye, Plus, ThumbsUp } from 'lucide-react';
import type { KbArticle, KbCategory } from '@/db/schema';
import { Button, Chip, ConfirmButton, Empty, Field, Input, Modal, Panel, Segmented, Select, Textarea, useToast } from '../ui';
import { useApp } from '../app-context';
import { PageHeader } from '../shell';
import { SearchBox, useListParams } from '../list-controls';
import * as D from '@/lib/desk-actions';
import { renderMarkdown } from '@/lib/markdown';
import { cn, timeAgo } from '@/lib/utils';

type ArtRow = { id: string; title: string; slug: string; status: string; visibility: string; categoryId: string | null; views: number; helpful: number; notHelpful: number; updatedAt: Date; authorId: string | null };
export default function KbList({ cats, arts }: { cats: KbCategory[]; arts: ArtRow[] }) {
  const { me } = useApp(); const lp = useListParams(); const router = useRouter(); const toast = useToast(); const admin = me.deskRole === 'admin';
  const [cat, setCat] = useState<{ id?: string; name: string; description: string } | null>(null);
  const cur = lp.get('cat');
  return <>
    <PageHeader title="Knowledge base" sub="Help articles for customers (shown in the portal) and internal guides for the team."
      actions={<><a href="/portal" target="_blank" rel="noopener"><Button><ExternalLink size={15} />View portal</Button></a>{me.deskRole !== 'light' && <Link href="/desk/kb/new"><Button variant="primary"><Plus size={16} />New article</Button></Link>}</>} />
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex flex-wrap gap-1 lg:flex-col">
        <button onClick={() => lp.set({ cat: '' })} className={cn('rounded-lg px-3 py-2 text-left text-[13px] font-medium', !cur ? 'bg-surface font-semibold shadow-card' : 'text-muted hover:bg-sunken')}>All articles</button>
        {cats.map((c) => <div key={c.id} className="group flex items-center"><button onClick={() => lp.set({ cat: c.id })} className={cn('flex-1 rounded-lg px-3 py-2 text-left text-[13px] font-medium', cur === c.id ? 'bg-surface font-semibold shadow-card' : 'text-muted hover:bg-sunken')}>{c.name}</button>
          {admin && <button onClick={() => setCat({ id: c.id, name: c.name, description: c.description || '' })} className="px-2 text-xs text-muted opacity-0 hover:text-ink group-hover:opacity-100">Edit</button>}</div>)}
        {admin && <button onClick={() => setCat({ name: '', description: '' })} className="rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-accent hover:bg-sunken">+ Category</button>}
      </nav>
      <div className="min-w-0">
        <div className="mb-3"><SearchBox placeholder="Search articles" /></div>
        {arts.length ? <div className="panel">{arts.map((a) => <Link key={a.id} href={`/desk/kb/${a.id}`} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-raised">
          <BookOpen size={16} className="text-muted" /><div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold">{a.title}</div><div className="text-xs text-muted">{cats.find((c) => c.id === a.categoryId)?.name || 'Uncategorised'} · updated {timeAgo(a.updatedAt)}</div></div>
          {a.status === 'draft' && <Chip tone="warn">Draft</Chip>}{a.visibility === 'internal' && <Chip>Internal</Chip>}
          <span className="inline-flex items-center gap-1 text-xs text-muted"><Eye size={12} />{a.views}</span><span className="inline-flex items-center gap-1 text-xs text-muted"><ThumbsUp size={12} />{a.helpful}/{a.helpful + a.notHelpful}</span></Link>)}</div>
          : <div className="panel"><Empty icon={<BookOpen />} title="No articles yet" action={me.deskRole !== 'light' ? <Link href="/desk/kb/new"><Button variant="primary">Write the first article</Button></Link> : undefined}>Answer common questions once, then link them in replies.</Empty></div>}
      </div>
    </div>
    {cat && <Modal open onClose={() => setCat(null)} title={cat.id ? 'Edit category' : 'New category'} footer={<>{cat.id && <ConfirmButton className="mr-auto" confirmText="Delete category?" onConfirm={async () => { const r = await D.deleteKbCategory(cat.id!); if (!r.ok) toast(r.error, 'bad'); else { setCat(null); router.refresh(); } }}>Delete</ConfirmButton>}<Button variant="ghost" onClick={() => setCat(null)}>Cancel</Button>
      <Button variant="primary" onClick={async () => { const r = await D.saveKbCategory(cat); if (!r.ok) return toast(r.error, 'bad'); setCat(null); router.refresh(); }}>Save</Button></>}>
      <div className="grid gap-3 pb-3"><Field label="Name"><Input autoFocus value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} /></Field><Field label="Description"><Input value={cat.description} onChange={(e) => setCat({ ...cat, description: e.target.value })} /></Field></div></Modal>}
  </>;
}

export function KbEditor({ a, cats }: { a: KbArticle | null; cats: KbCategory[] }) {
  const { me } = useApp(); const toast = useToast(); const router = useRouter(); const admin = me.deskRole === 'admin';
  const readOnly = me.deskRole === 'light' || (!!a && a.status === 'published' && !admin);
  const [v, setV] = useState({ title: a?.title || '', body: a?.body || '', categoryId: a?.categoryId || '', status: (a?.status || 'draft') as 'draft' | 'published', visibility: (a?.visibility || 'public') as 'public' | 'internal', tags: a?.tags.join(', ') || '' });
  const [tab, setTab] = useState<'write' | 'preview'>(readOnly ? 'preview' : 'write'); const [busy, setBusy] = useState(false);
  const save = async (status = v.status) => { setBusy(true); const r = await D.saveArticle({ ...v, status, id: a?.id }); setBusy(false); if (!r.ok) return toast(r.error, 'bad'); toast(status === 'published' ? 'Published' : 'Saved'); if (!a) router.replace(`/desk/kb/${r.id}`); else router.refresh(); };
  return <div className="flex flex-col gap-4">
    <Link href="/desk/kb" className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />Knowledge base</Link>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="panel p-5">
        {readOnly ? <h1 className="font-display text-[28px] font-bold">{v.title}</h1> : <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Article title" className="!h-auto !py-2 font-display !text-[22px] font-bold" aria-label="Title" />}
        {!readOnly && <div className="my-3"><Segmented value={tab} onChange={setTab} options={[['write', 'Write'], ['preview', 'Preview']]} /></div>}
        {tab === 'write' && !readOnly ? <><Textarea value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="min-h-[420px] font-mono text-[13px]" aria-label="Article body" placeholder={'# Heading\n\nWrite steps with:\n1. numbered lists\n- bullet lists\n**bold**, `code`, [links](https://…)'} />
          <p className="mt-2 text-xs text-muted">Formatting: # heading, **bold**, *italic*, - bullets, 1. numbers, `code`, ``` code blocks ```, [text](https://link).</p></>
          : <div className="prose-rad mt-3" dangerouslySetInnerHTML={{ __html: renderMarkdown(v.body || '_Nothing here yet._') }} />}
      </section>
      <div className="flex flex-col gap-4">
        <Panel title="Publishing" bodyClass="grid gap-3 p-5">
          <Field label="Category"><Select disabled={readOnly} value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}><option value="">Uncategorised</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Who can read it"><Select disabled={readOnly} value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as 'public' })}><option value="public">Customers (portal) and team</option><option value="internal">Team only</option></Select></Field>
          <Field label="Tags" hint="Comma separated"><Input disabled={readOnly} value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} /></Field>
          <div className="flex items-center gap-2 text-[13px]">Status: <Chip tone={v.status === 'published' ? 'good' : 'warn'}>{v.status === 'published' ? 'Published' : 'Draft'}</Chip></div>
          {!readOnly && <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => save(admin ? v.status : 'draft')}>Save{v.status === 'draft' || !admin ? ' draft' : ''}</Button>
            {admin && v.status === 'draft' && <Button variant="primary" disabled={busy} onClick={() => { setV({ ...v, status: 'published' }); save('published'); }}>Publish</Button>}
            {admin && v.status === 'published' && <Button disabled={busy} onClick={() => { setV({ ...v, status: 'draft' }); save('draft'); }}>Unpublish</Button>}
          </div>}
          {!admin && !readOnly && <p className="text-xs text-muted">A helpdesk admin reviews and publishes drafts.</p>}
          {readOnly && me.deskRole !== 'light' && <p className="text-xs text-muted">Published articles can be changed by helpdesk admins.</p>}
        </Panel>
        {a && <Panel title="Stats" bodyClass="grid gap-1.5 p-5 text-[13px]"><div>Views: <b className="num">{a.views}</b></div><div>Helpful: <b className="num">{a.helpful}</b> · Not helpful: <b className="num">{a.notHelpful}</b></div>
          {a.status === 'published' && a.visibility === 'public' && <a className="inline-flex items-center gap-1 font-semibold text-accent hover:underline" href={`/portal/kb/${a.slug}`} target="_blank" rel="noopener">Open in portal <ExternalLink size={12} /></a>}
          {admin && <ConfirmButton className="mt-2 w-max" confirmText="Delete article?" onConfirm={async () => { const r = await D.deleteArticle(a.id); if (!r.ok) toast(r.error, 'bad'); else router.push('/desk/kb'); }}>Delete article</ConfirmButton>}</Panel>}
      </div>
    </div>
  </div>;
}
