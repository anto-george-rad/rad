import 'server-only';
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { DeskCtx } from './desk-access';
import { ticketWhere } from './desk-access';
import { getSettings } from './settings';
import { businessMinutesBetween } from './sla';

/** Per-agent performance for the last N days, limited to tickets the viewer can see. */
export async function agentStats(c: DeskCtx, days = 30) {
  const T = schema.tickets; const since = sql`now() - make_interval(days => ${days})`;
  const s = await getSettings(); const tz = process.env.APP_TIMEZONE || 'Asia/Dubai';
  const [rows, time, users] = await Promise.all([
    db.select({ a: T.assigneeId, cat: T.statusCategory, created: T.createdAt, fr: T.firstRespondedAt, res: T.resolvedAt, br: T.breachedAt, frb: T.frBreachedAt, rating: T.rating }).from(T).where(and(ticketWhere(c), isNotNull(T.assigneeId), eq(T.isSpam, false), sql`(${T.statusCategory} <> 'closed' or ${T.resolvedAt} >= ${since})`)),
    db.select({ u: schema.ticketTime.userId, m: sql<number>`sum(${schema.ticketTime.minutes})` }).from(schema.ticketTime).where(gte(schema.ticketTime.createdAt, since)).groupBy(schema.ticketTime.userId),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
  ]);
  const by = new Map<string, typeof rows>(); for (const r of rows) by.set(r.a!, [...(by.get(r.a!) || []), r]);
  return [...by.entries()].map(([id, rs]) => {
    const resolved = rs.filter((r) => r.res && +r.res >= Date.now() - days * 86_400_000);
    const frs = rs.filter((r) => r.fr && +r.created >= Date.now() - days * 86_400_000).map((r) => businessMinutesBetween(r.created, r.fr!, s.businessHours, tz));
    const judged = resolved.filter((r) => r.br || r.frb || r.res); const met = judged.filter((r) => !r.br && !r.frb).length;
    const rated = resolved.filter((r) => r.rating);
    return { id, name: users.find((u) => u.id === id)?.name || 'Former user', open: rs.filter((r) => r.cat !== 'closed').length, resolved: resolved.length,
      frtHrs: frs.length ? Math.round(frs.reduce((a, b) => a + b, 0) / frs.length / 6) / 10 : null, sla: judged.length ? Math.round(met / judged.length * 100) : null,
      csat: rated.length ? Math.round(rated.filter((r) => r.rating === 'good').length / rated.length * 100) : null, minutes: Number(time.find((x) => x.u === id)?.m || 0) };
  }).sort((a, b) => b.resolved - a.resolved);
}
