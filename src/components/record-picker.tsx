'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Hit = { type: string; id: string; label: string; sub?: string; extra?: Record<string, unknown> };
const cache = new Map<string, Hit>();
export async function searchRecords(type: string, q: string, opts: { company?: string; limit?: number } = {}): Promise<Hit[]> {
  const p = new URLSearchParams({ type, q, limit: String(opts.limit || 12) }); if (opts.company) p.set('company', opts.company);
  try { const r = await fetch('/api/search?' + p, { cache: 'no-store' }); if (!r.ok) return []; const j = await r.json() as { items: Hit[] }; j.items.forEach((h) => cache.set(h.id, h)); return j.items; } catch { return []; }
}
export async function resolveRecords(type: string, ids: string[]): Promise<Hit[]> {
  const need = ids.filter((i) => i && !cache.has(i));
  if (need.length) { try { const r = await fetch(`/api/search?type=${type}&ids=${need.join(',')}`, { cache: 'no-store' }); if (r.ok) (await r.json() as { items: Hit[] }).items.forEach((h) => cache.set(h.id, h)); } catch { /* offline */ } }
  return ids.map((i) => cache.get(i)).filter(Boolean) as Hit[];
}
/** Search-as-you-type picker for companies, contacts, deals, leads or tickets. */
export function RecordPicker({ type, value, onChange, placeholder = 'Search…', company, ariaLabel, allowClear = true, autoFocus }: {
  type: 'company' | 'contact' | 'deal' | 'lead' | 'ticket'; value: string | null | undefined; onChange: (id: string, hit: Hit | null) => void; placeholder?: string; company?: string | null; ariaLabel?: string; allowClear?: boolean; autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [items, setItems] = useState<Hit[]>([]); const [sel, setSel] = useState(0); const [label, setLabel] = useState('');
  const ref = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!value) { setLabel(''); return; } const c = cache.get(value); if (c) setLabel(c.label); else resolveRecords(type, [value]).then((h) => setLabel(h[0]?.label || '')); }, [value, type]);
  useEffect(() => { if (!open) return; const t = setTimeout(() => searchRecords(type, q, { company: company || undefined }).then((x) => { setItems(x); setSel(0); }), q ? 180 : 0); return () => clearTimeout(t); }, [q, open, type, company]);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const pick = (h: Hit | null) => { onChange(h?.id || '', h); setLabel(h?.label || ''); setOpen(false); setQ(''); };
  return <div ref={ref} className="relative">
    {open ? <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input ref={input} autoFocus className="inp pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={ariaLabel || placeholder}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) pick(items[sel]); } else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} /></div>
      : <button type="button" autoFocus={autoFocus} aria-label={ariaLabel} onClick={() => setOpen(true)} className="inp flex items-center gap-2 text-left"><span className={cn('min-w-0 flex-1 truncate', !label && 'text-faint')}>{label || placeholder}</span>
        {value && allowClear ? <span role="button" aria-label="Clear" onClick={(e) => { e.stopPropagation(); pick(null); }} className="text-faint hover:text-ink"><X size={14} /></span> : <ChevronDown size={14} className="text-faint" />}</button>}
    {open && <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
      {items.length ? items.map((h, i) => <button type="button" key={h.id} onMouseEnter={() => setSel(i)} onClick={() => pick(h)} className={cn('block w-full rounded-lg px-3 py-2 text-left', i === sel && 'bg-accent-soft')}>
        <div className="truncate text-[13px] font-medium">{h.label}</div>{h.sub && <div className="truncate text-[11.5px] text-muted">{h.sub}</div>}</button>)
        : <p className="px-3 py-3 text-[13px] text-muted">{q ? 'No matches' : 'Type to search'}</p>}
    </div>}
  </div>;
}
