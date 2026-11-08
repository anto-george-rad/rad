import 'server-only';
import { and, desc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSettings } from './settings';
import { contractEconomics, contractMinutes } from './contracts';

/** Licences for pages (the key itself never leaves the server; only whether one is stored). */
export async function licenceRows(where?: SQL) {
  const L = schema.licences;
  const rows = await db.select({ l: L, companyName: schema.companies.name }).from(L).leftJoin(schema.companies, eq(schema.companies.id, L.companyId)).where(where).orderBy(L.endDate);
  return rows.map(({ l, companyName }) => ({ id: l.id, companyId: l.companyId, companyName: companyName || '', contactId: l.contactId, productId: l.productId, productName: l.productName, vendor: l.vendor, seats: l.seats, hasKey: !!l.licenceKey,
    startDate: l.startDate, endDate: l.endDate, value: l.value, currency: l.currency, status: l.status, dealId: l.dealId, renewalDealId: l.renewalDealId, notes: l.notes }));
}
export async function contractViews(companyId: string) {
  const list = await db.select().from(schema.supportContracts).where(eq(schema.supportContracts.companyId, companyId)).orderBy(desc(schema.supportContracts.endDate));
  const used = await contractMinutes(list.map((c) => c.id)); const s = await getSettings();
  return list.map((c) => { const e = contractEconomics(c, used.get(c.id) || 0, s.supportCostPerHour); return { id: c.id, name: c.name, tier: c.tier, startDate: c.startDate, endDate: c.endDate, hoursIncluded: c.hoursIncluded, hours: e.hours, usedPct: e.usedPct }; });
}
export async function emailRows(by: { contactId?: string; companyId?: string; dealId?: string }, limit = 60) {
  const E = schema.emailLogs;
  const w = by.dealId ? eq(E.dealId, by.dealId) : by.contactId ? eq(E.contactId, by.contactId) : by.companyId ? eq(E.companyId, by.companyId) : sql`false`;
  return (await db.select().from(E).where(w).orderBy(desc(E.at)).limit(limit)).map((e) => ({ id: e.id, userId: e.userId, direction: e.direction, subject: e.subject, snippet: e.snippet, fromEmail: e.fromEmail, toEmails: e.toEmails, webLink: e.webLink, at: e.at, dealId: e.dealId }));
}
export async function supportStats(companyId: string) {
  const T = schema.tickets;
  const [r, open] = await Promise.all([
    db.select({ rating: T.rating, c: sql<number>`count(*)` }).from(T).where(and(eq(T.companyId, companyId), gt(T.ratedAt, new Date(Date.now() - 90 * 864e5)))).groupBy(T.rating),
    db.select({ c: sql<number>`count(*)` }).from(T).where(and(eq(T.companyId, companyId), ne(T.statusCategory, 'closed'), eq(T.isSpam, false))),
  ]);
  const ratings = { good: 0, ok: 0, bad: 0 }; for (const x of r) if (x.rating && x.rating in ratings) ratings[x.rating as 'good'] = Number(x.c);
  return { ratings, openTickets: Number(open[0]?.c || 0) };
}
void inArray;
