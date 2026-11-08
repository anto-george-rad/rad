import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { deskCtx, ticketWhere } from '@/lib/desk-access';
import { viewCounts } from '@/lib/ticket-list';
import { ticketRows } from '@/lib/insights-data';
import { agentStats } from '@/lib/desk-stats';
import DeskHome from '@/components/desk/home';

export const metadata = { title: 'Desk home' };
export default async function DeskHomePage() {
  const me = await requireDeskPage(); const c = await deskCtx(me); const T = schema.tickets;
  const [counts, mine, rows, stats, deps] = await Promise.all([
    viewCounts(c),
    db.select({ id: T.id, number: T.number, subject: T.subject, priority: T.priority, statusCategory: T.statusCategory, dueAt: T.dueAt, firstResponseDueAt: T.firstResponseDueAt, firstRespondedAt: T.firstRespondedAt, breachedAt: T.breachedAt, frBreachedAt: T.frBreachedAt, requesterName: T.requesterName, updatedAt: T.updatedAt })
      .from(T).where(and(ticketWhere(c), me.deskRole === 'light' ? undefined : eq(T.assigneeId, me.id), ne(T.statusCategory, 'closed'), eq(T.isSpam, false))).orderBy(asc(sql`coalesce(${T.dueAt}, 'infinity')`)).limit(10),
    ticketRows(ticketWhere(c)), me.deskRole === 'light' ? Promise.resolve([]) : agentStats(c, 30),
    db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments),
  ]);
  return <DeskHome counts={counts} mine={mine} rows={rows} stats={stats} hasDept={c.role === 'admin' || c.deptIds.length > 0 || deps.length === 0} />;
}
