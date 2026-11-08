/** Business-hours maths for SLA timers. Pure and time-zone aware (company zone), unit-tested. */
import type { BusinessHours } from './settings-defaults';
import type { SlaPolicy } from '@/db/schema';

const MIN = 60_000;
type Parts = { y: number; m: number; d: number; hh: number; mm: number; dow: number };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, tz: string): Parts {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }); fmtCache.set(tz, f); }
  const o: Record<string, string> = {}; for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
/** The instant when the clock in `tz` shows y-m-d hh:mm. */
function fromLocal(y: number, m: number, d: number, hh: number, mm: number, tz: string) {
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) { const p = parts(new Date(t), tz); const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm); t += Date.UTC(y, m - 1, d, hh, mm) - shown; }
  return new Date(t);
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const iso = (p: Parts) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const isWorkDay = (p: Parts, bh: BusinessHours) => bh.days.includes(p.dow) && !bh.holidays.includes(iso(p));
function nextDayStart(p: Parts, bh: BusinessHours, tz: string) {
  const n = new Date(Date.UTC(p.y, p.m - 1, p.d + 1)); const s = hm(bh.start);
  return fromLocal(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), Math.floor(s / 60), s % 60, tz);
}

/** Adds working minutes to a start time, skipping nights, weekends and holidays. */
export function addBusinessMinutes(start: Date, minutes: number, bh: BusinessHours, tz: string, businessOnly = true): Date {
  if (!businessOnly || !bh.days.length) return new Date(+start + minutes * MIN);
  let cur = new Date(start); let left = Math.max(0, minutes); const S = hm(bh.start), E = hm(bh.end);
  for (let guard = 0; guard < 800; guard++) {
    const p = parts(cur, tz); const now = p.hh * 60 + p.mm;
    if (!isWorkDay(p, bh) || now >= E) { cur = nextDayStart(p, bh, tz); continue; }
    if (now < S) { cur = fromLocal(p.y, p.m, p.d, Math.floor(S / 60), S % 60, tz); continue; }
    const avail = E - now;
    if (left <= avail) return new Date(+cur + left * MIN);
    left -= avail; cur = nextDayStart(p, bh, tz);
  }
  return cur;
}
/** Working minutes between two instants (used to pause SLA clocks while a ticket is on hold, and for reports). */
export function businessMinutesBetween(a: Date, b: Date, bh: BusinessHours, tz: string, businessOnly = true): number {
  if (+b <= +a) return 0;
  if (!businessOnly || !bh.days.length) return Math.round((+b - +a) / MIN);
  let cur = new Date(a); let total = 0; const S = hm(bh.start), E = hm(bh.end);
  for (let guard = 0; guard < 800 && +cur < +b; guard++) {
    const p = parts(cur, tz); const now = p.hh * 60 + p.mm;
    if (!isWorkDay(p, bh) || now >= E) { cur = nextDayStart(p, bh, tz); continue; }
    if (now < S) { cur = fromLocal(p.y, p.m, p.d, Math.floor(S / 60), S % 60, tz); continue; }
    const dayEnd = fromLocal(p.y, p.m, p.d, Math.floor(E / 60), E % 60, tz);
    const stop = +b < +dayEnd ? b : dayEnd; total += (+stop - +cur) / MIN; cur = +b < +dayEnd ? b : nextDayStart(p, bh, tz);
  }
  return Math.round(total);
}
/** First active policy whose department and customer tier match (empty = any). */
export function pickPolicy(policies: SlaPolicy[], departmentId: string, tier: string | null | undefined) {
  return [...policies].filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder)
    .find((p) => (!p.departmentId || p.departmentId === departmentId) && (!p.tier || p.tier === tier)) || null;
}
export function dueDates(policy: SlaPolicy | null, priority: string, from: Date, bh: BusinessHours, tz: string) {
  const t = policy?.targets[priority] || policy?.targets.Medium;
  if (!policy || !t) return { firstResponseDueAt: null, dueAt: null };
  return { firstResponseDueAt: t.first ? addBusinessMinutes(from, t.first, bh, tz, policy.businessHours) : null, dueAt: t.resolve ? addBusinessMinutes(from, t.resolve, bh, tz, policy.businessHours) : null };
}
/** How far through its SLA a ticket is (0–1+), for warnings at e.g. 80%. */
export function slaProgress(start: Date, due: Date, now: Date) { const span = +due - +start; return span <= 0 ? 1 : (+now - +start) / span; }
