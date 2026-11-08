import 'server-only';
import { createHmac } from 'crypto';
import { and, asc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Automation, StatusCategory, Ticket } from '@/db/schema';
import { getSettings } from './settings';
import { notify } from './notify';
import { log } from './log';
import { mailEnabled } from './mailer';
import { agents, isAssignable } from './desk-access';
import { businessMinutesBetween, dueDates, pickPolicy, slaProgress, addBusinessMinutes } from './sla';
import { emailDomain, isFreeMail, siteDomain, ticketTag } from './mail-parse';
import { APP_TZ, fullName, tagsOf, todayISO } from './utils';
import { pickContract, routingPool } from './routing';

const TZ = () => APP_TZ || 'Asia/Dubai';
export const tag = async (n: number) => ticketTag((await getSettings()).ticketPrefix, n);
export const ticketHref = (id: string) => `/desk/tickets/${id}`;
export async function event(ticketId: string, userId: string | null, text: string) { await db.insert(schema.ticketEvents).values({ ticketId, userId, text }); }

export async function statuses() { return db.select().from(schema.ticketStatuses).orderBy(asc(schema.ticketStatuses.sortOrder)); }
export async function defaultStatus(category: StatusCategory = 'open') {
  const all = await statuses();
  return all.find((s) => s.category === category && s.isDefault) || all.find((s) => s.category === category) || all[0];
}

