import 'server-only';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { AgentSkills } from '@/db/schema';
import type { SessionUser } from './auth';
import { computeScope } from './visibility';
import { canAssign, canSeeTicket, canWorkTicket, type AgentLite, type DeskCtx } from './desk-rules';
export { canAssign, canSeeTicket, canWorkTicket, canManageDesk, isAssignable } from './desk-rules';
export type { DeskCtx, AgentLite } from './desk-rules';

export async function deskCtx(me: SessionUser): Promise<DeskCtx> {
  const [deps, tms, users] = await Promise.all([
    db.select({ d: schema.departmentMembers.departmentId }).from(schema.departmentMembers).where(eq(schema.departmentMembers.userId, me.id)),
    db.select({ t: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.userId, me.id)),
    db.select({ id: schema.users.id, managerId: schema.users.managerId }).from(schema.users),
  ]);
  const reports = [...computeScope(users, me.id)].filter((x) => x !== me.id);
  return { userId: me.id, role: me.deskRole, scope: me.ticketScope, deptIds: deps.map((x) => x.d), teamIds: tms.map((x) => x.t), reportIds: reports };
}
/** The same rule as canSeeTicket, as SQL for lists and counts. */
export function ticketWhere(c: DeskCtx): SQL | undefined {
  const T = schema.tickets;
  if (c.role === 'admin') return undefined;
  if (c.role === 'none') return sql`false`;
  const reports = c.reportIds.length ? inArray(T.assigneeId, c.reportIds) : undefined;
  if (c.role === 'agent' && c.scope === 'all') return undefined;
  const inDept = c.deptIds.length ? inArray(T.departmentId, c.deptIds) : sql`false`;
  let mine: SQL | undefined;
  if (c.role === 'light' || c.scope === 'department') mine = inDept;
  else {
    const own = or(isNull(T.assigneeId), eq(T.assigneeId, c.userId));
    const team = c.scope === 'team' && c.teamIds.length ? inArray(T.teamId, c.teamIds) : undefined;
    mine = and(inDept, team ? or(own, team) : own);
  }
  return reports ? or(mine, reports) : mine;
}
/** All helpdesk agents with their departments and teams. */
export async function agents(): Promise<(AgentLite & { name: string; available: boolean; email: string; managerId: string | null; skills: AgentSkills; shift: { days: number[]; start: string; end: string } | null; leave: { startDate: string; endDate: string }[] })[]> {
  const [us, dm, tm, lv] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, active: schema.users.active, deskRole: schema.users.deskRole, role: schema.users.role, available: schema.users.deskAvailable, managerId: schema.users.managerId, skills: schema.users.skills, shift: schema.users.shift }).from(schema.users),
    db.select().from(schema.departmentMembers), db.select().from(schema.teamMembers), db.select().from(schema.agentLeave),
  ]);
  return us.filter((u) => u.role === 'admin' || u.deskRole !== 'none').map((u) => ({ id: u.id, name: u.name, email: u.email, active: u.active, available: u.available, deskRole: u.role === 'admin' ? 'admin' : u.deskRole,
    managerId: u.managerId, skills: u.skills, shift: u.shift, leave: lv.filter((x) => x.userId === u.id).map((x) => ({ startDate: x.startDate, endDate: x.endDate })),
    deptIds: dm.filter((x) => x.userId === u.id).map((x) => x.departmentId), teamIds: tm.filter((x) => x.userId === u.id).map((x) => x.teamId) }));
}
export async function loadVisibleTicket(c: DeskCtx, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) });
  return t && canSeeTicket(c, t) ? t : null;
}
export { canWorkTicket as canWork, canAssign as mayAssign };
