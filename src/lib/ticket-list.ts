import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@/db';
import type { DeskCtx } from './desk-access';
import { ticketWhere } from './desk-access';
import { all, search } from './list-query';

const T = schema.tickets;
export const VIEWS = ['open', 'mine', 'unassigned', 'overdue', 'today', 'onhold', 'escalated', 'team', 'watching', 'closed', 'all', 'spam'] as const;
export type View = typeof VIEWS[number];
export function viewWhere(v: string, c: DeskCtx): SQL | undefined {
  const notSpam = and(eq(T.isSpam, false), isNull(T.mergedIntoId));
  const active = ne(T.statusCategory, 'closed');
  switch (v) {
    case 'mine': return and(notSpam, active, eq(T.assigneeId, c.userId));
    case 'unassigned': return and(notSpam, active, isNull(T.assigneeId));
    case 'overdue': return and(notSpam, active, or(lt(T.dueAt, sql`now()`), isNotNull(T.breachedAt), isNotNull(T.frBreachedAt)));
    case 'today': return and(notSpam, active, sql`(${T.dueAt} at time zone 'Asia/Dubai')::date = (now() at time zone 'Asia/Dubai')::date`);
    case 'onhold': return and(notSpam, eq(T.statusCategory, 'onhold'));
    case 'escalated': return and(notSpam, active, eq(T.escalated, true));
    case 'team': return c.teamIds.length ? and(notSpam, active, inArray(T.teamId, c.teamIds)) : sql`false`;
    case 'watching': return and(notSpam, sql`${T.id} in (select ticket_id from ticket_watchers where user_id = ${c.userId})`);
    case 'closed': return and(notSpam, eq(T.statusCategory, 'closed'));
    case 'all': return notSpam;
    case 'spam': return eq(T.isSpam, true);
    default: return and(notSpam, active);
  }
}
const PRIO = sql`case ${T.priority} when 'Urgent' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end`;
export const SORTS: Record<string, SQL> = { updated: sql`${T.updatedAt}`, created: sql`${T.createdAt}`, due: sql`coalesce(${T.dueAt}, 'infinity')`, priority: PRIO, number: sql`${T.number}`, subject: sql`lower(${T.subject})` };
export type ListArgs = { v?: string; q?: string; dept?: string; status?: string; priority?: string; assignee?: string; channel?: string; tag?: string; sort?: string; dir?: string; page?: string; contact?: string; company?: string };
export async function listTickets(c: DeskCtx, p: ListArgs, size = 50) {
  const page = Math.max(1, +(p.page || 1) || 1);
  const num = p.q?.match(/(\d{4,})/)?.[1];
  const filters = all(ticketWhere(c), viewWhere(p.v || 'open', c),
    p.dept ? eq(T.departmentId, p.dept) : undefined, p.status ? eq(T.statusId, p.status) : undefined, p.priority ? eq(T.priority, p.priority) : undefined,
    p.assignee === 'none' ? isNull(T.assigneeId) : p.assignee ? eq(T.assigneeId, p.assignee) : undefined, p.channel ? eq(T.channel, p.channel) : undefined,
    p.tag ? sql`${T.tags} @> ${JSON.stringify([p.tag])}::jsonb` : undefined, p.contact ? eq(T.contactId, p.contact) : undefined, p.company ? eq(T.companyId, p.company) : undefined,
    num ? eq(T.number, +num - 1000) : search(p.q, [T.subject, T.requesterEmail, T.requesterName, T.description]));
  const dir = p.dir === 'asc' ? asc : desc; const col = SORTS[p.sort || ''] || SORTS.updated;
  const A = alias(schema.users, 'assignee');
  const [rows, [{ n }]] = await Promise.all([
    db.select({ t: T, statusName: schema.ticketStatuses.name, dept: schema.departments.name, assignee: A.name, company: schema.companies.name, contactFirst: schema.contacts.firstName, contactLast: schema.contacts.lastName })
      .from(T).innerJoin(schema.ticketStatuses, eq(schema.ticketStatuses.id, T.statusId)).innerJoin(schema.departments, eq(schema.departments.id, T.departmentId))
      .leftJoin(A, eq(A.id, T.assigneeId)).leftJoin(schema.companies, eq(schema.companies.id, T.companyId)).leftJoin(schema.contacts, eq(schema.contacts.id, T.contactId))
      .where(filters).orderBy(dir(col), desc(T.number)).limit(size).offset((page - 1) * size),
    db.select({ n: sql<number>`count(*)` }).from(T).where(filters),
  ]);
  return { page, size, total: Number(n), rows: rows.map((r) => ({ ...r.t, statusName: r.statusName, deptName: r.dept, assigneeName: r.assignee, companyName: r.company, contactName: [r.contactFirst, r.contactLast].filter(Boolean).join(' ') || null })) };
}
/** Counters for the view list, in one query. */
export async function viewCounts(c: DeskCtx) {
  const keys = ['open', 'mine', 'unassigned', 'overdue', 'today', 'onhold', 'escalated'] as const;
  const parts = keys.map((k) => sql`count(*) filter (where ${viewWhere(k, c)}) as ${sql.raw(k)}`);
  const [r] = await db.execute(sql`select ${sql.join(parts, sql`, `)} from tickets where ${ticketWhere(c) ?? sql`true`}`) as unknown as Record<string, string>[];
  return Object.fromEntries(keys.map((k) => [k, Number(r?.[k] || 0)])) as Record<string, number>;
}
export type TicketRow = Awaited<ReturnType<typeof listTickets>>['rows'][number];
