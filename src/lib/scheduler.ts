import 'server-only';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Automation, TimeEvent } from '@/db/schema';
import { runAutomations } from './automation';
import { getSettings } from './settings';
import { notify } from './notify';
import { log } from './log';
import { addDaysISO, contractEndFrom, todayISO } from './utils';
import { licenceReminderDue, renewalDue, timeTriggerKey } from './schedule-rules';

const TIME_EVENTS: TimeEvent[] = ['deal.closing_soon', 'deal.idle', 'deal.contract_ending', 'lead.untouched'];

/** Time-based automations: closing soon, idle in stage, contract ending, lead untouched. */
async function timeAutomations(today: string) {
  const autos = (await db.select().from(schema.automations).where(eq(schema.automations.active, true))).filter((a) => TIME_EVENTS.includes(a.trigger.event as TimeEvent));
  if (!autos.length) return 0;
  const stages = await db.select({ id: schema.stages.id, type: schema.stages.type }).from(schema.stages);
  const type = new Map(stages.map((s) => [s.id, s.type]));
  const deals = autos.some((a) => a.trigger.event.startsWith('deal.')) ? await db.select().from(schema.deals) : [];
  const leads = autos.some((a) => a.trigger.event === 'lead.untouched') ? await db.select().from(schema.leads).where(eq(schema.leads.status, 'New')) : [];
  let fired = 0;
  for (const a of autos as Automation[]) {
    const ev = a.trigger.event; const days = a.trigger.days ?? (ev === 'deal.idle' ? 14 : 7);
    if (ev === 'lead.untouched') {
      for (const l of leads) { const key = timeTriggerKey(ev, days, l, today); if (key) fired += (await runAutomations(ev, { type: 'lead', row: l }, null, 0, key, a)).length; }
      continue;
    }
    for (const d of deals) {
      const st = type.get(d.stageId);
      if (ev === 'deal.contract_ending' ? st !== 'won' : st !== 'open') continue;
      const key = timeTriggerKey(ev, days, d, today);
      if (key) fired += (await runAutomations(ev, { type: 'deal', row: d }, null, 0, key, a)).length;
    }
  }
  return fired;
}

/** Won deals with a contract end coming up get a renewal deal in the Renewals pipeline. */
async function autoRenewals(today: string) {
  const s = await getSettings(); if (!s.renewalDays) return 0;
  const pipes = await db.select().from(schema.pipelines);
  const pipe = pipes.find((p) => p.id === s.renewalPipelineId) || pipes.find((p) => p.name.toLowerCase() === 'renewals');
  if (!pipe) return 0;
  const sub = (await db.select().from(schema.subPipelines).where(eq(schema.subPipelines.pipelineId, pipe.id)).orderBy(schema.subPipelines.sortOrder))[0]; if (!sub) return 0;
  const first = (await db.select().from(schema.stages).where(and(eq(schema.stages.subPipelineId, sub.id), eq(schema.stages.type, 'open'))).orderBy(schema.stages.sortOrder))[0]; if (!first) return 0;
  const wonStages = (await db.select({ id: schema.stages.id }).from(schema.stages).where(eq(schema.stages.type, 'won'))).map((x) => x.id);
  if (!wonStages.length) return 0;
  const due = (await db.select().from(schema.deals).where(and(inArray(schema.deals.stageId, wonStages), isNull(schema.deals.renewalDealId), lte(schema.deals.contractEnd, addDaysISO(s.renewalDays, today)))))
    .filter((d) => renewalDue(d.contractEnd, today, s.renewalDays));
  for (const d of due) {
    const start = addDaysISO(1, d.contractEnd!);
    const [nd] = await db.insert(schema.deals).values({
      name: `${d.name.replace(/ – renewal \d{4}$/, '')} – renewal ${start.slice(0, 4)}`, pipelineId: pipe.id, subPipelineId: sub.id, stageId: first.id,
      amount: d.recurringValue ?? d.amount, currency: d.currency, companyId: d.companyId, contactId: d.contactId, ownerId: d.ownerId, closingDate: d.contractEnd,
      dealType: 'Renewal', leadSource: d.leadSource, contractStart: start, termMonths: d.termMonths, contractEnd: contractEndFrom(start, d.termMonths), recurringValue: d.recurringValue,
      paymentTerms: d.paymentTerms, tags: d.tags, sourceDealId: d.id,
    }).returning();
    await db.update(schema.deals).set({ renewalDealId: nd.id }).where(eq(schema.deals.id, d.id));
    await db.insert(schema.dealEvents).values([{ dealId: nd.id, kind: 'created', text: `Renewal opened automatically — contract ends ${d.contractEnd}` }, { dealId: nd.id, kind: 'stage', stageId: first.id }]);
    await db.insert(schema.activities).values({ type: 'task', title: `Start renewal talks: ${d.name}`, dueDate: today, relatedType: 'deal', relatedId: nd.id, ownerId: d.ownerId, automation: 'Auto renewal' });
    await notify([d.ownerId], 'Renewal opened', `${d.name} — contract ends ${d.contractEnd}`, `/deals/${nd.id}`);
    await runAutomations('deal.created', { type: 'deal', row: nd }, null);
  }
  return due.length;
}

