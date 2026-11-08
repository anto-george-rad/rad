/** Pure date rules used by the hourly scheduler (unit-tested in tests/). Dates are YYYY-MM-DD in company time. */
import { addDaysISO, daysBetweenISO } from './utils';

export type TimeRecord = { closingDate?: string | null; stageEnteredAt?: Date | string | null; contractEnd?: string | null; createdAt?: Date | string | null; firstContactedAt?: Date | string | null; status?: string };
const isoOf = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Returns the de-duplication key when the time trigger is due for this record, or null. */
export function timeTriggerKey(event: string, days: number, r: TimeRecord, today: string): string | null {
  const n = Math.max(0, days || 0);
  switch (event) {
    case 'deal.closing_soon': return r.closingDate && r.closingDate >= today && r.closingDate <= addDaysISO(n, today) ? `closing:${r.closingDate}` : null;
    case 'deal.contract_ending': return r.contractEnd && r.contractEnd >= today && r.contractEnd <= addDaysISO(n, today) ? `contract:${r.contractEnd}` : null;
    case 'deal.idle': { if (!r.stageEnteredAt) return null; const since = isoOf(r.stageEnteredAt); return daysBetweenISO(since, today) >= Math.max(1, n) ? `idle:${since}` : null; }
    case 'lead.untouched': { if (!r.createdAt || r.firstContactedAt || r.status !== 'New') return null; return daysBetweenISO(isoOf(r.createdAt), today) >= Math.max(1, n) ? 'untouched' : null; }
    default: return null;
  }
}
/** A won deal needs a renewal when its contract ends within `windowDays` (and hasn't ended more than 30 days ago). */
export const renewalDue = (contractEnd: string | null | undefined, today: string, windowDays: number) =>
  !!contractEnd && contractEnd <= addDaysISO(windowDays, today) && contractEnd >= addDaysISO(-30, today);
/** Licence reminder is due once per expiry date, `days` before it. */
export const licenceReminderDue = (expiry: string | null | undefined, remindedFor: string | null | undefined, today: string, days: number) =>
  !!expiry && days > 0 && remindedFor !== expiry && expiry <= addDaysISO(days, today);
