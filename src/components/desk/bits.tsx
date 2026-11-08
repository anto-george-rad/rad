'use client';
import { AlertTriangle, Clock, Flame } from 'lucide-react';
import type { StatusCategory } from '@/db/schema';
import { Chip } from '../ui';
import { useApp } from '../app-context';
import { cn } from '@/lib/utils';

export const tTag = (prefix: string, n: number) => `#${prefix}-${1000 + n}`;
export function useTag() { const { settings } = useApp(); return (n: number) => tTag(settings.ticketPrefix, n); }
export function StatusChip({ name, category }: { name: string; category: StatusCategory | string }) {
  return <Chip tone={category === 'closed' ? 'good' : category === 'onhold' ? 'warn' : 'accent'}>{name}</Chip>;
}
const PRIO_TONE: Record<string, string> = { Urgent: 'bg-bad text-white', High: 'bg-bad-soft text-bad', Medium: 'bg-warn-soft text-warn', Low: 'bg-sunken text-muted' };
export function PriorityChip({ p }: { p: string }) { return <span className={cn('chip', PRIO_TONE[p] || 'bg-sunken text-muted')}>{p === 'Urgent' && <Flame size={11} />}{p}</span>; }
/** SLA countdown: overdue (red), due within 2 hours (amber), otherwise neutral. */
export function SlaChip({ due, breached, category, label = 'Due' }: { due: Date | string | null; breached?: Date | string | null; category: string; label?: string }) {
  if (category === 'closed' || !due) return breached ? <Chip tone="bad">SLA missed</Chip> : <span className="text-faint">—</span>;
  if (category === 'onhold') return <Chip><Clock size={11} />Paused</Chip>;
  const ms = +new Date(due) - Date.now(); const mins = Math.round(Math.abs(ms) / 60000);
  const txt = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  if (ms < 0 || breached) return <Chip tone="bad"><AlertTriangle size={11} />Overdue {txt}</Chip>;
  return <Chip tone={ms < 2 * 3600_000 ? 'warn' : 'neutral'}><Clock size={11} />{label} in {txt}</Chip>;
}
export const CATEGORY_LABEL: Record<string, string> = { open: 'Open', onhold: 'On hold', closed: 'Closed' };
