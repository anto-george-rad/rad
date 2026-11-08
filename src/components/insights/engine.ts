import type { Tile, Visual } from '@/lib/insights-defaults';
import type { DS } from '@/lib/insights-data';
import { DAY, fmtMoney, fmtShort } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
export type Dim = { l: string; f: (r: Row) => any; time?: boolean; order?: string[]; ord?: (v: string) => number };
export type Measure = { l: string; f: (rs: Row[]) => number; k: 'money' | 'n' | 'pct' | 'days'; add?: boolean };
type Source = { label: string; rows: (d: DS) => Row[]; defDate: string; dims: Record<string, Dim>; measures: Record<string, Measure>; dates: Record<string, { l: string; f: (r: Row) => number | null }> };

const sum = (rs: Row[], k: string) => rs.reduce((s, r) => s + (+r[k] || 0), 0);
export const mon = (ms: number | null) => { if (!ms) return null; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const fmtMon = (k: string) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); };

export function sources(d: DS): Record<string, Source> {
  const avg = (rs: Row[], k: string) => { const x = rs.filter((r) => r[k] != null); return x.length ? Math.round(x.reduce((a, r) => a + r[k], 0) / x.length * 10) / 10 : 0; };
  return {
    tickets: { label: 'Tickets', rows: (x) => x.tickets || [], defDate: 'createdAt',
      dims: { status: { l: 'Status group', f: (r) => r.status, order: ['Open', 'On hold', 'Closed'] }, statusName: { l: 'Status', f: (r) => r.statusName }, priority: { l: 'Priority', f: (r) => r.priority, order: ['Urgent', 'High', 'Medium', 'Low'] },
        channel: { l: 'Channel', f: (r) => r.channel }, department: { l: 'Department', f: (r) => r.department }, assignee: { l: 'Assignee', f: (r) => r.assignee }, type: { l: 'Type', f: (r) => r.type }, category: { l: 'Category', f: (r) => r.category },
        company: { l: 'Company', f: (r) => r.company }, product: { l: 'Product', f: (r) => r.product }, sla: { l: 'SLA', f: (r) => r.sla, order: ['Met', 'In progress', 'Missed'] }, rating: { l: 'Satisfaction', f: (r) => r.rating, order: ['Great', 'Okay', 'Not good', 'Not rated'] },
        tag: { l: 'Tag', f: (r) => r.tags }, createdMonth: { l: 'Month created', f: (r) => mon(r.createdAt), time: true }, resolvedMonth: { l: 'Month resolved', f: (r) => mon(r.resolvedAt), time: true } },
      measures: { count: { l: 'Number of tickets', f: (rs) => rs.length, k: 'n', add: true }, frt: { l: 'Avg first response (business hours)', f: (rs) => avg(rs, 'firstResponseHrs'), k: 'n' },
        art: { l: 'Avg resolution (business hours)', f: (rs) => avg(rs, 'resolutionHrs'), k: 'n' },
        sla: { l: 'SLA met', f: (rs) => { const m = rs.filter((r) => r.sla === 'Met').length, x = rs.filter((r) => r.sla === 'Missed').length; return m + x ? Math.round(m / (m + x) * 100) : 0; }, k: 'pct' },
        csat: { l: 'Customer satisfaction', f: (rs) => { const r = rs.filter((x) => x.rating !== 'Not rated'); return r.length ? Math.round(r.filter((x) => x.rating === 'Great').length / r.length * 100) : 0; }, k: 'pct' } },
      dates: { createdAt: { l: 'Created date', f: (r) => r.createdAt }, resolvedAt: { l: 'Resolved date', f: (r) => r.resolvedAt } } },
    deals: { label: 'Deals', rows: (x) => x.deals, defDate: 'createdAt',
      dims: { status: { l: 'Status', f: (r) => r.status, order: ['Open', 'Won', 'Lost'] }, pipeline: { l: 'Pipeline', f: (r) => r.pipeline }, stage: { l: 'Stage', f: (r) => r.stage, ord: (v) => d.stageOrder[v] ?? 9999 },
        owner: { l: 'Owner', f: (r) => r.owner }, priority: { l: 'Priority', f: (r) => r.priority, order: ['High', 'Medium', 'Low'] }, company: { l: 'Company', f: (r) => r.company }, industry: { l: 'Industry', f: (r) => r.industry },
        tag: { l: 'Tag', f: (r) => r.tags }, lossReason: { l: 'Loss reason', f: (r) => r.lossReason }, winReason: { l: 'Win reason', f: (r) => r.winReason }, currency: { l: 'Currency', f: (r) => r.currency },
        dealType: { l: 'Deal type', f: (r) => r.dealType, order: ['New business', 'Upsell', 'Renewal'] }, leadSource: { l: 'Lead source', f: (r) => r.leadSource }, emirate: { l: 'Emirate', f: (r) => r.emirate }, accountType: { l: 'Account type', f: (r) => r.accountType },
        distributor: { l: 'Distributor', f: (r) => r.distributor }, reseller: { l: 'Reseller', f: (r) => r.reseller }, forecast: { l: 'Forecast category', f: (r) => r.forecast, order: ['Commit', 'Best case', 'Pipeline'] },
        createdMonth: { l: 'Month created', f: (r) => mon(r.createdAt), time: true }, closedMonth: { l: 'Month closed', f: (r) => mon(r.closedAt), time: true }, closingMonth: { l: 'Expected close month', f: (r) => mon(r.closingDate), time: true } },
      measures: { sum: { l: 'Amount (AED)', f: (rs) => sum(rs, 'amount'), k: 'money', add: true }, count: { l: 'Number of deals', f: (rs) => rs.length, k: 'n', add: true },
        weighted: { l: 'Weighted amount (AED)', f: (rs) => sum(rs, 'weighted'), k: 'money', add: true }, avg: { l: 'Average deal size (AED)', f: (rs) => rs.length ? sum(rs, 'amount') / rs.length : 0, k: 'money' },
        winRate: { l: 'Win rate', f: (rs) => { const w = rs.filter((r) => r.status === 'Won').length, l = rs.filter((r) => r.status === 'Lost').length; return w + l ? Math.round(w / (w + l) * 100) : 0; }, k: 'pct' },
        cycle: { l: 'Days to win (avg)', f: (rs) => { const w = rs.filter((r) => r.status === 'Won' && r.closedAt); return w.length ? Math.round(w.reduce((s, r) => s + (r.closedAt - r.createdAt) / DAY, 0) / w.length) : 0; }, k: 'days' } },
      dates: { createdAt: { l: 'Created date', f: (r) => r.createdAt }, closedAt: { l: 'Closed date', f: (r) => r.closedAt }, closingDate: { l: 'Expected close date', f: (r) => r.closingDate } } },
    leads: { label: 'Leads', rows: (x) => x.leads, defDate: 'createdAt',
      dims: { status: { l: 'Status', f: (r) => r.status, order: ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'] }, source: { l: 'Source', f: (r) => r.source }, score: { l: 'Score band', f: (r) => r.band, order: ['Hot', 'Warm', 'Cold'] },
        owner: { l: 'Owner', f: (r) => r.owner }, company: { l: 'Company', f: (r) => r.company }, tag: { l: 'Tag', f: (r) => r.tags }, campaign: { l: 'Campaign', f: (r) => r.campaign }, emirate: { l: 'Emirate', f: (r) => r.emirate },
        disqualReason: { l: 'Disqualification reason', f: (r) => r.disqualReason }, createdMonth: { l: 'Month created', f: (r) => mon(r.createdAt), time: true } },
      measures: { count: { l: 'Number of leads', f: (rs) => rs.length, k: 'n', add: true }, firstContact: { l: 'Days to first contact (avg)', f: (rs) => { const x = rs.filter((r) => r.firstContactDays != null); return x.length ? Math.round(x.reduce((a, r) => a + r.firstContactDays, 0) / x.length * 10) / 10 : 0; }, k: 'days' }, avgScore: { l: 'Average score', f: (rs) => rs.length ? Math.round(sum(rs, 'score') / rs.length) : 0, k: 'n' },
        conv: { l: 'Conversion rate', f: (rs) => rs.length ? Math.round(rs.filter((r) => r.status === 'Converted').length / rs.length * 100) : 0, k: 'pct' } },
      dates: { createdAt: { l: 'Created date', f: (r) => r.createdAt } } },
    activities: { label: 'Activities', rows: (x) => x.activities, defDate: 'due',
      dims: { type: { l: 'Type', f: (r) => r.type }, status: { l: 'Status', f: (r) => r.status, order: ['Overdue', 'Open', 'Done'] }, owner: { l: 'Owner', f: (r) => r.owner }, related: { l: 'Related to', f: (r) => r.related }, outcome: { l: 'Outcome', f: (r) => r.outcome }, dueMonth: { l: 'Month due', f: (r) => mon(r.due), time: true } },
      measures: { count: { l: 'Number of activities', f: (rs) => rs.length, k: 'n', add: true } },
      dates: { due: { l: 'Due date', f: (r) => r.due }, createdAt: { l: 'Created date', f: (r) => r.createdAt } } },
    contacts: { label: 'Contacts', rows: (x) => x.contacts, defDate: 'createdAt',
      dims: { company: { l: 'Company', f: (r) => r.company }, source: { l: 'Source', f: (r) => r.source }, owner: { l: 'Owner', f: (r) => r.owner }, tag: { l: 'Tag', f: (r) => r.tags }, createdMonth: { l: 'Month created', f: (r) => mon(r.createdAt), time: true } },
      measures: { count: { l: 'Number of contacts', f: (rs) => rs.length, k: 'n', add: true } }, dates: { createdAt: { l: 'Created date', f: (r) => r.createdAt } } },
    companies: { label: 'Companies', rows: (x) => x.companies, defDate: 'createdAt',
      dims: { industry: { l: 'Industry', f: (r) => r.industry }, accountType: { l: 'Account type', f: (r) => r.accountType }, emirate: { l: 'Emirate', f: (r) => r.emirate }, tier: { l: 'Tier', f: (r) => r.tier }, city: { l: 'City', f: (r) => r.city }, country: { l: 'Country', f: (r) => r.country }, name: { l: 'Company', f: (r) => r.name }, createdMonth: { l: 'Month created', f: (r) => mon(r.createdAt), time: true } },
      measures: { count: { l: 'Number of companies', f: (rs) => rs.length, k: 'n', add: true }, open: { l: 'Open deal value (AED)', f: (rs) => sum(rs, 'openValue'), k: 'money', add: true }, won: { l: 'Won deal value (AED)', f: (rs) => sum(rs, 'wonValue'), k: 'money', add: true } },
      dates: { createdAt: { l: 'Created date', f: (r) => r.createdAt } } },
  };
}

export type Ctx = { range: [number, number] | null; mine: string | null; pipe: string; cross: { ds: string; dim: string; value: string }[]; static?: boolean };
export const DATE_PRESETS: [string, string][] = [['all', 'All time'], ['mtd', 'This month'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['qtd', 'This quarter'], ['ytd', 'This year'], ['365', 'Last 12 months']];
export function rangeOf(p: string): [number, number] | null {
  if (!p || p === 'all') return null; const now = new Date();
  if (['30', '90', '365'].includes(p)) return [Date.now() - +p * DAY, Date.now() + DAY];
  const s = p === 'mtd' ? new Date(now.getFullYear(), now.getMonth(), 1) : p === 'qtd' ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1) : new Date(now.getFullYear(), 0, 1);
  return [s.getTime(), Date.now() + DAY];
}
export function fmtVal(v: number, k: Measure['k'], long = false) {
  v = +v || 0;
  if (k === 'money') return long ? fmtMoney(v) : `AED ${fmtShort(v)}`;
  if (k === 'pct') return `${Math.round(v)}%`;
  if (k === 'days') return `${Math.round(v)}${long ? ' days' : 'd'}`;
  return Math.round(v).toLocaleString('en-GB');
}
export const measureOf = (S: Record<string, Source>, t: Tile) => S[t.ds].measures[t.measure] || Object.values(S[t.ds].measures)[0];
export function autoTitle(S: Record<string, Source>, t: Tile) {
  const D = S[t.ds]; if (!D) return 'Visual'; const m = measureOf(S, t);
  if (t.visual === 'kpi') return m.l;
  const g = t.groupBy ? D.dims[t.groupBy] : undefined; const s = t.seriesBy ? D.dims[t.seriesBy] : undefined;
  return `${m.l.replace(/ \(AED\)/, '')} by ${g?.l.toLowerCase() || '—'}${s ? ' and ' + s.l.toLowerCase() : ''}`;
}
function filterRows(S: Record<string, Source>, data: DS, t: Tile, ctx: Ctx, range?: [number, number] | null) {
  const D = S[t.ds]; let rows = D.rows(data);
  if (ctx.mine) rows = rows.filter((r) => r.ownerId === ctx.mine);
  if (ctx.pipe && t.ds === 'deals') rows = rows.filter((r) => r.pipelineId === ctx.pipe);
  const df = t.dateField || D.defDate; const rg = range === undefined ? ctx.range : range;
  if (df !== 'none' && rg && D.dates[df]) { const g = D.dates[df].f; rows = rows.filter((r) => { const v = g(r); return v != null && v >= rg[0] && v < rg[1]; }); }
  for (const f of t.filters || []) {
    const g = D.dims[f.dim]?.f; if (!g || !f.value) continue;
    rows = rows.filter((r) => { const v = g(r); const has = Array.isArray(v) ? v.includes(f.value) : v === f.value; return f.op === 'not' ? !has : has; });
  }
  for (const c of ctx.cross) {
    if (c.ds !== t.ds && c.dim !== 'owner') continue;
    if (c.ds === t.ds && c.dim === t.groupBy && t.visual !== 'kpi') continue; // highlighted instead of filtered
    const g = D.dims[c.dim]?.f; if (!g) continue;
    rows = rows.filter((r) => { const v = g(r); return Array.isArray(v) ? v.includes(c.value) : v === c.value; });
  }
  return rows;
}
export type Agg = { kpi?: number; prev?: number; m: Measure; rows: Row[]; labels: string[]; series: { name: string; data: number[] }[]; dim?: Dim; gkey?: string; total?: number | null };
export function aggregate(S: Record<string, Source>, data: DS, t: Tile, ctx: Ctx): Agg {
  const D = S[t.ds]; const m = measureOf(S, t); const rows = filterRows(S, data, t, ctx);
  if (t.visual === 'kpi') {
    const out: Agg = { kpi: m.f(rows), m, rows, labels: [], series: [] };
    const df = t.dateField || D.defDate;
    if (ctx.range && df !== 'none') { const len = ctx.range[1] - ctx.range[0]; out.prev = m.f(filterRows(S, data, t, ctx, [ctx.range[0] - len, ctx.range[0]])); }
    return out;
  }
  const gkey = t.groupBy && D.dims[t.groupBy] ? t.groupBy : Object.keys(D.dims)[0]; const dim = D.dims[gkey];
  const sdim = t.seriesBy && t.seriesBy !== gkey && !['donut', 'funnel'].includes(t.visual) ? D.dims[t.seriesBy] : undefined;
  const groups = new Map<string, Row[]>();
  for (const r of rows) { let v = dim.f(r); if (v == null) continue; v = Array.isArray(v) ? (v.length ? v : ['(none)']) : [v]; for (const k of v) { if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); } }
  let labels = [...groups.keys()];
  if (dim.time) {
    if (t.months) { labels = []; const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (t.months - 1)); for (let i = 0; i < t.months; i++) { labels.push(mon(d.getTime())!); d.setMonth(d.getMonth() + 1); } }
    else if (labels.length) { labels.sort(); const out: string[] = []; let [y, mm] = labels[0].split('-').map(Number); const [y1, m1] = labels[labels.length - 1].split('-').map(Number); for (let i = 0; i < 48 && (y < y1 || (y === y1 && mm <= m1)); i++) { out.push(`${y}-${String(mm).padStart(2, '0')}`); if (++mm > 12) { mm = 1; y++; } } labels = out; }
  } else if (dim.order) labels.sort((a, b) => { const ia = dim.order!.indexOf(a), ib = dim.order!.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  else if (dim.ord) labels.sort((a, b) => dim.ord!(a) - dim.ord!(b));
  else labels.sort((a, b) => m.f(groups.get(b) || []) - m.f(groups.get(a) || []));
  const topN = t.topN === 0 ? 0 : (t.topN || (t.visual === 'donut' ? 6 : 10));
  if (!dim.time && topN && labels.length > topN) {
    const keep = (dim.order || dim.ord ? [...labels].sort((a, b) => m.f(groups.get(b)!) - m.f(groups.get(a)!)) : labels).slice(0, topN);
    const rest = labels.filter((l) => !keep.includes(l)); labels = labels.filter((l) => keep.includes(l));
    if (m.add) { groups.set('Other', rest.flatMap((l) => groups.get(l)!)); labels.push('Other'); }
  }
  let series: Agg['series'];
  if (sdim) {
    const counts = new Map<string, number>();
    for (const r of rows) { const v = sdim.f(r); if (v == null) continue; for (const k of Array.isArray(v) ? (v.length ? v : ['(none)']) : [v]) counts.set(k, (counts.get(k) || 0) + 1); }
    let keys = [...counts.keys()];
    if (sdim.order) keys.sort((a, b) => sdim.order!.indexOf(a) - sdim.order!.indexOf(b)); else if (sdim.ord) keys.sort((a, b) => sdim.ord!(a) - sdim.ord!(b)); else if (sdim.time) keys.sort(); else keys.sort((a, b) => counts.get(b)! - counts.get(a)!);
    let other: string[] = []; if (keys.length > 6) { other = keys.slice(5); keys = keys.slice(0, 5); }
    const inS = (r: Row, k: string) => { const v = sdim.f(r); return Array.isArray(v) ? v.includes(k) : v === k; };
    series = keys.map((k) => ({ name: k, data: labels.map((l) => m.f((groups.get(l) || []).filter((r) => inS(r, k)))) }));
    if (other.length && m.add) series.push({ name: 'Other', data: labels.map((l) => m.f((groups.get(l) || []).filter((r) => other.some((k) => inS(r, k))))) });
  } else series = [{ name: m.l, data: labels.map((l) => m.f(groups.get(l) || [])) }];
  return { m, rows, labels, series, dim, gkey, total: m.add ? m.f(rows) : null };
}
export const dispLabel = (agg: Agg, l: string) => (agg.dim?.time ? fmtMon(l) : String(l));
export const VISUALS: [Visual, string][] = [['kpi', 'Card'], ['column', 'Column'], ['bar', 'Bar'], ['stacked', 'Stacked'], ['line', 'Line'], ['area', 'Area'], ['donut', 'Donut'], ['funnel', 'Funnel'], ['table', 'Table']];
