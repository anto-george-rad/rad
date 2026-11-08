'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button, Field, Input, Menu, Modal, useToast } from './ui';
import * as A from '@/lib/actions';

/** Read and update list filters kept in the URL, so lists are shareable and survive refresh. */
export function useListParams() {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const get = (k: string) => sp.get(k) || '';
  const set = (patch: Record<string, string | number | null | undefined>, keepPage = false) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) n.delete(k); else n.set(k, String(v)); }
    if (!keepPage && !('page' in patch)) n.delete('page');
    const qs = n.toString(); router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  const sort: [string, 1 | -1] | undefined = sp.get('sort') ? [sp.get('sort')!, sp.get('dir') === 'desc' ? -1 : 1] : undefined;
  return { get, set, sp, sort, onSort: (key: string, dir: 1 | -1) => set({ sort: key, dir: dir === -1 ? 'desc' : 'asc' }) };
}
export function SearchBox({ placeholder }: { placeholder: string }) {
  const { get, set } = useListParams(); const [v, setV] = useState(get('q'));
  useEffect(() => { const t = setTimeout(() => { if (v !== get('q')) set({ q: v.trim() }); }, 300); return () => clearTimeout(t); }); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="relative w-full max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" /><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} /></div>;
}
export function Pager({ page, size, total }: { page: number; size: number; total: number }) {
  const { set } = useListParams(); const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <p className="mt-3 text-xs text-muted">{total} record{total === 1 ? '' : 's'}</p> : null;
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
    <span className="text-muted">{(page - 1) * size + 1}–{Math.min(total, page * size)} of {total}</span><span className="flex-1" />
    <Button size="sm" disabled={page <= 1} onClick={() => set({ page: page - 1 })} aria-label="Previous page"><ChevronLeft size={14} />Prev</Button>
    <span className="num text-muted">Page {page} / {pages}</span>
    <Button size="sm" disabled={page >= pages} onClick={() => set({ page: page + 1 })} aria-label="Next page">Next<ChevronRight size={14} /></Button>
  </div>;
}
export type View = { id: string; name: string; query: string };
/** Saved filters: store the current URL filters under a name, per person. */
export function ViewsMenu({ page, views }: { page: string; views: View[] }) {
  const { sp } = useListParams(); const router = useRouter(); const path = usePathname(); const toast = useToast();
  const [naming, setNaming] = useState(false); const [name, setName] = useState('');
  const current = new URLSearchParams(sp.toString()); current.delete('page'); const qs = current.toString();
  const active = views.find((v) => v.query === qs);
  return <>
    <Menu align="left" trigger={(t) => <Button onClick={t} variant={active ? 'soft' : 'secondary'}><Bookmark size={14} />{active ? active.name : 'Views'}</Button>}
      items={[...views.map((v) => [v.name, () => router.replace(v.query ? `${path}?${v.query}` : path)] as [string, () => void]), ...(views.length ? [null] : []),
        ['Save current filters…', () => { setName(''); setNaming(true); }], ...(active ? [[`Delete “${active.name}”`, async () => { const r = await A.deleteView(active.id); if (!r.ok) toast(r.error, 'bad'); else router.refresh(); }, 'danger'] as [string, () => void, 'danger']] : []),
        ...(qs ? [['Clear filters', () => router.replace(path)] as [string, () => void]] : [])]} />
    <Modal open={naming} onClose={() => setNaming(false)} title="Save view" sub="Keeps the current search, tab, filters and sort under a name. Only you see it."
      footer={<><Button variant="ghost" onClick={() => setNaming(false)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await A.saveView(page, name, qs); if (!r.ok) return toast(r.error, 'bad'); setNaming(false); toast('View saved'); router.refresh(); }}>Save</Button></>}>
      <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot Dubai leads" /></Field>
    </Modal>
  </>;
}