/** Remind the company owner before a trade licence expires (once per expiry date). */
async function licenceReminders(today: string) {
  const s = await getSettings(); if (!s.licenceReminderDays) return 0;
  const rows = (await db.select().from(schema.companies).where(lte(schema.companies.tradeLicenceExpiry, addDaysISO(s.licenceReminderDays, today))))
    .filter((c) => licenceReminderDue(c.tradeLicenceExpiry, c.licenceReminderFor, today, s.licenceReminderDays));
  for (const c of rows) {
    const expired = c.tradeLicenceExpiry! < today;
    await notify([c.ownerId], expired ? 'Trade licence expired' : 'Trade licence expiring', `${c.name} — ${c.tradeLicenceExpiry}`, `/companies/${c.id}`);
    await db.insert(schema.activities).values({ type: 'task', title: `Ask ${c.name} for their renewed trade licence`, dueDate: today, relatedType: 'company', relatedId: c.id, ownerId: c.ownerId, automation: 'Licence reminder' });
    await db.update(schema.companies).set({ licenceReminderFor: c.tradeLicenceExpiry }).where(eq(schema.companies.id, c.id));
  }
  return rows.length;
}

/** Tell a person's manager when their tasks are N days overdue (once per task). */
async function overdueAlerts(today: string) {
  const s = await getSettings(); if (!s.overdueAlertDays) return 0;
  const cutoff = addDaysISO(-s.overdueAlertDays, today);
  const late = await db.select().from(schema.activities).where(and(eq(schema.activities.done, false), lte(schema.activities.dueDate, cutoff), isNull(schema.activities.managerAlertedAt)));
  if (!late.length) return 0;
  const users = await db.select({ id: schema.users.id, name: schema.users.name, managerId: schema.users.managerId, active: schema.users.active }).from(schema.users);
  const byOwner = new Map<string, typeof late>();
  for (const a of late) if (a.ownerId) byOwner.set(a.ownerId, [...(byOwner.get(a.ownerId) || []), a]);
  for (const [ownerId, list] of Array.from(byOwner)) {
    const u = users.find((x) => x.id === ownerId); const mgr = u?.managerId && users.find((x) => x.id === u.managerId && x.active);
    if (mgr) await notify([mgr.id], `${u!.name} has ${list.length} task${list.length === 1 ? '' : 's'} overdue ${s.overdueAlertDays}+ days`, list.slice(0, 3).map((a) => a.title).join(' · '), `/activities?user=${ownerId}`);
  }
  await db.update(schema.activities).set({ managerAlertedAt: new Date() }).where(inArray(schema.activities.id, late.map((a) => a.id)));
  return late.length;
}

/** Deal registration with the vendor is about to expire (once per expiry date). */
async function dealRegReminders(today: string) {
  const s = await getSettings(); if (!s.dealRegReminderDays) return 0;
  const rows = (await db.select().from(schema.deals).where(lte(schema.deals.dealRegExpiry, addDaysISO(s.dealRegReminderDays, today))))
    .filter((d) => licenceReminderDue(d.dealRegExpiry, d.dealRegRemindedFor, today, s.dealRegReminderDays));
  for (const d of rows) {
    await notify([d.ownerId], d.dealRegExpiry! < today ? 'Deal registration expired' : 'Deal registration expiring', `${d.name} — ${d.dealRegNumber || 'registration'} ends ${d.dealRegExpiry}`, `/deals/${d.id}`);
    await db.update(schema.deals).set({ dealRegRemindedFor: d.dealRegExpiry }).where(eq(schema.deals.id, d.id));
  }
  return rows.length;
}
/** Recycle bin keeps records for 30 days. */
async function purgeTrash() {
  const old = await db.select().from(schema.trash).where(sql`${schema.trash.deletedAt} < now() - interval '30 days'`);
  const { removeStored } = await import('./files');
  for (const t of old) for (const f of ((t.data as { files?: { storageKey: string }[] }).files || [])) await removeStored(f.storageKey);
  if (old.length) await db.delete(schema.trash).where(sql`${schema.trash.deletedAt} < now() - interval '30 days'`);
  await db.delete(schema.ticketPresence).where(sql`${schema.ticketPresence.at} < now() - interval '1 hour'`);
  return old.length;
}

let fastRunning = false;
/** Every few minutes: SLA timers and support mailboxes. */
export async function runFastJobs() {
  if (fastRunning) return { skipped: true };
  fastRunning = true; const out: Record<string, unknown> = {};
  try {
    const { slaSweep } = await import('./desk'); const { pollMailboxes } = await import('./desk-mail');
    try { out.sla = await slaSweep(); } catch (e) { log.error('job_failed', { job: 'sla', error: String(e) }); }
    try { out.mail = await pollMailboxes(); } catch (e) { log.error('job_failed', { job: 'mail', error: String(e) }); }
    try { const { syncMailboxes } = await import('./outlook'); out.outlook = await syncMailboxes(); } catch (e) { log.error('job_failed', { job: 'outlook', error: String(e) }); }
    return out;
  } finally { fastRunning = false; }
}

let running = false;
/** Runs every hourly job. Safe to call repeatedly: every job is de-duplicated. */
export async function runScheduledJobs() {
  if (running) return { skipped: true };
  running = true; const today = todayISO(); const out: Record<string, number | string> = {};
  try {
    const { deskHousekeeping } = await import('./desk'); const { licenceRenewals } = await import('./licences'); const { contractHoursJob } = await import('./contracts'); const { reportJob } = await import('./report-mail');
    for (const [name, job] of [['licenceRenewals', licenceRenewals], ['contractHours', contractHoursJob], ['reports', async () => reportJob()], ['automations', timeAutomations], ['renewals', autoRenewals], ['licences', licenceReminders], ['overdue', overdueAlerts], ['dealReg', dealRegReminders], ['trash', purgeTrash], ['desk', async () => (await deskHousekeeping()).autoClosed]] as const) {
      try { out[name] = await job(today); } catch (e) { out[name] = 'failed'; log.error('job_failed', { job: name, error: String(e) }); }
    }
    await db.delete(schema.notifications).where(sql`${schema.notifications.createdAt} < now() - interval '120 days'`);
    log.info('scheduler_ran', out);
    return out;
  } finally { running = false; }
}

