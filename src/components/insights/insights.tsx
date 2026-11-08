'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, GripVertical, MoreHorizontal, Plus, X } from 'lucide-react';
import type { Tile, Visual } from '@/lib/insights-defaults';
import { defaultPages } from '@/lib/insights-defaults';
import type { DS } from '@/lib/insights-data';
import * as A from '@/lib/actions';
import { Button, Empty, Field, Input, Menu, Modal, Segmented, Select, useToast } from '../ui';
import { useApp } from '../app-context';
import { type Ctx, DATE_PRESETS, VISUALS, aggregate, autoTitle, dispLabel, fmtMon, rangeOf, sources } from './engine';
import { FIXED, TileBody } from './tile-view';
import { cn } from '@/lib/utils';

type Page = { id: string; name: string; sortOrder: number; tiles: Tile[] };
const VIS_ICON: Record<Visual, string> = {
  kpi: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 14h4M7 10h8"/>', column: '<path d="M5 20V11M10 20V6M15 20v-9M20 20V9"/>', bar: '<path d="M4 5h9M4 10h15M4 15h7M4 20h12"/>',
  stacked: '<path d="M6 20v-6M6 14V9M12 20v-9M12 11V4M18 20v-4M18 16v-6"/>', line: '<path d="m3 17 5-6 4 3 4-7 5 5"/>', area: '<path d="M3 20V15l5-5 4 3 5-6 4 4v9Z"/>',
  donut: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>', funnel: '<path d="M3 5h18M6 10h12M9 15h6M11 20h2"/>', table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
};
const VisIcon = ({ v }: { v: Visual }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: VIS_ICON[v] }} />;

export function useColorIdx(S: ReturnType<typeof sources>, data: DS) {
  return useMemo(() => {
    const cache = new Map<string, Map<string, number>>();
    return (ds: string, dim: string, v: string) => {
      const fx = FIXED[`${ds}.${dim}`]; if (fx && v in fx) return fx[v];
      if (v === 'Other') return 99;
      const key = `${ds}.${dim}`;
      if (!cache.has(key)) { const g = S[ds]?.dims[dim]?.f; const vals = new Set<string>(); if (g) for (const r of S[ds].rows(data)) { const x = g(r); for (const y of Array.isArray(x) ? x : [x]) if (y != null) vals.add(y); } cache.set(key, new Map([...vals].sort().map((x, i) => [x, i]))); }
      return cache.get(key)!.get(v) ?? 99;
    };
  }, [S, data]);
}

