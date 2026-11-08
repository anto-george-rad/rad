import 'server-only';
import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { EscalationRule, Ticket } from '@/db/schema';
import { notify } from './notify';
import { agents } from './desk-access';

/** Pure (unit-tested): the highest rule level a breached ticket has now reached, if above its current level. */
export function nextEscalation(rules: Pick<EscalationRule, 'level' | 'afterMinutes' | 'departmentId' | 'active'>[], t: Pick<Ticket, 'departmentId' | 'dueAt' | 'escalationLevel'>, now: Date) {
  if (!t.dueAt) return null;
  const over = (+now - +t.dueAt) / 60_000; if (over < 0) return null;
  const mine = rules.filter((r) => r.active && (!r.departmentId || r.departmentId === t.departmentId) && r.afterMinutes <= over && r.level > t.escalationLevel);
  // A department's own ladder wins over the general one.
  // One step at a time (lowest level not reached yet), so every level on the ladder is told in turn.
  const own = mine.filter((r) => r.departmentId); const pick = (own.length ? own : mine).sort((a, b) => a.level - b.level)[0];
  return pick || null;
}
/** Every few minutes: walk overdue tickets up the escalation ladder (team lead → manager → helpdesk admins). */
export async function escalationSweep(now = new Date()) {
  const rules = await db.select().from(schema.escalationRules).where(eq(schema.escalationRules.active, true)).orderBy(asc(schema.escalationRules.level)); if (!rules.length) return 0;
  const open = await db.select().from(schema.tickets).where(and(ne(schema.tickets.statusCategory, 'closed'), ne(schema.tickets.statusCategory, 'onhold'), isNotNull(schema.tickets.breachedAt), isNull(schema.tickets.mergedIntoId), eq(schema.tickets.isSpam, false)));
  if (!open.length) return 0;
  const ag = await agents(); const teams = await db.select().from(schema.teams); const { tag, ticketHref, event, assignInternal, setPriorityInternal } = await import('./desk');
  let n = 0;
  for (const t of open) {
    const r = nextEscalation(rules, t, now) as EscalationRule | null; if (!r) continue;
    const assignee = ag.find((a) => a.id === t.assigneeId);
    const lead = t.teamId ? teams.find((x) => x.id === t.teamId)?.leadId : teams.find((x) => x.departmentId === t.departmentId && assignee?.teamIds.includes(x.id))?.leadId;
    const admins = ag.filter((a) => a.active && a.deskRole === 'admin').map((a) => a.id);
    const target = r.target === 'team_lead' ? lead || assignee?.managerId || null : r.target === 'manager' ? assignee?.managerId || lead || null : r.target === 'user' ? r.userId : null;
    const who = r.target === 'desk_admins' ? admins : [target].filter((x): x is string => !!x);
    let row = t;
    if (r.reassign && target && target !== t.assigneeId) { const g = ag.find((a) => a.id === target); if (g && g.deskRole !== 'light' && g.deskRole !== 'none' && g.active) row = await assignInternal(row, target, null); }
    if (r.raisePriority) { const up: Record<string, string> = { Low: 'Medium', Medium: 'High', High: 'Urgent' }; if (up[row.priority]) row = await setPriorityInternal(row, up[row.priority], null); }
    await db.update(schema.tickets).set({ escalationLevel: r.level, escalated: true }).where(eq(schema.tickets.id, t.id));
    const label = r.target === 'team_lead' ? 'team lead' : r.target === 'manager' ? 'manager' : r.target === 'desk_admins' ? 'helpdesk admins' : 'escalation contact';
    await event(t.id, null, `Escalated to level ${r.level} (${label})${r.reassign && row.assigneeId !== t.assigneeId ? ' and reassigned' : ''}`);
    await notify([...who, t.assigneeId], `Escalation level ${r.level}: ${await tag(t.number)}`, `${t.subject} — overdue since ${t.dueAt!.toISOString().slice(0, 16).replace('T', ' ')} UTC`, ticketHref(t.id));
    n++;
  }
  return n;
}