/** Finds the contact by email (or creates one) and links the company by email domain. */
export async function findOrCreateRequester(email: string | null | undefined, name?: string | null, phone?: string | null) {
  if (!email) return { contactId: null as string | null, companyId: null as string | null };
  const e = email.trim().toLowerCase();
  let c = await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${e}` });
  if (!c) {
    const dom = emailDomain(e);
    const companies = dom && !isFreeMail(dom) ? await db.select({ id: schema.companies.id, website: schema.companies.website, ownerId: schema.companies.ownerId }).from(schema.companies) : [];
    const co = companies.find((x) => siteDomain(x.website) === dom);
    const [first, ...rest] = (name || e.split('@')[0]).trim().split(/\s+/);
    [c] = await db.insert(schema.contacts).values({ firstName: first || e, lastName: rest.join(' ') || null, email: e, phone: phone || null, companyId: co?.id || null, source: 'Support', ownerId: co?.ownerId || null }).returning();
  }
  return { contactId: c.id, companyId: c.companyId };
}

/** The support contract covering a company today (preferring one that lists the product), and whether an older one lapsed. */
export async function contractFor(companyId: string | null, productId: string | null, day = todayISO()) {
  if (!companyId) return { contract: null, expired: null as string | null };
  const list = await db.select().from(schema.supportContracts).where(eq(schema.supportContracts.companyId, companyId));
  const contract = pickContract(list, day, productId);
  const lapsed = contract ? null : list.filter((c) => c.endDate < day).sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.endDate || null;
  return { contract, expired: lapsed };
}
/** SLA from the contract (its own policy, or its tier) — otherwise from the company tier. */
async function slaFor(t: { departmentId: string; companyId: string | null; priority: string; productId?: string | null; contractId?: string | null }, from: Date) {
  const [policies, s] = await Promise.all([db.select().from(schema.slaPolicies), getSettings()]);
  const contract = t.contractId ? await db.query.supportContracts.findFirst({ where: eq(schema.supportContracts.id, t.contractId) }) : (await contractFor(t.companyId, t.productId ?? null)).contract;
  const tier = contract?.tier ?? (t.companyId ? (await db.query.companies.findFirst({ where: eq(schema.companies.id, t.companyId), columns: { tier: true } }))?.tier : null);
  const p = (contract?.slaPolicyId && policies.find((x) => x.id === contract.slaPolicyId && x.active)) || pickPolicy(policies, t.departmentId, tier);
  return { slaPolicyId: p?.id || null, ...dueDates(p, t.priority, from, s.businessHours, TZ()) };
}

export type NewTicket = {
  subject: string; description?: string | null; departmentId?: string | null; priority?: string; type?: string | null; channel: string; category?: string | null;
  contactId?: string | null; companyId?: string | null; dealId?: string | null; productId?: string | null; requesterName?: string | null; requesterEmail?: string | null; requesterPhone?: string | null;
  cc?: string | null; assigneeId?: string | null; teamId?: string | null; tags?: string[]; custom?: Record<string, unknown>; parentId?: string | null; createdBy?: string | null;
  firstMessage?: { kind: 'incoming' | 'note'; body: string; fromName?: string | null; fromEmail?: string | null; messageId?: string | null; inReplyTo?: string | null } | null;
  ack?: boolean; isSample?: boolean; language?: string | null;
};
export async function createTicketInternal(n: NewTicket): Promise<Ticket> {
  const deps = await db.select().from(schema.departments).where(eq(schema.departments.active, true)).orderBy(asc(schema.departments.sortOrder));
  const dept = deps.find((d) => d.id === n.departmentId) || deps[0];
  if (!dept) throw new Error('Set up a helpdesk department first (Settings → Departments).');
  let { contactId = null, companyId = null } = n;
  if (!contactId && n.requesterEmail) ({ contactId, companyId } = await findOrCreateRequester(n.requesterEmail, n.requesterName, n.requesterPhone).then((r) => ({ contactId: r.contactId, companyId: companyId || r.companyId })));
  if (contactId && !companyId) companyId = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId), columns: { companyId: true } }))?.companyId ?? null;
  const contact = contactId ? await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) }) : null;
  const st = await defaultStatus('open'); let priority = n.priority || 'Medium'; const now = new Date();
  // AI triage (when enabled): category, priority, language and mood from the first message.
  let triage: { category?: string; priority?: string; language?: string; sentiment?: string } = {};
  if (n.channel !== 'internal' && !n.isSample) { const { triageTicket } = await import('./ai-desk'); triage = await triageTicket(n.subject, n.firstMessage?.body || n.description || '').catch(() => ({})); }
  if (!n.priority && triage.priority) priority = triage.priority;
  const cov = await contractFor(companyId, n.productId || null);
  const sla = await slaFor({ departmentId: dept.id, companyId, priority, productId: n.productId || null, contractId: cov.contract?.id || null }, now);
  const [t] = await db.insert(schema.tickets).values({
    subject: n.subject.trim().slice(0, 250) || '(no subject)', description: n.description?.trim() || null, statusId: st.id, statusCategory: st.category, priority, type: n.type || null, channel: n.channel,
    category: n.category || null, departmentId: dept.id, teamId: n.teamId || null, assigneeId: null, contactId, companyId, dealId: n.dealId || null, productId: n.productId || null,
    requesterName: n.requesterName || (contact ? fullName(contact) : null), requesterEmail: (n.requesterEmail || contact?.email || null)?.toLowerCase() || null, requesterPhone: n.requesterPhone || contact?.mobile || contact?.phone || null,
    cc: n.cc || null, tags: tagsOf([...(n.tags || []), ...(cov.expired ? ['contract-expired'] : [])]), custom: n.custom || {}, parentId: n.parentId || null, createdBy: n.createdBy || null, isSample: !!n.isSample,
    ...sla, lastCustomerReplyAt: n.firstMessage?.kind === 'incoming' ? now : null, contractId: cov.contract?.id || null,
    language: n.language || triage.language || null, sentiment: triage.sentiment || null, ...(n.category ? {} : triage.category ? { category: triage.category } : {}),
  }).returning();
  if (n.firstMessage?.body?.trim()) await db.insert(schema.ticketThreads).values({ ticketId: t.id, kind: n.firstMessage.kind, authorId: n.firstMessage.kind === 'note' ? n.createdBy || null : null, fromName: n.firstMessage.fromName || t.requesterName, fromEmail: n.firstMessage.fromEmail || t.requesterEmail, body: n.firstMessage.body.trim(), messageId: n.firstMessage.messageId || null, inReplyTo: n.firstMessage.inReplyTo || null, channel: n.channel });
  await event(t.id, n.createdBy || null, `Created via ${n.channel}`);
  if (cov.contract) await event(t.id, null, `Covered by support contract “${cov.contract.name}” (${cov.contract.tier})`);
  else if (cov.expired) await event(t.id, null, `No active support contract — the last one ended ${cov.expired}`);
  if (Object.keys(triage).length) await event(t.id, null, `AI triage: ${[triage.category, triage.priority && `${triage.priority} priority`, triage.language, triage.sentiment === 'negative' && 'customer sounds frustrated'].filter(Boolean).join(' · ')}`);
  let ticket = t;
  if (n.assigneeId) ticket = await assignInternal(ticket, n.assigneeId, n.createdBy || null, false);
  ticket = await runTicketAutomations('ticket.created', ticket, n.createdBy || null);
  if (!ticket.assigneeId) ticket = await autoAssign(ticket);
  if (ticket.sentiment === 'negative') await frustratedAlert(ticket, null);
  if (n.channel !== 'internal' || n.firstMessage?.kind === 'incoming') { const { ticketHandoff } = await import('./handoff'); await ticketHandoff(ticket, `${ticket.subject}\n${n.firstMessage?.body || n.description || ''}`).catch((e) => log.error('handoff_failed', { error: String(e) })); }
  if (!ticket.assigneeId) {
    const members = (await agents()).filter((a) => isAssignable(a, ticket.departmentId) && a.id !== n.createdBy).map((a) => a.id);
    await notify(members, `New ticket ${await tag(ticket.number)} in ${dept.name}`, ticket.subject, ticketHref(ticket.id));
  }
  if (n.ack && dept.autoAck && ticket.requesterEmail && mailEnabled()) {
    const { sendTicketMail } = await import('./desk-mail');
    await sendTicketMail(ticket, { kind: 'ack', body: `Hello ${ticket.requesterName?.split(' ')[0] || 'there'},\n\nThank you for contacting ${dept.name}. Your request has been received and logged as ${await tag(ticket.number)}. Our team will get back to you shortly.\n\nTo add more information, simply reply to this email.` }).catch((e) => log.error('ack_failed', { error: String(e) }));
  }
  return ticket;
}

/** Assigns without permission checks (callers check). Notifies the new assignee. */
export async function assignInternal(t: Ticket, userId: string | null, actorId: string | null, log_ = true): Promise<Ticket> {
  if (t.assigneeId === userId) return t;
  const [row] = await db.update(schema.tickets).set({ assigneeId: userId, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id)).returning();
  const name = userId ? (await db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { name: true } }))?.name : null;
  if (log_ || userId) await event(t.id, actorId, userId ? `Assigned to ${name}` : 'Unassigned');
  if (userId && userId !== actorId) await notify([userId], `Ticket ${await tag(t.number)} assigned to you`, t.subject, ticketHref(t.id));
  return row;
}
/** Department assignment mode: round-robin or least-loaded among available agents (or the ticket's team). */
export async function autoAssign(t: Ticket, modeOverride?: 'round_robin' | 'load', teamId?: string | null): Promise<Ticket> {
  const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, t.departmentId) }); if (!dept) return t;
  const mode = modeOverride || dept.assignMode; if (mode === 'manual') return t;
  const team = teamId ?? t.teamId;
  const all = (await agents()).filter((a) => isAssignable(a, t.departmentId) && a.available && a.deskRole === 'agent' && (!team || a.teamIds.includes(team))).sort((a, b) => a.name.localeCompare(b.name));
  // Skills, shifts and leave: only people working now, best product/vendor/language match first.
  const pool = routingPool(all, { productId: t.productId, vendor: t.vendorName, language: t.language }, new Date(), TZ());
  if (!pool.length) return t;
  let pick = pool[0];
  if (mode === 'round_robin') {
    pick = pool[dept.rrIndex % pool.length];
    await db.update(schema.departments).set({ rrIndex: sql`${schema.departments.rrIndex} + 1` }).where(eq(schema.departments.id, dept.id));
  } else {
    const loads = await db.select({ a: schema.tickets.assigneeId, c: sql<number>`count(*)` }).from(schema.tickets).where(and(inArray(schema.tickets.assigneeId, pool.map((p) => p.id)), ne(schema.tickets.statusCategory, 'closed'))).groupBy(schema.tickets.assigneeId);
    pick = [...pool].sort((a, b) => Number(loads.find((l) => l.a === a.id)?.c || 0) - Number(loads.find((l) => l.a === b.id)?.c || 0))[0];
  }
  const r = await assignInternal(t, pick.id, null, false);
  await event(t.id, null, `Auto-assigned to ${pick.name} (${mode === 'load' ? 'least busy' : 'round-robin'})`);
  return r;
}

/** Status change with SLA side effects: pause while on hold, stop when resolved, restart when reopened. */
export async function setStatusInternal(t: Ticket, statusId: string, actorId: string | null): Promise<Ticket> {
  const all = await statuses(); const st = all.find((x) => x.id === statusId); if (!st || st.id === t.statusId) return t;
  const s = await getSettings(); const now = new Date();
  const patch: Partial<Ticket> = { statusId: st.id, statusCategory: st.category, updatedAt: now };
  if (t.statusCategory === 'onhold' && st.category !== 'onhold' && t.onHoldSince) {
    const policy = t.slaPolicyId ? await db.query.slaPolicies.findFirst({ where: eq(schema.slaPolicies.id, t.slaPolicyId) }) : null;
    const paused = businessMinutesBetween(t.onHoldSince, now, s.businessHours, TZ(), policy?.businessHours ?? true);
    if (paused > 0) {
      if (t.dueAt && !t.breachedAt) patch.dueAt = addBusinessMinutes(t.dueAt, paused, s.businessHours, TZ(), policy?.businessHours ?? true);
      if (t.firstResponseDueAt && !t.firstRespondedAt && !t.frBreachedAt) patch.firstResponseDueAt = addBusinessMinutes(t.firstResponseDueAt, paused, s.businessHours, TZ(), policy?.businessHours ?? true);
    }
    patch.onHoldSince = null;
  }
  if (st.category === 'onhold' && t.statusCategory !== 'onhold') patch.onHoldSince = now;
  if (st.category === 'closed' && t.statusCategory !== 'closed') { patch.resolvedAt = t.resolvedAt ?? now; if (/^closed/i.test(st.name)) patch.closedAt = now; }
  if (st.category !== 'closed' && t.statusCategory === 'closed') {
    patch.reopenedCount = t.reopenedCount + 1; patch.resolvedAt = null; patch.closedAt = null; patch.breachedAt = null; patch.slaWarnedAt = null;
    Object.assign(patch, await slaFor(t, now).then((x) => ({ dueAt: x.dueAt })));
  }
  const [row] = await db.update(schema.tickets).set(patch).where(eq(schema.tickets.id, t.id)).returning();
  await event(t.id, actorId, `Status → ${st.name}${patch.reopenedCount ? ' (reopened)' : ''}`);
  if (st.category === 'closed' && t.statusCategory !== 'closed' && !/^closed/i.test(st.name)) await sendResolvedMail(row).catch((e) => log.error('resolved_mail_failed', { error: String(e) }));
  return runTicketAutomations('ticket.status', row, actorId);
}
/** Priority changes recalculate the SLA from when the ticket was created. */
export async function setPriorityInternal(t: Ticket, priority: string, actorId: string | null) {
  if (t.priority === priority) return t;
  const sla = await slaFor({ ...t, priority }, t.createdAt);
  const [row] = await db.update(schema.tickets).set({ priority, slaPolicyId: sla.slaPolicyId, dueAt: t.breachedAt ? t.dueAt : sla.dueAt, firstResponseDueAt: t.firstRespondedAt || t.frBreachedAt ? t.firstResponseDueAt : sla.firstResponseDueAt, slaWarnedAt: null, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id)).returning();
  await event(t.id, actorId, `Priority → ${priority}`);
  return row;
}

/** Signed links for satisfaction ratings in emails and the portal. */
export const ratingToken = (ticketId: string) => createHmac('sha256', 'rad-rate:' + (process.env.AUTH_SECRET || 'dev-only-secret-not-for-production-use')).update(ticketId).digest('base64url').slice(0, 24);
async function sendResolvedMail(t: Ticket) {
  const s = await getSettings(); if (!t.requesterEmail || !mailEnabled()) return;
  const base = (process.env.APP_URL || '').replace(/\/$/, ''); const tok = ratingToken(t.id);
  const rate = s.csatEnabled ? `\n\nHow did we do?\n  Great: ${base}/rate/${t.id}/${tok}/good\n  Okay: ${base}/rate/${t.id}/${tok}/ok\n  Not good: ${base}/rate/${t.id}/${tok}/bad` : '';
  const { sendTicketMail } = await import('./desk-mail');
  await sendTicketMail(t, { kind: 'resolved', body: `Hello ${t.requesterName?.split(' ')[0] || 'there'},\n\nWe've marked your request ${await tag(t.number)} as resolved. If anything still isn't right, just reply to this email and it will reopen.${rate}` });
}

/** Who should hear about activity on a ticket: assignee and watchers (minus the person acting). */
export async function followers(t: Ticket, except: string | null) {
  const w = await db.select({ u: schema.ticketWatchers.userId }).from(schema.ticketWatchers).where(eq(schema.ticketWatchers.ticketId, t.id));
  return Array.from(new Set([t.assigneeId, ...w.map((x) => x.u)].filter((x): x is string => !!x && x !== except)));
}

/** A customer wrote back (email or portal): reopen or resume, notify, run rules. */
export async function customerReplied(t: Ticket, body: string, meta: { fromName?: string | null; fromEmail?: string | null; messageId?: string | null; inReplyTo?: string | null; channel: string }) {
  await db.insert(schema.ticketThreads).values({ ticketId: t.id, kind: 'incoming', body: body.trim(), fromName: meta.fromName, fromEmail: meta.fromEmail, messageId: meta.messageId, inReplyTo: meta.inReplyTo, channel: meta.channel });
  let row = (await db.update(schema.tickets).set({ lastCustomerReplyAt: new Date(), updatedAt: new Date() }).where(eq(schema.tickets.id, t.id)).returning())[0];
  const s = await getSettings();
  if ((row.statusCategory === 'closed' && s.reopenOnReply) || row.statusCategory === 'onhold') row = await setStatusInternal(row, (await defaultStatus('open')).id, null);
  await notify(await followers(row, null), `Customer replied on ${await tag(row.number)}`, body.slice(0, 120), ticketHref(row.id));
  const { sentimentOf } = await import('./ai-desk'); const mood = await sentimentOf(body).catch(() => null);
  if (mood && mood !== row.sentiment) { row = (await db.update(schema.tickets).set({ sentiment: mood }).where(eq(schema.tickets.id, row.id)).returning())[0]; if (mood === 'negative') await frustratedAlert(row, body); }
  const { ticketHandoff } = await import('./handoff'); await ticketHandoff(row, body).catch((e) => log.error('handoff_failed', { error: String(e) }));
  return runTicketAutomations('ticket.customer_reply', row, null);
}
/** Angry-customer alert: the assignee and their manager hear about it before it becomes an escalation. */
async function frustratedAlert(t: Ticket, body: string | null) {
  const mgr = t.assigneeId ? (await db.query.users.findFirst({ where: eq(schema.users.id, t.assigneeId), columns: { managerId: true } }))?.managerId : null;
  await event(t.id, null, 'Customer sounds frustrated (AI)');
  await notify([t.assigneeId, mgr ?? null], `Frustrated customer on ${await tag(t.number)}`, (body || t.subject).slice(0, 140), ticketHref(t.id));
}

/* ---------------- ticket automations ---------------- */
function ticketMatches(a: Automation, t: Ticket) {
  const x = a.trigger;
  if (x.departmentId && x.departmentId !== t.departmentId) return false;
  if (x.priority && x.priority !== t.priority) return false;
  if (x.channel && x.channel !== t.channel) return false;
  if (x.statusId && x.statusId !== t.statusId) return false;
  if (x.keyword && !x.keyword.toLowerCase().split('|').map((k) => k.trim()).filter(Boolean).some((k) => `${t.subject} ${t.description || ''}`.toLowerCase().includes(k))) return false;
  return true;
}
export async function runTicketAutomations(ev: string, t: Ticket, actorId: string | null, depth = 0, only?: Automation, dedupeKey?: string): Promise<Ticket> {
  if (depth > 2) return t;
  const list = only ? [only] : (await db.select().from(schema.automations).where(eq(schema.automations.active, true))).filter((a) => a.trigger.event === ev);
  let row = t;
  for (const a of list) {
    if (!ticketMatches(a, row)) continue;
    if (dedupeKey) { const c = await db.insert(schema.automationRuns).values({ automationId: a.id, recordType: 'ticket', recordId: row.id, dedupeKey, summary: 'running' }).onConflictDoNothing().returning({ id: schema.automationRuns.id }); if (!c.length) continue; }
    const X = a.actions; const did: string[] = [];
    try {
      if (X.setTeamId) { row = (await db.update(schema.tickets).set({ teamId: X.setTeamId }).where(eq(schema.tickets.id, row.id)).returning())[0]; did.push('set team'); }
      if (X.setPriority) { row = await setPriorityInternal(row, X.setPriority, null); did.push('set priority'); }
      if (X.tag) { row = (await db.update(schema.tickets).set({ tags: Array.from(new Set([...row.tags, ...tagsOf(X.tag)])) }).where(eq(schema.tickets.id, row.id)).returning())[0]; did.push('tagged'); }
      if (X.assignTo) {
        if (X.assignTo.mode === 'agent' && X.assignTo.userId) { const ag = (await agents()).find((g) => g.id === X.assignTo!.userId); if (ag && isAssignable(ag, row.departmentId)) { row = await assignInternal(row, ag.id, null); did.push('assigned'); } }
        else if (X.assignTo.mode !== 'agent') { row = await autoAssign(row, X.assignTo.mode, X.assignTo.teamId); did.push('auto-assigned'); }
      }
      if (X.setStatusId && X.setStatusId !== row.statusId) { row = await setStatusInternal(row, X.setStatusId, null); did.push('set status'); }
      if (X.note) { await db.insert(schema.ticketThreads).values({ ticketId: row.id, kind: 'note', body: X.note, fromName: `Automation: ${a.name}` }); did.push('added note'); }
      if (X.notify?.message) {
        let to: (string | null)[] = [row.assigneeId];
        if (X.notify.to === 'manager' && row.assigneeId) to = [(await db.query.users.findFirst({ where: eq(schema.users.id, row.assigneeId) }))?.managerId ?? null];
        if (X.notify.to === 'department') to = (await agents()).filter((g) => isAssignable(g, row.departmentId)).map((g) => g.id);
        await notify(to, X.notify.message.replace(/\{\{name\}\}/g, row.subject), `${await tag(row.number)} · ${row.subject}`, ticketHref(row.id)); did.push(`notified ${X.notify.to}`);
      }
      await event(row.id, actorId, `Automation “${a.name}” ran`);
      await db.update(schema.automations).set({ runCount: sql`${schema.automations.runCount} + 1` }).where(eq(schema.automations.id, a.id));
      if (dedupeKey) await db.update(schema.automationRuns).set({ summary: did.join(', ') || 'no changes' }).where(and(eq(schema.automationRuns.automationId, a.id), eq(schema.automationRuns.recordId, row.id), eq(schema.automationRuns.dedupeKey, dedupeKey)));
      else await db.insert(schema.automationRuns).values({ automationId: a.id, recordType: 'ticket', recordId: row.id, summary: did.join(', ') || 'no changes' });
    } catch (e) { log.error('ticket_automation_failed', { automation: a.name, error: String(e) }); }
  }
  return row;
}

/* ---------------- SLA sweep (every few minutes) ---------------- */
export async function slaSweep(now = new Date()) {
  const open = await db.select().from(schema.tickets).where(and(ne(schema.tickets.statusCategory, 'closed'), eq(schema.tickets.isSpam, false), isNull(schema.tickets.mergedIntoId)));
  const policies = await db.select().from(schema.slaPolicies); const users = await db.select({ id: schema.users.id, managerId: schema.users.managerId }).from(schema.users);
  const ag = await agents(); let warned = 0, breached = 0;
  for (const t of open) {
    if (t.statusCategory === 'onhold') continue;
    const p = policies.find((x) => x.id === t.slaPolicyId); const T = await tag(t.number);
    const escalate = async (what: string) => {
      const mgr = t.assigneeId ? users.find((u) => u.id === t.assigneeId)?.managerId : null;
      const deptAdmins = ag.filter((a) => a.active && a.deskRole === 'admin').map((a) => a.id);
      const to = [t.assigneeId, ...(p?.escalateTo !== 'department' ? [mgr] : []), ...(p?.escalateTo !== 'manager' ? deptAdmins : [])];
      await notify(to, `SLA breached: ${what} on ${T}`, t.subject, ticketHref(t.id));
    };
    if (t.firstResponseDueAt && !t.firstRespondedAt && !t.frBreachedAt && +t.firstResponseDueAt < +now) {
      await db.update(schema.tickets).set({ frBreachedAt: now, escalated: true }).where(eq(schema.tickets.id, t.id)); await event(t.id, null, 'First response SLA breached — escalated'); await escalate('first response'); breached++;
    }
    if (t.dueAt && !t.breachedAt && +t.dueAt < +now) {
      await db.update(schema.tickets).set({ breachedAt: now, escalated: true }).where(eq(schema.tickets.id, t.id)); await event(t.id, null, 'Resolution SLA breached — escalated'); await escalate('resolution'); breached++;
    } else if (t.dueAt && !t.slaWarnedAt && !t.breachedAt && slaProgress(t.createdAt, t.dueAt, now) * 100 >= (p?.warnPct ?? 80)) {
      await db.update(schema.tickets).set({ slaWarnedAt: now }).where(eq(schema.tickets.id, t.id));
      await notify([t.assigneeId], `${T} is close to its SLA`, `Due ${t.dueAt.toLocaleString('en-GB', { timeZone: TZ(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${t.subject}`, ticketHref(t.id)); warned++;
    }
  }
  const { escalationSweep } = await import('./escalation'); const escalated = await escalationSweep(now).catch((e) => { log.error('escalation_failed', { error: String(e) }); return 0; });
  return { warned, breached, escalated };
}
/** Resolved tickets close themselves after N days; idle-ticket rules run once per quiet spell. */
export async function deskHousekeeping(now = new Date()) {
  const s = await getSettings(); const all = await statuses(); const closed = all.find((x) => x.category === 'closed' && /^closed/i.test(x.name));
  let autoClosed = 0;
  if (closed && s.autoCloseDays > 0) {
    const old = await db.select().from(schema.tickets).where(and(eq(schema.tickets.statusCategory, 'closed'), ne(schema.tickets.statusId, closed.id), lt(schema.tickets.resolvedAt, new Date(+now - s.autoCloseDays * 86_400_000))));
    for (const t of old) { await setStatusInternal(t, closed.id, null); autoClosed++; }
  }
  const idleRules = (await db.select().from(schema.automations).where(eq(schema.automations.active, true))).filter((a) => a.trigger.event === 'ticket.idle');
  for (const a of idleRules) {
    const days = a.trigger.days || 3;
    const idle = await db.select().from(schema.tickets).where(and(ne(schema.tickets.statusCategory, 'closed'), lt(schema.tickets.updatedAt, new Date(+now - days * 86_400_000))));
    for (const t of idle) await runTicketAutomations('ticket.idle', t, null, 0, a, `idle:${t.updatedAt.toISOString().slice(0, 10)}`);
  }
  return { autoClosed };
}
