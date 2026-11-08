'use client';
import { useEffect, useRef, useState } from 'react';
import { Chart, ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartConfiguration } from 'chart.js';
import type { Tile } from '@/lib/insights-defaults';
import { type Agg, type Ctx, dispLabel, fmtVal } from './engine';
import { cn } from '@/lib/utils';

Chart.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip);

// Validated categorical palette (dataviz reference): fixed order, light and dark steps.
export const PAL = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] };
const RAMP = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef'];
export const FIXED: Record<string, Record<string, number>> = {
  'deals.status': { Open: 0, Won: 2, Lost: 7 }, 'leads.score': { Hot: 7, Warm: 3, Cold: 0 }, 'activities.status': { Overdue: 7, Open: 0, Done: 2 },
  'deals.priority': { High: 7, Medium: 3, Low: 0 }, 'leads.status': { New: 0, Contacted: 1, Qualified: 2, Unqualified: 7, Converted: 6 },
};
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
const tok = (n: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(n).trim()})`;

export function useThemeKey() {
  const [k, setK] = useState(0);
  useEffect(() => { const f = () => setK((x) => x + 1); const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', f); window.addEventListener('rd-theme', f); return () => { mq.removeEventListener('change', f); window.removeEventListener('rd-theme', f); }; }, []);
  return k;
}

type Props = { t: Tile; agg: Agg; ctx: Ctx; colorIdx: (ds: string, dim: string, v: string) => number; onCross?: (ds: string, dim: string, v: string) => void; tall?: boolean };
export function TileBody({ t, agg, ctx, colorIdx, onCross, tall }: Props) {
  const hl = ctx.cross.find((c) => c.ds === t.ds && c.dim === agg.gkey)?.value;
  if (t.visual === 'kpi') {
    const d = agg.prev != null ? (agg.prev ? Math.round(((agg.kpi! - agg.prev) / Math.abs(agg.prev)) * 100) : null) : undefined;
    return <div className="flex flex-col gap-2 pt-1">
      <div className="num break-words font-display text-[26px] font-bold leading-none tracking-tight sm:text-[34px]" style={{ fontFamily: '"Manrope Variable","Manrope",sans-serif' }}>{fmtVal(agg.kpi!, agg.m.k, true)}</div>
      {d !== undefined && (d === null ? (agg.kpi ? <span className="chip w-max bg-good-soft text-good">New this period</span> : null)
        : <span className={cn('chip w-max', d > 0 ? 'bg-good-soft text-good' : d < 0 ? 'bg-bad-soft text-bad' : 'bg-sunken text-muted')}>{d > 0 ? '▲' : d < 0 ? '▼' : '■'} {Math.abs(d)}% <span className="font-medium opacity-80">vs previous period</span></span>)}
      <span className="text-xs text-muted">{agg.rows.length.toLocaleString()} {agg.rows.length === 1 ? 'record' : 'records'}</span>
    </div>;
  }
  if (!agg.labels.length || (t.visual !== 'table' && agg.series.every((s) => s.data.every((v) => !v)))) return <div className="grid min-h-[160px] flex-1 place-items-center text-[13px] text-muted">No data for these filters</div>;
  if (t.visual === 'table') {
    const cols = agg.series; const tot = cols.map((s) => s.data.reduce((a, b) => a + b, 0));
    return <div className={cn('overflow-auto', tall ? 'max-h-[60vh]' : 'max-h-[300px]')}><table className="w-full text-[13px]">
      <thead><tr className="text-left text-[11px] uppercase tracking-[.06em] text-muted"><th className="sticky top-0 bg-surface py-2 pr-3 font-semibold">{agg.dim?.l}</th>{cols.map((s) => <th key={s.name} className="sticky top-0 bg-surface px-2 py-2 text-right font-semibold">{cols.length > 1 ? s.name : agg.m.l}</th>)}{cols.length === 1 && agg.m.add && <th className="sticky top-0 bg-surface py-2 pl-2 text-right font-semibold">Share</th>}</tr></thead>
      <tbody>{agg.labels.map((l, i) => <tr key={l} onClick={() => onCross?.(t.ds, agg.gkey!, l)} className={cn('border-t border-line', onCross && 'cursor-pointer hover:bg-raised', hl != null && hl !== l && 'opacity-40')}>
        <td className="py-2 pr-3">{dispLabel(agg, l)}</td>{cols.map((s) => <td key={s.name} className="num px-2 py-2 text-right">{fmtVal(s.data[i], agg.m.k)}</td>)}
        {cols.length === 1 && agg.m.add && <td className="num py-2 pl-2 text-right text-muted">{tot[0] ? Math.round((cols[0].data[i] / tot[0]) * 100) : 0}%</td>}</tr>)}</tbody>
      {agg.m.add && <tfoot><tr className="border-t-2 border-line font-bold"><td className="py-2">Total</td>{tot.map((v, i) => <td key={i} className="num px-2 py-2 text-right">{fmtVal(v, agg.m.k)}</td>)}{cols.length === 1 && <td className="num py-2 pl-2 text-right">100%</td>}</tr></tfoot>}
    </table></div>;
  }
  if (t.visual === 'funnel') {
    const d = agg.series[0].data; const max = Math.max(1, ...d); const first = d[0] || 0;
    return <div className="flex flex-col gap-1.5">{agg.labels.map((l, i) => <button key={l} onClick={() => onCross?.(t.ds, agg.gkey!, l)} title={`${dispLabel(agg, l)}: ${fmtVal(d[i], agg.m.k, true)}`}
      className={cn('grid grid-cols-[minmax(80px,140px)_minmax(0,1fr)_96px] items-center gap-3 text-left text-[13px] transition', hl != null && hl !== l && 'opacity-35')}>
      <span className="truncate">{dispLabel(agg, l)}</span>
      <span className="flex h-7 justify-center"><span className="h-full min-w-[3px] rounded-md transition-all" style={{ width: `${Math.max(2, (d[i] / max) * 100)}%`, background: RAMP[Math.min(RAMP.length - 1, Math.round((i * (RAMP.length - 1)) / Math.max(1, agg.labels.length - 1)))] }} /></span>
      <span className="num text-right text-xs">{fmtVal(d[i], agg.m.k)}{i > 0 && first ? <span className="ml-1 text-muted">{Math.round((d[i] / first) * 100)}%</span> : null}</span>
    </button>)}</div>;
  }
  return <ChartCanvas t={t} agg={agg} hl={hl} colorIdx={colorIdx} onCross={onCross} tall={tall} />;
}

function ChartCanvas({ t, agg, hl, colorIdx, onCross, tall }: { t: Tile; agg: Agg; hl?: string; colorIdx: Props['colorIdx']; onCross?: Props['onCross']; tall?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null); const chart = useRef<Chart | null>(null); const first = useRef(true);
  const theme = useThemeKey();
  useEffect(() => {
    if (!ref.current) return;
    const pal = PAL[isDark() ? 'dark' : 'light']; const ink = tok('--ink'), muted = tok('--chart-ink'), grid = tok('--grid'), surf = tok('--surface');
    const m = agg.m; const labels = agg.labels.map((l) => dispLabel(agg, l)); const multi = agg.series.length > 1;
    const col = (dim: string, v: string) => { const i = colorIdx(t.ds, dim, v); return i < 8 ? pal[i] : muted; };
    const off = (i: number) => hl != null && agg.labels[i] !== hl;
    const catColor = !multi && !!FIXED[`${t.ds}.${agg.gkey}`];
    let type: 'bar' | 'line' | 'doughnut'; let datasets: ChartConfiguration['data']['datasets']; let indexAxis: 'x' | 'y' = 'x';
    if (t.visual === 'donut') { type = 'doughnut'; datasets = [{ data: agg.series[0].data, backgroundColor: agg.labels.map((l, i) => col(agg.gkey!, l) + (off(i) ? '40' : '')), borderColor: surf, borderWidth: 2, hoverOffset: 6 }]; }
    else if (t.visual === 'line' || t.visual === 'area') {
      type = 'line';
      datasets = agg.series.map((s) => { const c = multi ? col(t.seriesBy!, s.name) : pal[0]; return { label: s.name, data: s.data, borderColor: c, backgroundColor: t.visual === 'area' ? c + (multi ? '30' : '2e') : c, fill: t.visual === 'area' ? 'origin' : false, cubicInterpolationMode: 'monotone', borderWidth: 2, pointRadius: labels.length > 14 ? 0 : 3, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: surf, pointBorderWidth: 2 }; });
    } else {
      type = 'bar'; indexAxis = t.visual === 'bar' ? 'y' : 'x';
      datasets = agg.series.map((s) => { const base = multi ? col(t.seriesBy!, s.name) : pal[0]; return { label: s.name, data: s.data, backgroundColor: s.data.map((_, i) => (catColor ? col(agg.gkey!, agg.labels[i]) : base) + (off(i) ? '40' : '')), borderRadius: 4, borderSkipped: t.visual === 'stacked' && multi ? false : 'start', maxBarThickness: 42, borderColor: surf, borderWidth: t.visual === 'stacked' && multi ? 1 : 0 }; });
    }
    const stacked = (t.visual === 'stacked' && multi) || (t.visual === 'area' && multi);
    const tick = (v: string | number) => (m.k === 'pct' ? `${v}%` : m.k === 'money' ? fmtShortTick(+v) : fmtShortTick(+v));
    const cfg: ChartConfiguration = {
      type, data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: first.current ? { duration: 650, easing: 'easeOutQuart' } : false,
        indexAxis, layout: { padding: { top: 6 } },
        interaction: { mode: type === 'line' ? 'index' : 'nearest', intersect: type !== 'line', axis: indexAxis },
        plugins: {
          legend: { display: multi || type === 'doughnut', position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: muted, padding: 14, font: { family: '"Inter Variable", "Inter", system-ui', size: 12 } } },
          tooltip: { backgroundColor: ink, titleColor: surf, bodyColor: surf, padding: 10, cornerRadius: 10, boxPadding: 4, displayColors: multi || type === 'doughnut', titleFont: { weight: 'bold' },
            callbacks: { label: (c) => { const v = type === 'doughnut' ? (c.parsed as unknown as number) : indexAxis === 'y' ? (c.parsed as { x: number }).x : (c.parsed as { y: number }).y; const n = type === 'doughnut' ? c.label : multi ? c.dataset.label : ''; return `${n ? n + ': ' : ''}${fmtVal(v, m.k, true)}`; } } },
        },
        onClick: onCross ? (_e, els) => { if (els.length) onCross(t.ds, agg.gkey!, agg.labels[els[0].index]); } : undefined,
        onHover: (e, els) => { const el = e.native?.target as HTMLElement | undefined; if (el) el.style.cursor = els.length && onCross ? 'pointer' : 'default'; },
        ...(type === 'doughnut' ? { cutout: '66%' } : {
          scales: (() => {
            const val = { beginAtZero: true, stacked, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { callback: tick, maxTicksLimit: 5, padding: 8, color: muted, font: { family: '"JetBrains Mono", monospace', size: 11 } } };
            const cat = { stacked, grid: { display: false }, border: { color: grid }, ticks: { autoSkip: true, maxRotation: 0, padding: 6, color: muted, font: { family: '"Inter Variable", "Inter", system-ui', size: 11.5 }, callback(this: { getLabelForValue: (v: number) => string }, v: string | number) { const s = this.getLabelForValue(+v); return s.length > 16 ? s.slice(0, 15) + '…' : s; } } };
            return indexAxis === 'y' ? { x: val, y: cat } : { x: cat, y: val };
          })(),
        }),
      } as ChartConfiguration['options'],
    };
    chart.current?.destroy(); chart.current = new Chart(ref.current, cfg); first.current = false;
    return () => { chart.current?.destroy(); chart.current = null; };
  }, [t, agg, hl, colorIdx, onCross, theme]);
  return <div className={cn('relative min-w-0', tall ? 'h-[min(62vh,520px)]' : t.size === 'l' ? 'h-[290px]' : 'h-[250px]')}>
    <canvas ref={ref} role="img" aria-label={t.title || 'Chart'} />
    {t.visual === 'donut' && <div className="pointer-events-none absolute inset-x-0 top-[calc(50%-34px)] flex flex-col items-center"><b className="num font-display text-[22px] font-bold" style={{ fontFamily: '"Manrope Variable","Manrope",sans-serif' }}>{fmtVal(agg.total ?? agg.series[0].data.reduce((a, b) => a + b, 0), agg.m.k)}</b><span className="text-[11px] text-muted">Total</span></div>}
  </div>;
}
function fmtShortTick(v: number) { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : String(Math.round(v)); }
