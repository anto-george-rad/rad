import 'server-only';
import { db, schema } from '@/db';
import { eq, sql } from 'drizzle-orm';
import type { Automation, AutomationTrigger, Deal, Lead } from '@/db/schema';
import { addDaysISO, fullName, tagsOf } from './utils';
import { notify } from './notify';

export type Subject = { type: 'deal'; row: Deal } | { type: 'lead'; row: Lead };
const fill = (s: string, subj: Subject) => s.replace(/\{\{name\}\}/g, subj.type === 'deal' ? subj.row.name : fullName(subj.row));
const href = (subj: Subject) => `/${subj.type === 'deal' ? 'deals' : 'leads'}/${subj.row.id}`;

/** Does this automation's filter match the subject? (event already matched) */
export function matches(t: AutomationTrigger, subj: Subject) {
  if (subj.type === 'deal') { if (t.pipelineId && t.pipelineId !== subj.row.pipelineId) return false; if (t.stageId && t.stageId !== subj.row.stageId) return false; }
  if (subj.type === 'lead' && t.status && t.status !== subj.row.status) return false;
  return true;
}

/** Runs one automation's actions on one record. Returns a short summary for the run log. */
async function runActions(a: Automation, subj: Subject, actorId: string | null, depth: number): Promise<string[]> {
  const A = a.actions; const done: string[] = []; const ran: string[] = [];
  let ownerId = subj.row.ownerId;
  let taskTarget: { type: string; id: string } = { type: subj.type, id: subj.row.id };
  if (A.assign?.pool?.length) {
    ownerId = A.assign.pool[a.rrIndex % A.assign.pool.length];
    await db.update(schema.automations).set({ rrIndex: sql`${schema.automations.rrIndex} + 1` }).where(eq(schema.automations.id, a.id));
    if (subj.type === 'deal') await db.update(schema.deals).set({ ownerId }).where(eq(schema.deals.id, subj.row.id));
    else await db.update(schema.leads).set({ ownerId }).where(eq(schema.leads.id, subj.row.id));
    await notify([ownerId], `${subj.type === 'deal' ? 'Deal' : 'Lead'} assigned to you`, subj.type === 'deal' ? subj.row.name : fullName(subj.row), href(subj));
    done.push('assigned owner');
  }
  if (A.tag) {
    const tags = Array.from(new Set([...tagsOf(subj.row.tags), ...tagsOf(A.tag)]));
    if (subj.type === 'deal') await db.update(schema.deals).set({ tags }).where(eq(schema.deals.id, subj.row.id));
    else await db.update(schema.leads).set({ tags }).where(eq(schema.leads.id, subj.row.id));
    done.push('tagged');
  }
  if (A.priority && subj.type === 'deal') { await db.update(schema.deals).set({ priority: A.priority as Deal['priority'] }).where(eq(schema.deals.id, subj.row.id)); done.push('set priority'); }
  if (A.status && subj.type === 'lead') { await db.update(schema.leads).set({ status: A.status as Lead['status'] }).where(eq(schema.leads.id, subj.row.id)); done.push('set status'); }
  if (A.createDeal && subj.type === 'deal') {
    const c = A.createDeal;
    const stage = await db.query.stages.findFirst({ where: eq(schema.stages.id, c.stageId) });
    if (stage) {
      const [nd] = await db.insert(schema.deals).values({
        name: subj.row.name, pipelineId: c.pipelineId, subPipelineId: c.subPipelineId, stageId: c.stageId,
        amount: subj.row.amount, currency: subj.row.currency, companyId: subj.row.companyId, contactId: subj.row.contactId,
        ownerId: ownerId || actorId, priority: subj.row.priority, tags: subj.row.tags, sourceDealId: subj.row.id, dealType: subj.row.dealType, leadSource: subj.row.leadSource,
      }).returning();
      await db.insert(schema.dealEvents).values([
        { dealId: nd.id, kind: 'created', text: `Created by automation “${a.name}”`, userId: actorId },
        { dealId: nd.id, kind: 'stage', stageId: c.stageId, userId: actorId },
      ]);
      taskTarget = { type: 'deal', id: nd.id };
      done.push('created a record');
      ran.push(...await runAutomations('deal.created', { type: 'deal', row: nd }, actorId, depth + 1));
    }
  }
  if (A.task?.title) {
    const assignee = ownerId || actorId;
    await db.insert(schema.activities).values({
      type: (A.task.type || 'task') as 'task', title: fill(A.task.title, subj), dueDate: addDaysISO(+A.task.dueDays || 0),
      relatedType: taskTarget.type, relatedId: taskTarget.id, ownerId: assignee, automation: a.name,
    });
    if (assignee && assignee !== actorId) await notify([assignee], 'New task for you', fill(A.task.title, subj), `/${taskTarget.type === 'deal' ? 'deals' : 'leads'}/${taskTarget.id}`);
    done.push('created a task');
  }
  if (A.note) { await db.insert(schema.notes).values({ relatedType: subj.type, relatedId: subj.row.id, body: fill(A.note, subj), authorId: actorId, automation: a.name }); done.push('added a note'); }
  if (A.notify?.message) {
    let to: (string | null)[] = [ownerId];
    if (A.notify.to === 'manager' && ownerId) to = [(await db.query.users.findFirst({ where: eq(schema.users.id, ownerId) }))?.managerId ?? null];
    await notify(to, fill(A.notify.message, subj), subj.type === 'deal' ? subj.row.name : fullName(subj.row), href(subj));
    done.push(`notified ${A.notify.to}`);
  }
  await db.update(schema.automations).set({ runCount: sql`${schema.automations.runCount} + 1` }).where(eq(schema.automations.id, a.id));
  return [done.join(', ') || 'no changes', ...ran];
}

/**
 * Runs every active automation whose trigger matches. Called on the server inside the action
 * that made the change (so rules fire no matter who edits the record) and by the scheduler for
 * time-based triggers. Each run is written to the run log. Returns names of automations that ran.
 */
export async function runAutomations(event: AutomationTrigger['event'], subj: Subject, actorId: string | null, depth = 0, dedupeKey?: string, only?: Automation): Promise<string[]> {
  if (depth > 2) return [];
  const list = only ? [only] : (await db.select().from(schema.automations).where(eq(schema.automations.active, true))).filter((a) => a.trigger.event === event);
  const names: string[] = [];
  for (const a of list) {
    if (!matches(a.trigger, subj)) continue;
    if (dedupeKey) {
      const claimed = await db.insert(schema.automationRuns).values({ automationId: a.id, recordType: subj.type, recordId: subj.row.id, dedupeKey, summary: 'running' }).onConflictDoNothing().returning({ id: schema.automationRuns.id });
      if (!claimed.length) continue; // already fired for this record and key
      const [summary, ...nested] = await runActions(a, subj, actorId, depth);
      await db.update(schema.automationRuns).set({ summary }).where(eq(schema.automationRuns.id, claimed[0].id));
      names.push(a.name, ...nested);
    } else {
      const [summary, ...nested] = await runActions(a, subj, actorId, depth);
      await db.insert(schema.automationRuns).values({ automationId: a.id, recordType: subj.type, recordId: subj.row.id, summary });
      names.push(a.name, ...nested);
    }
  }
  return names;
}
