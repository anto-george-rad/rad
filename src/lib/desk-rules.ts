/**
 * Helpdesk permissions as pure functions (unit-tested). Mirrors Zoho Desk:
 *  - Desk admin: every ticket, every action, assigns to anyone.
 *  - Agent: sees tickets in their departments by scope —
 *      all        → every ticket in the helpdesk
 *      department → every ticket in their departments
 *      team       → their own + unassigned + their teams' tickets, in their departments
 *      own        → their own + unassigned, in their departments
 *    plus, always, tickets assigned to people who report to them.
 *  - Light agent: reads tickets in their departments and adds private notes only; never assigned.
 *  - No desk role: no helpdesk at all.
 */
import type { DeskRole, TicketScope } from '@/db/schema';

export type DeskCtx = { userId: string; role: DeskRole; scope: TicketScope; deptIds: string[]; teamIds: string[]; reportIds: string[] };
export type TicketLite = { departmentId: string; teamId: string | null; assigneeId: string | null };
export type AgentLite = { id: string; active: boolean; deskRole: DeskRole; deptIds: string[]; teamIds: string[] };

export function canSeeTicket(c: DeskCtx, t: TicketLite) {
  if (c.role === 'admin') return true;
  if (c.role === 'none') return false;
  if (t.assigneeId && c.reportIds.includes(t.assigneeId)) return true;
  if (c.role === 'agent' && c.scope === 'all') return true;
  if (!c.deptIds.includes(t.departmentId)) return false;
  if (c.role === 'light' || c.scope === 'department') return true;
  if (!t.assigneeId || t.assigneeId === c.userId) return true;
  return c.scope === 'team' && !!t.teamId && c.teamIds.includes(t.teamId);
}
/** Change fields, reply to the customer, merge, close… (light agents can only add private notes). */
export const canWorkTicket = (c: DeskCtx, t: TicketLite) => (c.role === 'admin' || c.role === 'agent') && canSeeTicket(c, t);
/** Who can receive tickets of a department: active admins and agents who belong to it. */
export const isAssignable = (a: AgentLite, departmentId: string) => a.active && (a.deskRole === 'admin' || (a.deskRole === 'agent' && a.deptIds.includes(departmentId)));
/** May this person assign ticket t to agent a (or unassign with a = null)? */
export function canAssign(c: DeskCtx, t: TicketLite, a: AgentLite | null) {
  if (!canWorkTicket(c, t)) return false;
  if (a && !isAssignable(a, t.departmentId)) return false;
  if (c.role === 'admin' || c.scope === 'all' || c.scope === 'department') return true;
  if (!a) return t.assigneeId === c.userId || (!!t.assigneeId && c.reportIds.includes(t.assigneeId));
  if (a.id === c.userId || c.reportIds.includes(a.id)) return true;
  return c.scope === 'team' && a.teamIds.some((x) => c.teamIds.includes(x));
}
/** Desk settings (departments, SLAs, statuses, rules, canned replies for everyone, knowledge base). */
export const canManageDesk = (c: Pick<DeskCtx, 'role'>) => c.role === 'admin';