export default function Insights({ data, pages: initial }: { data: DS; pages: Page[] }) {
  const { me } = useApp(); const toast = useToast(); const router = useRouter();
  const S = useMemo(() => sources(data), [data]); const colorIdx = useColorIdx(S, data);
  const pages = initial.length ? initial : defaultPages().map((p, i) => ({ id: `def${i}`, sortOrder: i, ...p }));
  const [pageId, setPageId] = useState(pages[0]?.id); const page = pages.find((p) => p.id === pageId) || pages[0];
  const [date, setDate] = useState('all'); const [pipe, setPipe] = useState(''); const [mine, setMine] = useState<'all' | 'mine'>('all');
  const [cross, setCross] = useState<Ctx['cross']>([]);
  const [builder, setBuilder] = useState<Tile | null | 'new'>(null); const [focus, setFocus] = useState<Tile | null>(null); const [dataView, setDataView] = useState<Tile | null>(null);
  const [pageModal, setPageModal] = useState<'' | 'new' | 'rename' | 'delete'>(''); const [pageName, setPageName] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const ctx: Ctx = useMemo(() => ({ range: rangeOf(date), mine: mine === 'mine' ? me.id : null, pipe, cross }), [date, mine, me.id, pipe, cross]);
  const onCross = useCallback((ds: string, dim: string, value: string) => setCross((c) => { const i = c.findIndex((x) => x.ds === ds && x.dim === dim); if (i >= 0 && c[i].value === value) return c.filter((_, j) => j !== i); return [...c.filter((x) => !(x.ds === ds && x.dim === dim)), { ds, dim, value }]; }), []);
  const savePage = async (p: Page, msg?: string) => { const r = await A.saveReportPage({ id: p.id.startsWith('def') ? undefined : p.id, name: p.name, tiles: p.tiles }); if (!r.ok) toast(r.error, 'bad'); else { if (msg) toast(msg); if (p.id.startsWith('def')) setPageId(r.id); router.refresh(); } };
  const mutate = (fn: (tiles: Tile[]) => Tile[], msg?: string) => savePage({ ...page, tiles: fn([...page.tiles]) }, msg);
  const csv = (t: Tile) => {
    const agg = aggregate(S, data, t, ctx); const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = t.visual === 'kpi' ? `${q(t.title || autoTitle(S, t))}\n${agg.kpi}` : [[agg.dim?.l, ...agg.series.map((s) => (agg.series.length > 1 ? s.name : agg.m.l))], ...agg.labels.map((l, i) => [dispLabel(agg, l), ...agg.series.map((s) => Math.round(s.data[i] * 100) / 100)])].map((r) => r.map(q).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = `${(t.title || autoTitle(S, t)).replace(/[^\w\- ]+/g, '')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return <div>
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><h1 className="font-display text-[28px] font-bold tracking-tight">Insights</h1><p className="text-[13.5px] text-muted">Build reports from your CRM data. Click any bar, slice or row to filter the whole page.</p></div>
      <Button variant="primary" onClick={() => setBuilder('new')}><Plus size={16} />Add visual</Button>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {pages.map((p) => <button key={p.id} onClick={() => { setPageId(p.id); setCross([]); }} className={cn('rounded-[10px] border px-3.5 py-1.5 text-[13px] font-semibold transition', p.id === page.id ? 'border-line bg-surface text-ink shadow-card' : 'border-transparent text-muted hover:bg-sunken hover:text-ink')}>{p.name}</button>)}
      <button onClick={() => { setPageName(''); setPageModal('new'); }} className="rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-muted hover:bg-sunken hover:text-ink">+ Page</button>
      <span className="flex-1" />
      <Menu trigger={(t) => <Button size="sm" variant="ghost" onClick={t}><MoreHorizontal size={16} />Page</Button>} items={[
        ['Rename page', () => { setPageName(page.name); setPageModal('rename'); }],
        ['Duplicate page', async () => { const r = await A.saveReportPage({ name: `${page.name} (copy)`, tiles: page.tiles.map((t) => ({ ...t, id: crypto.randomUUID() })) }); if (r.ok) { setPageId(r.id); router.refresh(); toast('Page duplicated'); } else toast(r.error, 'bad'); }],
        ['Reset to the starting layout', () => { const d = defaultPages().find((x) => x.name === page.name); if (!d) { toast('Only the starting pages can be reset', 'bad'); return; } savePage({ ...page, tiles: d.tiles }, 'Layout reset'); }],
        null, ['Delete page', () => setPageModal('delete'), 'danger'],
      ]} />
    </div>
    <div className="panel mb-3 flex flex-wrap items-center gap-3 px-4 py-2.5">
      <label className="flex items-center gap-2 text-xs font-semibold text-muted">Period<Select className="h-8 w-auto py-1" value={date} onChange={(e) => setDate(e.target.value)}>{DATE_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
      <label className="flex items-center gap-2 text-xs font-semibold text-muted">Pipeline<Select className="h-8 w-auto py-1" value={pipe} onChange={(e) => setPipe(e.target.value)}><option value="">All pipelines</option>{data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
      <Segmented size="sm" value={mine} onChange={setMine} options={[['all', 'Everyone'], ['mine', 'Mine']]} />
      {cross.length > 0 && <><span className="h-5 w-px bg-line" />{cross.map((c) => <button key={c.ds + c.dim} onClick={() => setCross((x) => x.filter((y) => y !== c))} className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-3 pr-2 text-xs font-semibold text-accent">{S[c.ds].dims[c.dim]?.l}: {S[c.ds].dims[c.dim]?.time ? fmtMon(c.value) : c.value}<X size={13} /></button>)}<Button size="sm" variant="ghost" onClick={() => setCross([])}>Clear</Button></>}
    </div>
    {page.tiles.length === 0 ? <div className="panel"><Empty icon={<BarChart3 />} title="This page is empty" action={<Button variant="primary" onClick={() => setBuilder('new')}>Add your first visual</Button>}>Pick data, a chart type and how to slice it.</Empty></div> :
      <div className="grid grid-cols-12 gap-3.5">
        {page.tiles.map((t) => { const agg = aggregate(S, data, t, ctx); return <article key={t.id} draggable onDragStart={() => setDrag(t.id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (!drag || drag === t.id) return; mutate((ts) => { const from = ts.findIndex((x) => x.id === drag); const [it] = ts.splice(from, 1); ts.splice(ts.findIndex((x) => x.id === t.id), 0, it); return ts; }); }}
          className={cn('panel col-span-12 flex min-w-0 flex-col animate-rise', t.size === 's' ? 'sm:col-span-6 xl:col-span-3' : t.size === 'l' ? '' : 'lg:col-span-6', drag === t.id && 'opacity-50')}>
          <header className="flex items-start gap-2 px-4 pb-1 pt-3.5">
            <GripVertical size={15} className="mt-0.5 flex-none cursor-grab text-faint" />
            <div className="min-w-0 flex-1"><h3 className="truncate text-[13.5px] font-bold" title={t.title || autoTitle(S, t)}>{t.title || autoTitle(S, t)}</h3>
              <p className="truncate text-[11.5px] text-muted">{[S[t.ds].label, ...(t.filters || []).filter((f) => f.value).map((f) => `${S[t.ds].dims[f.dim]?.l} ${f.op === 'not' ? '≠' : '='} ${f.value}`)].join(' · ')}</p></div>
            <Menu trigger={(o) => <button onClick={o} aria-label="Visual options" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink"><MoreHorizontal size={16} /></button>} items={[
              ['Edit visual', () => setBuilder(t)], ['Duplicate', () => mutate((ts) => { ts.splice(ts.indexOf(t) + 1, 0, { ...t, id: crypto.randomUUID(), title: t.title ? `${t.title} (copy)` : '' }); return ts; })],
              ...(['s', 'm', 'l'] as const).filter((s) => s !== (t.size || 'm')).map((s) => [`Size: ${{ s: 'Small', m: 'Medium', l: 'Full width' }[s]}`, () => mutate((ts) => ts.map((x) => (x.id === t.id ? { ...x, size: s } : x)))] as [string, () => void]),
              null, ['Focus mode', () => setFocus(t)], ['View data as table', () => setDataView(t)], ['Export data (CSV)', () => csv(t)], null,
              ['Remove visual', () => mutate((ts) => ts.filter((x) => x.id !== t.id), 'Visual removed'), 'danger'],
            ]} />
          </header>
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2"><TileBody t={t} agg={agg} ctx={ctx} colorIdx={colorIdx} onCross={onCross} /></div>
        </article>; })}
        <button onClick={() => setBuilder('new')} className="col-span-12 grid min-h-[140px] place-items-center rounded-xl border-[1.5px] border-dashed border-line text-[14px] font-semibold text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent sm:col-span-6 xl:col-span-3"><span className="flex items-center gap-2"><Plus size={18} />Add visual</span></button>
      </div>}

    {builder && <Builder S={S} data={data} ctx={ctx} colorIdx={colorIdx} tile={builder === 'new' ? null : builder} onClose={() => setBuilder(null)}
      onSave={(t) => { const exists = page.tiles.some((x) => x.id === t.id); mutate((ts) => (exists ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]), exists ? 'Visual updated' : 'Visual added'); setBuilder(null); }} />}
    {focus && <Modal open wide onClose={() => setFocus(null)} title={focus.title || autoTitle(S, focus)} sub={S[focus.ds].label}><div className="pb-4"><TileBody t={focus} agg={aggregate(S, data, focus, ctx)} ctx={ctx} colorIdx={colorIdx} tall /></div></Modal>}
    {dataView && <Modal open onClose={() => setDataView(null)} title={dataView.title || autoTitle(S, dataView)} sub="The numbers behind this visual, with the current filters." footer={<Button onClick={() => csv(dataView)}>Export CSV</Button>}>
      <div className="pb-3"><TileBody t={{ ...dataView, visual: dataView.visual === 'kpi' ? 'kpi' : 'table' }} agg={aggregate(S, data, { ...dataView, visual: dataView.visual === 'kpi' ? 'kpi' : 'table' }, ctx)} ctx={ctx} colorIdx={colorIdx} tall /></div></Modal>}
    <Modal open={pageModal === 'new' || pageModal === 'rename'} onClose={() => setPageModal('')} title={pageModal === 'new' ? 'New report page' : 'Rename page'}
      footer={<><Button variant="ghost" onClick={() => setPageModal('')}>Cancel</Button><Button variant="primary" onClick={async () => { if (!pageName.trim()) return; if (pageModal === 'new') { const r = await A.saveReportPage({ name: pageName, tiles: [] }); if (r.ok) { setPageId(r.id); router.refresh(); } else toast(r.error, 'bad'); } else await savePage({ ...page, name: pageName }); setPageModal(''); }}>Save</Button></>}>
      <Field label="Page name"><Input autoFocus value={pageName} onChange={(e) => setPageName(e.target.value)} /></Field>
    </Modal>
    <Modal open={pageModal === 'delete'} onClose={() => setPageModal('')} title={`Delete “${page.name}”?`} sub="Its visuals are removed for everyone. This cannot be undone."
      footer={<><Button variant="ghost" onClick={() => setPageModal('')}>Cancel</Button><Button variant="danger" onClick={async () => { const r = await A.deleteReportPage(page.id); setPageModal(''); if (!r.ok) toast(r.error, 'bad'); else { setPageId(pages.find((p) => p.id !== page.id)?.id || ''); router.refresh(); } }}>Delete page</Button></>}><span /></Modal>
  </div>;
}

function Builder({ S, data, ctx, colorIdx, tile, onClose, onSave }: { S: ReturnType<typeof sources>; data: DS; ctx: Ctx; colorIdx: ReturnType<typeof useColorIdx>; tile: Tile | null; onClose: () => void; onSave: (t: Tile) => void }) {
  const [t, setT] = useState<Tile>(() => tile ? structuredClone(tile) : { id: crypto.randomUUID(), ds: 'deals', visual: 'column', measure: 'sum', groupBy: 'stage', seriesBy: '', dateField: 'createdAt', filters: [], size: 'm', title: '' });
  const D = S[t.ds]; const dims = Object.entries(D.dims);
  const up = (p: Partial<Tile>) => setT((o) => ({ ...o, ...p }));
  const f0 = t.filters?.[0] || { dim: '', op: 'is' as const, value: '' };
  const distinct = useMemo(() => { const g = D.dims[f0.dim]?.f; if (!g) return []; const s = new Set<string>(); for (const r of D.rows(data)) { const v = g(r); for (const x of Array.isArray(v) ? v : [v]) if (x != null && x !== '') s.add(x); } const dd = D.dims[f0.dim]; const a = [...s]; return dd.order ? a.sort((x, y) => dd.order!.indexOf(x) - dd.order!.indexOf(y)) : a.sort(); }, [D, f0.dim, data]);
  const setFilter = (p: Partial<typeof f0>) => { const nf = { ...f0, ...p }; up({ filters: nf.dim ? [nf, ...(t.filters || []).slice(1)] : (t.filters || []).slice(1) }); };
  const clean: Tile = { ...t, filters: (t.filters || []).filter((f) => f.dim && f.value) };
  const useAppDesk = useApp().me.deskRole !== 'none';
  const agg = useMemo(() => aggregate(S, data, clean, { ...ctx, cross: [] }), [S, data, clean, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const noGroup = t.visual === 'kpi'; const noSeries = ['kpi', 'donut', 'funnel'].includes(t.visual);
  return <Modal open wide onClose={onClose} title={tile ? 'Edit visual' : 'Add a visual'} sub="Pick the data and a chart type. The preview uses this page’s filters."
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave({ ...clean, seriesBy: noSeries ? '' : clean.seriesBy })}>{tile ? 'Save' : 'Add to page'}</Button></>}>
    <div className="grid gap-5 pb-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Chart type">{VISUALS.map(([k, l]) => <button key={k} type="button" aria-pressed={t.visual === k}
          onClick={() => up({ visual: k, seriesBy: k === 'stacked' && !t.seriesBy ? Object.keys(D.dims).find((d) => d !== t.groupBy && !D.dims[d].time) : t.seriesBy })}
          className={cn('flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold transition', t.visual === k ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink')}><VisIcon v={k} />{l}</button>)}</div>
        <Field label="Data"><Select value={t.ds} onChange={(e) => { const ds = e.target.value as Tile['ds']; const nd = S[ds]; up({ ds, measure: Object.keys(nd.measures)[0], groupBy: Object.keys(nd.dims)[0], seriesBy: '', filters: [], dateField: nd.defDate }); }}>{Object.entries(S).filter(([k]) => k !== 'tickets' || useAppDesk).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        <Field label="Value"><Select value={t.measure} onChange={(e) => up({ measure: e.target.value })}>{Object.entries(D.measures).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select></Field>
        {!noGroup && <Field label="Group by (axis)"><Select value={t.groupBy} onChange={(e) => up({ groupBy: e.target.value, seriesBy: t.seriesBy === e.target.value ? '' : t.seriesBy })}>{dims.map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select></Field>}
        {!noSeries && <Field label="Split by (legend)"><Select value={t.seriesBy || ''} onChange={(e) => up({ seriesBy: e.target.value })}><option value="">No split</option>{dims.filter(([k]) => k !== t.groupBy).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select></Field>}
        <Field label="Period filter applies to"><Select value={t.dateField || D.defDate} onChange={(e) => up({ dateField: e.target.value })}>{Object.entries(D.dates).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}<option value="none">Ignore the period filter</option></Select></Field>
        <Field label="Only include">
          <div className="flex gap-1.5"><Select value={f0.dim} onChange={(e) => setFilter({ dim: e.target.value, value: '' })} className="flex-1"><option value="">Everything</option>{dims.map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select>
            {f0.dim && <Select value={f0.op} onChange={(e) => setFilter({ op: e.target.value as 'is' })} className="w-[84px]"><option value="is">is</option><option value="not">is not</option></Select>}</div>
          {f0.dim && <Select value={f0.value} onChange={(e) => setFilter({ value: e.target.value })}><option value="">Choose…</option>{distinct.map((v) => <option key={v} value={v}>{D.dims[f0.dim].time ? fmtMon(v) : v}</option>)}</Select>}
          {(t.filters?.length || 0) > 1 && <span className="font-normal text-faint">+ {(t.filters?.length || 1) - 1} more filter(s) kept</span>}
        </Field>
        <div className="flex gap-2">
          {!noGroup && <Field label="Show" className="flex-1"><Select value={t.topN == null ? '' : String(t.topN)} onChange={(e) => up({ topN: e.target.value === '' ? undefined : +e.target.value })}><option value="">Auto</option><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></Select></Field>}
          <Field label="Size" className="flex-1"><Select value={t.size || 'm'} onChange={(e) => up({ size: e.target.value as 'm' })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Full width</option></Select></Field>
        </div>
        <Field label="Title"><Input value={t.title || ''} placeholder={autoTitle(S, clean)} onChange={(e) => up({ title: e.target.value })} /></Field>
      </div>
      <div className="flex min-w-0 flex-col rounded-xl bg-bg p-4">
        <span className="eyebrow mb-2">Preview</span>
        <div className="panel flex min-w-0 flex-1 flex-col p-4"><h3 className="text-[13.5px] font-bold">{t.title || autoTitle(S, clean)}</h3><p className="mb-3 text-[11.5px] text-muted">{D.label}</p>
          <TileBody t={clean} agg={agg} ctx={{ ...ctx, cross: [] }} colorIdx={colorIdx} /></div>
      </div>
    </div>
  </Modal>;
}
