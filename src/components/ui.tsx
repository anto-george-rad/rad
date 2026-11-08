'use client';
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { avatarColor, cn, initials } from '@/lib/utils';

/* ---------- buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'; size?: 'sm' | 'md' };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', className, ...p }, ref) {
  return <button ref={ref} {...p} className={cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px',
    size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
    variant === 'primary' && 'bg-accent text-accent-ink shadow-glow hover:brightness-110',
    variant === 'secondary' && 'border border-line bg-surface text-ink shadow-sm hover:border-faint',
    variant === 'ghost' && 'text-muted hover:bg-sunken hover:text-ink',
    variant === 'soft' && 'bg-accent-soft text-accent hover:brightness-95',
    variant === 'danger' && 'border border-bad/40 bg-surface text-bad hover:bg-bad-soft',
    className)} />;
});
export function IconButton({ label, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} {...p} className={cn('grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink', className)} />;
}

/* ---------- inputs ---------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cn('inp', p.type === 'number' && 'num', className)} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} {...p} className={cn('inp pr-8', className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={cn('inp min-h-[84px] resize-y', className)} />;
});
export function Field({ label, required, children, className, hint }: { label: string; required?: boolean; children: ReactNode; className?: string; hint?: string }) {
  return <label className={cn('field', className)}><span>{label}{required && <span className="text-bad"> *</span>}</span>{children}{hint && <span className="font-normal text-faint">{hint}</span>}</label>;
}

/* ---------- display ---------- */
export function Chip({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'outline'; children: ReactNode; className?: string }) {
  return <span className={cn('chip', {
    neutral: 'bg-sunken text-muted', good: 'bg-good-soft text-good', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad',
    accent: 'bg-accent-soft text-accent', outline: 'border border-line font-medium text-muted',
  }[tone], className)}>{children}</span>;
}
export function Avatar({ id, name, size = 24 }: { id?: string | null; name: string; size?: number }) {
  return <span title={name} className="inline-grid flex-none place-items-center rounded-full font-bold text-white ring-2 ring-surface" style={{ width: size, height: size, fontSize: size * 0.4, background: avatarColor(id) }}>{initials(name)}</span>;
}
export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-14 text-center animate-rise">
    {icon && <div className="mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>}
    <h3 className="font-display text-xl font-bold tracking-tight">{title}</h3>
    {children && <p className="text-muted">{children}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>;
}
export function Panel({ title, actions, children, className, bodyClass, count }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; count?: ReactNode }) {
  return <section className={cn('panel min-w-0', className)}>
    {title != null && <header className="panel-h"><h3 className="panel-t">{title}</h3>{count != null && <Chip>{count}</Chip>}<span className="flex-1" />{actions}</header>}
    <div className={bodyClass}>{children}</div>
  </section>;
}
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return <div role="group" className="inline-flex gap-0.5 rounded-[10px] border border-line bg-sunken p-0.5">
    {options.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
      className={cn('rounded-lg font-semibold transition', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[12.5px]', value === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>{l}</button>)}
  </div>;
}
export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: [T, ReactNode, number?][]; onChange: (v: T) => void }) {
  return <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
    {tabs.map(([k, l, c]) => <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
      className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold transition', value === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
      {l}{c != null && <span className="num ml-1.5 rounded-full bg-sunken px-1.5 text-[11px] font-medium text-muted">{c}</span>}
    </button>)}
  </div>;
}
export function Kpi({ label, value, sub, tone, meter, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'good'; meter?: number; icon?: ReactNode }) {
  return <div className="panel relative min-w-0 overflow-hidden p-3.5 animate-rise sm:p-4">
    <div className="flex items-center justify-between"><span className="eyebrow">{label}</span>{icon && <span className="text-faint">{icon}</span>}</div>
    <div className={cn('mt-2 break-words font-display text-[21px] font-bold leading-none tracking-tight num sm:text-[24px] xl:text-[28px]', tone === 'bad' && 'text-bad', tone === 'good' && 'text-good')} style={{ fontFamily: '"Manrope Variable", "Manrope", sans-serif' }}>{value}</div>
    {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    {meter != null && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"><i className="block h-full rounded-full bg-good" style={{ width: `${Math.min(100, meter)}%` }} /></div>}
  </div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('relative overflow-hidden rounded-lg bg-sunken', className)}><div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-surface/60 to-transparent" /></div>;
}

/* ---------- modal ---------- */
export function Modal({ open, onClose, title, sub, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(<div className="fixed inset-0 z-50 grid place-items-center p-3">
    <div className="absolute inset-0 bg-[#060812]/50 backdrop-blur-[2px]" onClick={onClose} />
    <div role="dialog" aria-modal="true" className={cn('relative flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop', wide ? 'max-w-[980px]' : 'max-w-[600px]')}>
      <header className="flex items-start gap-3 px-6 pb-2 pt-5"><div className="min-w-0 flex-1"><h2 className="font-display text-[21px] font-bold tracking-tight">{title}</h2>{sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}</div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-6 py-3.5">{footer}</footer>}
    </div>
  </div>, document.body);
}

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; tone?: 'good' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'good' | 'bad') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone?: 'good' | 'bad') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3600);
  }, []);
  return <ToastCtx.Provider value={push}>{children}
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => <div key={t.id} className={cn('rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-pop animate-rise', t.tone === 'bad' ? 'bg-bad text-white' : 'bg-ink text-bg')}>{t.text}</div>)}
    </div>
  </ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/* ---------- dropdown menu ---------- */
export function Menu({ trigger, items, align = 'right' }: { trigger: (open: () => void) => ReactNode; items: ([string, () => void, ('danger' | undefined)?] | null)[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return <div ref={ref} className="relative">
    {trigger(() => setOpen((o) => !o))}
    {open && <div className={cn('absolute top-[calc(100%+6px)] z-40 min-w-[200px] rounded-xl border border-line bg-surface p-1 shadow-pop animate-pop', align === 'right' ? 'right-0' : 'left-0')}>
      {items.map((it, i) => it ? <button key={i} onClick={() => { setOpen(false); it[1](); }} className={cn('block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium hover:bg-accent-soft', it[2] === 'danger' && 'text-bad')}>{it[0]}</button> : <div key={i} className="my-1 h-px bg-line" />)}
    </div>}
  </div>;
}

/* ---------- confirm button (two-step, no browser dialogs) ---------- */
export function ConfirmButton({ onConfirm, children, confirmText = 'Click again to confirm', ...p }: Omit<BtnProps, 'onClick'> & { onConfirm: () => void; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <Button variant={armed ? 'danger' : p.variant ?? 'ghost'} {...p} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmText : children}</Button>;
}
