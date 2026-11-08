import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSettings } from './settings';
import { notify } from './notify';
import { agents } from './desk-access';
import { todayISO } from './utils';

/** Minutes logged on tickets covered by each contract. */
export async function contractMinutes(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.select({ c: schema.tickets.contractId, m: sql<number>`coalesce(sum(${schema.ticketTime.minutes}),0)` }).from(schema.ticketTime)
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.ticketTime.ticketId)).where(inArray(schema.tickets.contractId, ids)).groupBy(schema.tickets.contractId);
  return new Map(rows.map((r) => [r.c as string, Number(r.m)]));
}
/** Pure (unit-tested): hours used, % of included hours, cost and margin for one contract. */
export function contractEconomics(c: { hoursIncluded: number | null; value: number | null }, minutes: number, costPerHour: number) {
  const hours = Math.round((minutes / 60) * 10) / 10; const cost = Math.round(hours * costPerHour);
  const usedPct = c.hoursIncluded ? Math.round((hours / c.hoursIncluded) * 100) : null;
  const margin = c.value ? Math.round(((c.value - cost) / c.value) * 100) : null;
  return { hours, cost, usedPct, margin, profit: c.value != null ? Math.round(c.value - cost) : null };
}
/** Daily: warn when a contract has used most of its hours. */
export async function contractHoursJob() {
  const s = await getSettings(); const today = todayISO();
  const list = (await db.select().from(schema.supportContracts).where(isNull(schema.supportContracts.lowHoursWarnedAt))).filter((c) => c.hoursIncluded && c.startDate <= today && today <= c.endDate);
  const used = await contractMinutes(list.map((c) => c.id)); const admins = (await agents()).filter((a) => a.active && a.deskRole === 'admin').map((a) => a.id); let n = 0;
  for (const c of list) {
    const e = contractEconomics(c, used.get(c.id) || 0, s.supportCostPerHour);
    if ((e.usedPct ?? 0) < s.lowHoursPct) continue;
    const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, c.companyId), columns: { name: true, ownerId: true } });
    await notify([...admins, co?.ownerId ?? null], `${co?.name}: ${e.usedPct}% of support hours used`, `${c.name} — ${e.hours} of ${c.hoursIncluded} hours. Time to offer more hours.`, `/desk/contracts?id=${c.id}`);
    await db.update(schema.supportContracts).set({ lowHoursWarnedAt: new Date() }).where(and(eq(schema.supportContracts.id, c.id))); n++;
  }
  return n;
}
