'use server';
import { revalidatePath } from 'next/cache';
import { SignJWT } from 'jose';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ticket } from '@/db/schema';
import { authSecret, requireUser, type SessionUser } from './auth';
import { agents, canAssign, canManageDesk, canSeeTicket, canWorkTicket, deskCtx, isAssignable, type DeskCtx } from './desk-access';
import { assignInternal, autoAssign, createTicketInternal, event, followers, setPriorityInternal, setStatusInternal, statuses, tag, ticketHref } from './desk';
import { sendTicketMail } from './desk-mail';
import { notify } from './notify';
import { audit } from './audit';
import { log } from './log';
import { seal } from './crypto-box';
import { getSettings, saveSettings, type OrgSettings } from './settings';
import { mailEnabled, sendMail } from './mailer';
import { fullName, tagsOf, todayISO } from './utils';
import { PRIORITIES, TICKET_CHANNELS } from './options';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const done = <T extends object>(x?: T) => { revalidatePath('/', 'layout'); return { ok: true as const, ...(x || ({} as T)) }; };
class UserError extends Error {}
const clean = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : v; return s === '' || s === undefined ? null : s; };

/** Every helpdesk action: signed in, has a desk role, and gets the permission context. */
async function deskGuard<T extends object>(fn: (me: SessionUser, c: DeskCtx) => Promise<Result<T>>): Promise<Result<T>> {
  let uid: string | undefined;
  try {
    const me = await requireUser(); uid = me.id;
    if (me.deskRole === 'none') return fail('You don’t have access to the helpdesk.');
    return await fn(me, await deskCtx(me));
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    if (e instanceof UserError || /^(Only |You |This |That |Set up |Choose |Give )/.test((e as Error).message)) return fail((e as Error).message);
    log.error('desk_action_failed', { user: uid, error: String(e), stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
    return fail('Something went wrong. The error has been logged; try again or tell your admin.');
  }
}
async function ticketFor(c: DeskCtx, id: string, need: 'see' | 'work'): Promise<Ticket> {
  const t = /^[0-9a-f-]{36}$/.test(id) ? await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) }) : undefined;
  if (!t || !canSeeTicket(c, t)) throw new UserError('This ticket doesn’t exist or you can’t open it.');
  if (need === 'work' && !canWorkTicket(c, t)) throw new UserError(c.role === 'light' ? 'Light agents can read tickets and add private notes only.' : 'You can’t change this ticket.');
  return t;
}
async function agentFor(id: string | null) { if (!id) return null; return (await agents()).find((a) => a.id === id) || null; }
const adminOnly = (c: DeskCtx) => { if (!canManageDesk(c)) throw new UserError('Only helpdesk admins can change this.'); };

/* ======================= tickets ======================= */
export type TicketInput = { subject?: string; description?: string; departmentId?: string; priority?: string; type?: string; category?: string; channel?: string; contactId?: string; companyId?: string;
  requesterName?: string; requesterEmail?: string; requesterPhone?: string; productId?: string; assigneeId?: string; teamId?: string; tags?: string | string[]; custom?: Record<string, unknown>; dealId?: string; parentId?: string };
export async function createTicket(input: TicketInput) {
  return deskGuard<{ id: string }>(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t create tickets.');
    const subject = String(input.subject || '').trim(); if (!subject) return fail('Give the ticket a subject.');
    if (input.requesterEmail && !/^\S+@\S+\.\S+$/.test(input.requesterEmail)) return fail('That email address looks incomplete.');
    const dept = input.departmentId || c.deptIds[0];
    if (!dept) return fail('You aren’t in any department yet. Ask an admin to add you.');
    if (c.role !== 'admin' && c.scope !== 'all' && !c.deptIds.includes(dept)) return fail('You can only create tickets in your own departments.');
    if (input.priority && !PRIORITIES.includes(input.priority)) return fail('Choose a valid priority.');
    if (input.dealId && !me.crmAccess) input.dealId = undefined;
    const target = await agentFor(clean(input.assigneeId) as string | null);
    if (target && !canAssign(c, { departmentId: dept, teamId: clean(input.teamId) as string | null, assigneeId: null }, target)) return fail('You can’t assign tickets to that person.');
    const t = await createTicketInternal({ subject, description: input.description, departmentId: dept, priority: input.priority, type: clean(input.type) as string | null, category: clean(input.category) as string | null,
      channel: TICKET_CHANNELS.includes(input.channel || '') ? input.channel! : 'phone', contactId: clean(input.contactId) as string | null, companyId: clean(input.companyId) as string | null,
      requesterName: clean(input.requesterName) as string | null, requesterEmail: clean(input.requesterEmail) as string | null, requesterPhone: clean(input.requesterPhone) as string | null,
      productId: clean(input.productId) as string | null, assigneeId: target?.id || null, teamId: clean(input.teamId) as string | null, tags: tagsOf(input.tags), custom: input.custom, dealId: clean(input.dealId) as string | null,
      parentId: clean(input.parentId) as string | null, createdBy: me.id, firstMessage: input.description?.trim() ? { kind: 'incoming', body: input.description, fromName: clean(input.requesterName) as string | null, fromEmail: clean(input.requesterEmail) as string | null } : null });
    return done({ id: t.id });
  });
}
export type TicketPatch = { subject?: string; statusId?: string; priority?: string; type?: string | null; category?: string | null; departmentId?: string; teamId?: string | null; assigneeId?: string | null;
  productId?: string | null; contactId?: string | null; companyId?: string | null; dealId?: string | null; tags?: string | string[]; custom?: Record<string, unknown>; dueAt?: string | null };
async function applyPatch(me: SessionUser, c: DeskCtx, t0: Ticket, p: TicketPatch) {
  let t = t0; const set: Partial<Ticket> = {}; const changes: string[] = [];
  if (p.subject !== undefined) { const s = p.subject.trim(); if (!s) throw new UserError('Give the ticket a subject.'); if (s !== t.subject) { set.subject = s.slice(0, 250); changes.push('subject'); } }
  if (p.type !== undefined && p.type !== t.type) { set.type = p.type || null; changes.push(`type → ${p.type || 'none'}`); }
  if (p.category !== undefined && p.category !== t.category) { set.category = p.category || null; changes.push(`category → ${p.category || 'none'}`); }
  if (p.productId !== undefined && p.productId !== t.productId) { set.productId = p.productId || null; changes.push('product'); }
  if (p.contactId !== undefined && p.contactId !== t.contactId) {
    set.contactId = p.contactId || null; changes.push('contact');
    const ct = p.contactId ? await db.query.contacts.findFirst({ where: eq(schema.contacts.id, p.contactId) }) : null;
    if (ct) { set.requesterEmail = ct.email; set.requesterName = fullName(ct); if (p.companyId === undefined) set.companyId = ct.companyId; }
  }
  if (p.companyId !== undefined && p.companyId !== t.companyId) { set.companyId = p.companyId || null; changes.push('company'); }
  if (p.dealId !== undefined && p.dealId !== t.dealId) { if (!me.crmAccess) throw new UserError('You need CRM access to link deals.'); set.dealId = p.dealId || null; changes.push('deal'); }
  if (p.tags !== undefined) { set.tags = tagsOf(p.tags); }
  if (p.custom !== undefined) { set.custom = { ...t.custom, ...p.custom }; }
  if (p.dueAt !== undefined) { set.dueAt = p.dueAt ? new Date(p.dueAt) : null; set.breachedAt = null; set.slaWarnedAt = null; changes.push(p.dueAt ? `due date → ${p.dueAt.slice(0, 16).replace('T', ' ')}` : 'due date cleared'); }
  if (p.departmentId && p.departmentId !== t.departmentId) {
    const dep = await db.query.departments.findFirst({ where: eq(schema.departments.id, p.departmentId) }); if (!dep) throw new UserError('That department no longer exists.');
    if (c.role !== 'admin' && c.scope !== 'all' && !c.deptIds.includes(p.departmentId)) {
      // Agents may hand a ticket to another department, but then they may lose sight of it.
    }
    set.departmentId = dep.id; set.teamId = null; changes.push(`moved to ${dep.name}`);
    const asg = await agentFor(t.assigneeId); if (asg && !isAssignable(asg, dep.id)) set.assigneeId = null;
  }
  if (p.teamId !== undefined && p.teamId !== t.teamId) {
    if (p.teamId) { const tm = await db.query.teams.findFirst({ where: eq(schema.teams.id, p.teamId) }); if (!tm || tm.departmentId !== (set.departmentId || t.departmentId)) throw new UserError('That team belongs to another department.'); }
    set.teamId = p.teamId || null; changes.push('team');
  }
  if (Object.keys(set).length) { t = (await db.update(schema.tickets).set({ ...set, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id)).returning())[0]; if (changes.length) await event(t.id, me.id, `Changed ${changes.join(', ')}`); }
  if (p.priority && p.priority !== t.priority) { if (!PRIORITIES.includes(p.priority)) throw new UserError('Choose a valid priority.'); t = await setPriorityInternal(t, p.priority, me.id); }
  if (p.assigneeId !== undefined && p.assigneeId !== t.assigneeId) {
    const a = await agentFor(p.assigneeId);
    if (p.assigneeId && !a) throw new UserError('That person isn’t a helpdesk agent.');
    if (!canAssign(c, t, a)) throw new UserError(a ? `You can’t assign this ticket to ${a.name}. They must be an active agent in this ticket’s department, and your access level must allow it.` : 'You can’t unassign this ticket.');
    t = await assignInternal(t, p.assigneeId, me.id);
  }
  if (p.statusId && p.statusId !== t.statusId) t = await setStatusInternal(t, p.statusId, me.id);
  return t;
}
export async function updateTicket(id: string, patch: TicketPatch) {
  return deskGuard(async (me, c) => { await applyPatch(me, c, await ticketFor(c, id, 'work'), patch); return done(); });
}
export type TicketBulkResult = { ok: true; updated: number; skipped: number };
export async function bulkUpdateTickets(ids: string[], patch: TicketPatch & { spam?: boolean }) {
  return deskGuard<{ updated: number; skipped: number }>(async (me, c) => {
    if (!me.perms.bulkEdit) return fail('Your role doesn’t allow bulk changes. Ask an admin.');
    let updated = 0, skipped = 0;
    for (const id of ids.slice(0, 500)) {
      try {
        const t = await ticketFor(c, id, 'work');
        if (patch.spam !== undefined) { await db.update(schema.tickets).set({ isSpam: patch.spam }).where(eq(schema.tickets.id, t.id)); await event(t.id, me.id, patch.spam ? 'Marked as spam' : 'Not spam'); }
        await applyPatch(me, c, t, { ...patch, spam: undefined } as TicketPatch); updated++;
      } catch { skipped++; }
    }
    return done({ updated, skipped });
  });
}
export async function takeTicket(id: string) {
  return deskGuard(async (me, c) => {
    const t = await ticketFor(c, id, 'work'); const a = await agentFor(me.id);
    if (!a || !isAssignable(a, t.departmentId)) return fail('You aren’t an agent in this ticket’s department.');
    await assignInternal(t, me.id, me.id); return done();
  });
}

/** Reply to the customer (email/portal) or add a private note. @Name in a note notifies that agent. */
export async function replyTicket(id: string, input: { kind: 'reply' | 'note'; body: string; cc?: string; statusId?: string; attachmentIds?: string[]; toLinked?: boolean }) {
  return deskGuard<{ delivery: string | null; notSeen: string[]; linked: number }>(async (me, c) => {
    const body = (input.body || '').trim(); const notSeen: string[] = []; if (!body && !input.attachmentIds?.length) return fail('Write something first.');
    let t = await ticketFor(c, id, input.kind === 'note' ? 'see' : 'work');
    // Only files already uploaded to this ticket can be sent with it.
    const fileIds = input.attachmentIds?.length ? (await db.select({ id: schema.attachments.id }).from(schema.attachments).where(and(inArray(schema.attachments.id, input.attachmentIds.slice(0, 10)), eq(schema.attachments.relatedType, 'ticket'), eq(schema.attachments.relatedId, t.id)))).map((x) => x.id) : [];
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, me.id), columns: { name: true, signature: true } });
    let delivery: string | null = null; let messageId: string | null = null;
    const text = body || 'Please see the attached file(s).';
    if (input.kind === 'reply') {
      const r = await sendTicketMail(t, { kind: 'reply', body: text, cc: clean(input.cc) as string | null, authorName: user?.name, signature: user?.signature, attachmentIds: fileIds });
      delivery = r.delivery; messageId = r.messageId;
    }
    await db.insert(schema.ticketThreads).values({ ticketId: t.id, kind: input.kind, authorId: me.id, fromName: me.name, to: input.kind === 'reply' ? t.requesterEmail || t.requesterPhone : null, cc: clean(input.cc) as string | null, body: text, messageId, channel: input.kind === 'reply' ? (t.channel === 'portal' ? 'portal' : t.channel === 'whatsapp' ? 'whatsapp' : 'email') : null, delivery, attachmentIds: fileIds });
    // Major incident: the same public reply goes to every linked ticket.
    let linked = 0;
    if (input.kind === 'reply' && input.toLinked && t.isIncident) {
      const kids = await db.select().from(schema.tickets).where(and(eq(schema.tickets.incidentId, t.id), ne(schema.tickets.statusCategory, 'closed')));
      for (const k of kids) {
        const r = await sendTicketMail(k, { kind: 'reply', body: text, authorName: user?.name, signature: user?.signature });
        await db.insert(schema.ticketThreads).values({ ticketId: k.id, kind: 'reply', authorId: me.id, fromName: me.name, to: k.requesterEmail || k.requesterPhone, body: text, messageId: r.messageId, channel: k.channel === 'whatsapp' ? 'whatsapp' : 'email', delivery: r.delivery });
        await db.update(schema.tickets).set({ firstRespondedAt: k.firstRespondedAt ?? new Date(), lastAgentReplyAt: new Date(), updatedAt: new Date() }).where(eq(schema.tickets.id, k.id));
        await event(k.id, me.id, `Update sent from major incident ${await tag(t.number)}`); linked++;
      }
    }
    if (input.kind === 'reply') {
      const now = new Date();
      t = (await db.update(schema.tickets).set({ firstRespondedAt: t.firstRespondedAt ?? now, lastAgentReplyAt: now, updatedAt: now }).where(eq(schema.tickets.id, t.id)).returning())[0];
      // Replying to an unassigned ticket takes ownership of it.
      if (!t.assigneeId) { const a = await agentFor(me.id); if (a && isAssignable(a, t.departmentId)) t = await assignInternal(t, me.id, me.id); }
      if (t.contactId) await db.update(schema.contacts).set({ lastContactedAt: now }).where(eq(schema.contacts.id, t.contactId));
      await notify((await followers(t, me.id)).filter((x) => x !== me.id), `${me.name} replied on ${await tag(t.number)}`, t.subject, ticketHref(t.id));
    } else {
      const mentioned = await mentionedUsers(body);
      for (const u of mentioned) { const ctxU = await deskCtx({ id: u.id, deskRole: u.deskRole, ticketScope: u.ticketScope } as SessionUser); if (u.id === me.id) continue; if (canSeeTicket(ctxU, t)) await notify([u.id], `${me.name} mentioned you on ${await tag(t.number)}`, body.slice(0, 120), ticketHref(t.id)); else notSeen.push(u.name); }
      await notify((await followers(t, me.id)).filter((x) => !mentioned.some((m) => m.id === x)), `${me.name} added a note on ${await tag(t.number)}`, body.slice(0, 120), ticketHref(t.id));
    }
    if (input.statusId && canWorkTicket(c, t)) {
      await setStatusInternal(t, input.statusId, me.id);
      if (input.toLinked && t.isIncident) for (const k of await db.select().from(schema.tickets).where(and(eq(schema.tickets.incidentId, t.id), ne(schema.tickets.statusCategory, 'closed')))) await setStatusInternal(k, input.statusId, me.id);
    }
    return done({ delivery, notSeen, linked });
  });
}
async function mentionedUsers(body: string) {
  if (!body.includes('@')) return [];
  const us = await db.select({ id: schema.users.id, name: schema.users.name, active: schema.users.active, deskRole: schema.users.deskRole, ticketScope: schema.users.ticketScope, role: schema.users.role }).from(schema.users);
  return us.filter((u) => u.active && body.toLowerCase().includes('@' + u.name.toLowerCase())).map((u) => ({ ...u, deskRole: u.role === 'admin' ? 'admin' as const : u.deskRole }));
}

export async function mergeTickets(targetId: string, sourceIds: string[]) {
  return deskGuard(async (me, c) => {
    if (!me.perms.mergeTickets) return fail('Your role doesn’t allow merging tickets. Ask an admin.');
    const target = await ticketFor(c, targetId, 'work'); const sources: Ticket[] = [];
    for (const id of sourceIds.filter((x) => x !== targetId)) sources.push(await ticketFor(c, id, 'work'));
    if (!sources.length) return fail('Pick at least one other ticket to merge.');
    const closed = (await statuses()).find((s) => /^closed/i.test(s.name)) || (await statuses()).find((s) => s.category === 'closed');
    for (const s of sources) {
      await db.update(schema.ticketThreads).set({ ticketId: target.id }).where(eq(schema.ticketThreads.ticketId, s.id));
      await db.update(schema.ticketTime).set({ ticketId: target.id }).where(eq(schema.ticketTime.ticketId, s.id));
      await db.update(schema.attachments).set({ relatedId: target.id }).where(and(eq(schema.attachments.relatedType, 'ticket'), eq(schema.attachments.relatedId, s.id)));
      await db.update(schema.tickets).set({ mergedIntoId: target.id, statusId: closed!.id, statusCategory: 'closed', closedAt: new Date(), resolvedAt: new Date() }).where(eq(schema.tickets.id, s.id));
      await event(s.id, me.id, `Merged into ${await tag(target.number)}`); await event(target.id, me.id, `Merged ${await tag(s.number)} into this ticket`);
    }
    await db.update(schema.tickets).set({ tags: Array.from(new Set([target.tags, ...sources.map((s) => s.tags)].flat())), updatedAt: new Date() }).where(eq(schema.tickets.id, target.id));
    return done();
  });
}
/** Turn one message into its own ticket (when a customer raises a second issue in the same thread). */
export async function splitTicket(threadId: string) {
  return deskGuard<{ id: string }>(async (me, c) => {
    const th = await db.query.ticketThreads.findFirst({ where: eq(schema.ticketThreads.id, threadId) }); if (!th) return fail('That message no longer exists.');
    const t = await ticketFor(c, th.ticketId, 'work');
    const n = await createTicketInternal({ subject: `${t.subject} (split)`, description: th.body, departmentId: t.departmentId, priority: t.priority, channel: t.channel, contactId: t.contactId, companyId: t.companyId, requesterEmail: t.requesterEmail, requesterName: t.requesterName,
      createdBy: me.id, firstMessage: { kind: th.kind === 'note' ? 'note' : 'incoming', body: th.body, fromName: th.fromName, fromEmail: th.fromEmail } });
    await event(t.id, me.id, `Split a message into ${await tag(n.number)}`); await event(n.id, me.id, `Split from ${await tag(t.number)}`);
    return done({ id: n.id });
  });
}
export async function cloneTicket(id: string, asChild = false) {
  return deskGuard<{ id: string }>(async (me, c) => {
    const t = await ticketFor(c, id, 'work');
    const n = await createTicketInternal({ subject: asChild ? `Follow-up: ${t.subject}` : `${t.subject} (copy)`, description: t.description, departmentId: t.departmentId, priority: t.priority, type: t.type, category: t.category, channel: 'internal',
      contactId: t.contactId, companyId: t.companyId, requesterEmail: t.requesterEmail, requesterName: t.requesterName, productId: t.productId, tags: t.tags, custom: t.custom, parentId: asChild ? t.id : null, createdBy: me.id,
      firstMessage: t.description ? { kind: 'note', body: t.description } : null });
    await event(t.id, me.id, `${asChild ? 'Child ticket' : 'Copy'} ${await tag(n.number)} created`);
    return done({ id: n.id });
  });
}
export async function toggleWatch(id: string) {
  return deskGuard<{ on: boolean }>(async (me, c) => {
    await ticketFor(c, id, 'see'); const w = and(eq(schema.ticketWatchers.ticketId, id), eq(schema.ticketWatchers.userId, me.id));
    if ((await db.select().from(schema.ticketWatchers).where(w)).length) { await db.delete(schema.ticketWatchers).where(w); return done({ on: false }); }
    await db.insert(schema.ticketWatchers).values({ ticketId: id, userId: me.id }).onConflictDoNothing(); return done({ on: true });
  });
}
export async function logTime(id: string, minutes: number, note?: string, billable?: boolean, date?: string) {
  return deskGuard(async (me, c) => {
    await ticketFor(c, id, 'work'); const m = Math.round(+minutes);
    if (!(m > 0 && m <= 24 * 60)) return fail('Enter between 1 minute and 24 hours.');
    await db.insert(schema.ticketTime).values({ ticketId: id, userId: me.id, minutes: m, note: clean(note) as string | null, billable: !!billable, date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO() });
    await event(id, me.id, `Logged ${m} min${billable ? ' (billable)' : ''}`); return done();
  });
}
export async function deleteTime(entryId: string) {
  return deskGuard(async (me, c) => {
    const e = await db.query.ticketTime.findFirst({ where: eq(schema.ticketTime.id, entryId) }); if (!e) return done();
    await ticketFor(c, e.ticketId, 'work'); if (e.userId !== me.id && c.role !== 'admin') return fail('You can only remove your own time entries.');
    await db.delete(schema.ticketTime).where(eq(schema.ticketTime.id, entryId)); return done();
  });
}
/** Helpdesk admins only. Deleted tickets go to the recycle bin for 30 days. */
export async function deleteTickets(ids: string[]) {
  return deskGuard(async (me, c) => {
    adminOnly(c); if (!me.perms.deleteTickets) return fail('Your role doesn’t allow deleting tickets. Ask an admin.');
    for (const id of ids) {
      const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) }); if (!t) continue;
      const [threads, events, time, files] = await Promise.all([db.select().from(schema.ticketThreads).where(eq(schema.ticketThreads.ticketId, id)), db.select().from(schema.ticketEvents).where(eq(schema.ticketEvents.ticketId, id)),
        db.select().from(schema.ticketTime).where(eq(schema.ticketTime.ticketId, id)), db.select().from(schema.attachments).where(and(eq(schema.attachments.relatedType, 'ticket'), eq(schema.attachments.relatedId, id)))]);
      await db.insert(schema.trash).values({ entity: 'ticket', recordId: id, label: `${await tag(t.number)} ${t.subject}`, data: { row: t, threads, events, time, files }, deletedBy: me.id });
      await db.delete(schema.attachments).where(and(eq(schema.attachments.relatedType, 'ticket'), eq(schema.attachments.relatedId, id)));
      await db.delete(schema.tickets).where(eq(schema.tickets.id, id));
    }
    await audit(me.id, 'ticket.deleted', 'ticket', ids.length === 1 ? ids[0] : null, `${ids.length} ticket(s)`);
    return done();
  });
}
export async function setAvailability(available: boolean) {
  return deskGuard(async (me) => { await db.update(schema.users).set({ deskAvailable: available }).where(eq(schema.users.id, me.id)); return done(); });
}
/** Ticket → sales opportunity in the CRM. */
export async function ticketToDeal(id: string) {
  return deskGuard<{ id: string }>(async (me, c) => {
    if (!me.crmAccess) return fail('You need CRM access to create deals.');
    const t = await ticketFor(c, id, 'work');
    const pipe = (await db.select().from(schema.pipelines).orderBy(asc(schema.pipelines.sortOrder)))[0]; if (!pipe) return fail('Set up a sales pipeline first.');
    const sub = (await db.select().from(schema.subPipelines).where(eq(schema.subPipelines.pipelineId, pipe.id)).orderBy(asc(schema.subPipelines.sortOrder)))[0];
    const st = (await db.select().from(schema.stages).where(and(eq(schema.stages.subPipelineId, sub.id), eq(schema.stages.type, 'open'))).orderBy(asc(schema.stages.sortOrder)))[0];
    const [d] = await db.insert(schema.deals).values({ name: t.subject, pipelineId: pipe.id, subPipelineId: sub.id, stageId: st.id, companyId: t.companyId, contactId: t.contactId, ownerId: me.id, leadSource: 'Support', description: `From ticket ${await tag(t.number)}` }).returning();
    await db.insert(schema.dealEvents).values([{ dealId: d.id, kind: 'created', text: `Created from ticket ${await tag(t.number)}`, userId: me.id }, { dealId: d.id, kind: 'stage', stageId: st.id, userId: me.id }]);
    await db.update(schema.tickets).set({ dealId: d.id }).where(eq(schema.tickets.id, t.id)); await event(t.id, me.id, 'Sales opportunity created');
    return done({ id: d.id });
  });
}
/** Gives a contact access to the customer portal: a set-password link (emailed when email is set up). */
export async function invitePortal(contactId: string, companyAccess = false) {
  return deskGuard<{ link: string; emailed: boolean }>(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t invite portal users.');
    const ct = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) }); if (!ct) return fail('This contact no longer exists.');
    if (!ct.email) return fail('Add an email address to the contact first.');
    await db.update(schema.contacts).set({ portalEnabled: true, portalCompanyAccess: companyAccess }).where(eq(schema.contacts.id, ct.id));
    const token = await new SignJWT({ sub: ct.id, v: ct.portalVersion, p: 'portal-invite' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(authSecret());
    const link = `${(process.env.APP_URL || '').replace(/\/$/, '')}/portal/set-password?token=${token}`;
    const s = await getSettings(); let emailed = false;
    if (mailEnabled()) emailed = await sendMail(ct.email, `Your ${s.portalTitle} account`, `Hello ${ct.firstName},\n\nYou can now follow your support requests online. Choose a password here (valid 7 days):\n${link}\n\n${s.orgName}`);
    await audit(me.id, 'portal.invited', 'contact', ct.id, ct.email);
    return done({ link, emailed });
  });
}
export async function revokePortal(contactId: string) {
  return deskGuard(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t change portal access.');
    await db.update(schema.contacts).set({ portalEnabled: false, portalVersion: sql`${schema.contacts.portalVersion} + 1` }).where(eq(schema.contacts.id, contactId));
    await audit(me.id, 'portal.revoked', 'contact', contactId); return done();
  });
}

/* ======================= canned responses & knowledge base ======================= */
export async function saveCanned(input: { id?: string; name: string; body: string; departmentId?: string | null; shared: boolean }) {
  return deskGuard(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t create canned responses.');
    if (!input.name.trim() || !input.body.trim()) return fail('Give it a name and some text.');
    if (input.shared && c.role !== 'admin') return fail('Only helpdesk admins can share responses with everyone.');
    const v = { name: input.name.trim(), body: input.body, departmentId: input.departmentId || null, ownerId: input.shared ? null : me.id };
    if (input.id) {
      const ex = await db.query.cannedResponses.findFirst({ where: eq(schema.cannedResponses.id, input.id) });
      if (!ex || (ex.ownerId ? ex.ownerId !== me.id : c.role !== 'admin')) return fail('You can only edit your own responses.');
      await db.update(schema.cannedResponses).set(v).where(eq(schema.cannedResponses.id, input.id));
    } else await db.insert(schema.cannedResponses).values(v);
    return done();
  });
}
export async function deleteCanned(id: string) {
  return deskGuard(async (me, c) => {
    const ex = await db.query.cannedResponses.findFirst({ where: eq(schema.cannedResponses.id, id) }); if (!ex) return done();
    if (ex.ownerId ? ex.ownerId !== me.id : c.role !== 'admin') return fail('You can only delete your own responses.');
    await db.delete(schema.cannedResponses).where(eq(schema.cannedResponses.id, id)); return done();
  });
}
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'article';
export async function saveArticle(input: { id?: string; title: string; body: string; categoryId?: string | null; status: 'draft' | 'published'; visibility: 'public' | 'internal'; tags?: string }) {
  return deskGuard<{ id: string }>(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t write articles.');
    if (!input.title.trim() || !input.body.trim()) return fail('Give the article a title and some content.');
    if (input.status === 'published' && c.role !== 'admin') return fail('Only helpdesk admins can publish. Save it as a draft for review.');
    const v = { title: input.title.trim(), body: input.body, categoryId: input.categoryId || null, status: input.status, visibility: input.visibility, tags: tagsOf(input.tags), updatedAt: new Date() };
    if (input.id) {
      const ex = await db.query.kbArticles.findFirst({ where: eq(schema.kbArticles.id, input.id) }); if (!ex) return fail('This article no longer exists.');
      if (ex.status === 'published' && c.role !== 'admin') return fail('Only helpdesk admins can edit published articles.');
      await db.update(schema.kbArticles).set(v).where(eq(schema.kbArticles.id, input.id)); return done({ id: input.id });
    }
    let slug = slugify(input.title); for (let i = 2; (await db.select({ id: schema.kbArticles.id }).from(schema.kbArticles).where(eq(schema.kbArticles.slug, slug))).length; i++) slug = `${slugify(input.title)}-${i}`;
    const [a] = await db.insert(schema.kbArticles).values({ ...v, slug, authorId: me.id }).returning();
    return done({ id: a.id });
  });
}
export async function deleteArticle(id: string) { return deskGuard(async (_me, c) => { adminOnly(c); await db.delete(schema.kbArticles).where(eq(schema.kbArticles.id, id)); return done(); }); }
export async function saveKbCategory(input: { id?: string; name: string; description?: string }) {
  return deskGuard(async (_me, c) => {
    adminOnly(c); if (!input.name.trim()) return fail('Name the category.');
    if (input.id) await db.update(schema.kbCategories).set({ name: input.name.trim(), description: input.description || null }).where(eq(schema.kbCategories.id, input.id));
    else await db.insert(schema.kbCategories).values({ name: input.name.trim(), description: input.description || null, sortOrder: Date.now() % 1e9 });
    return done();
  });
}
export async function deleteKbCategory(id: string) { return deskGuard(async (_me, c) => { adminOnly(c); await db.delete(schema.kbCategories).where(eq(schema.kbCategories.id, id)); return done(); }); }

/* ======================= helpdesk setup (admins) ======================= */
export async function saveDepartment(input: { id?: string; name: string; email?: string; active?: boolean; assignMode?: 'manual' | 'round_robin' | 'load'; autoAck?: boolean; signature?: string;
  imap?: { host: string; port: number; secure: boolean; user: string; password?: string; folder?: string } | null; memberIds?: string[] }) {
  return deskGuard<{ id: string }>(async (me, c) => {
    adminOnly(c); if (!input.name.trim()) return fail('Name the department.');
    if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) return fail('That support address looks incomplete.');
    const prev = input.id ? await db.query.departments.findFirst({ where: eq(schema.departments.id, input.id) }) : null;
    let imap = prev?.imap ?? null;
    if (input.imap === null) imap = null;
    else if (input.imap?.host) {
      if (!input.imap.user) return fail('Enter the mailbox username.');
      const pw = input.imap.password ? seal(input.imap.password) : prev?.imap?.passwordEnc; if (!pw) return fail('Enter the mailbox password.');
      imap = { host: input.imap.host.trim(), port: +input.imap.port || 993, secure: input.imap.secure !== false, user: input.imap.user.trim(), passwordEnc: pw, folder: input.imap.folder?.trim() || 'INBOX' };
    }
    const v = { name: input.name.trim(), email: (clean(input.email) as string | null)?.toLowerCase() || null, active: input.active !== false, assignMode: input.assignMode || 'manual', autoAck: input.autoAck !== false, signature: clean(input.signature) as string | null, imap };
    let id = input.id;
    if (id) await db.update(schema.departments).set(v).where(eq(schema.departments.id, id));
    else id = (await db.insert(schema.departments).values({ ...v, sortOrder: Date.now() % 1e9 }).returning())[0].id;
    if (input.memberIds) {
      const valid = (await agents()).filter((a) => a.deskRole !== 'none').map((a) => a.id);
      await db.delete(schema.departmentMembers).where(eq(schema.departmentMembers.departmentId, id));
      const ids = input.memberIds.filter((x) => valid.includes(x));
      if (ids.length) await db.insert(schema.departmentMembers).values(ids.map((userId) => ({ departmentId: id!, userId }))).onConflictDoNothing();
    }
    await audit(me.id, input.id ? 'department.updated' : 'department.created', 'department', id, v.name);
    return done({ id });
  });
}
export async function deleteDepartment(id: string) {
  return deskGuard(async (me, c) => {
    adminOnly(c);
    const n = Number((await db.select({ c: sql<number>`count(*)` }).from(schema.tickets).where(eq(schema.tickets.departmentId, id)))[0].c);
    if (n) return fail(`Move its ${n} tickets to another department first, or switch the department off instead.`);
    await db.delete(schema.departments).where(eq(schema.departments.id, id)); await audit(me.id, 'department.deleted', 'department', id); return done();
  });
}
export async function testMailbox(id: string) {
  return deskGuard<{ result: string }>(async (_me, c) => {
    adminOnly(c); const { pollMailboxes } = await import('./desk-mail'); const r = await pollMailboxes();
    const d = await db.query.departments.findFirst({ where: eq(schema.departments.id, id) });
    return done({ result: d?.imapStatus || JSON.stringify(r) });
  });
}
export async function saveTeam(input: { id?: string; departmentId: string; name: string; memberIds: string[]; leadId?: string | null }) {
  return deskGuard(async (_me, c) => {
    adminOnly(c); if (!input.name.trim()) return fail('Name the team.');
    let id = input.id; const leadId = input.leadId && /^[0-9a-f-]{36}$/.test(input.leadId) ? input.leadId : null;
    if (id) await db.update(schema.teams).set({ name: input.name.trim(), leadId }).where(eq(schema.teams.id, id));
    else id = (await db.insert(schema.teams).values({ departmentId: input.departmentId, name: input.name.trim(), leadId }).returning())[0].id;
    const deptMembers = (await db.select().from(schema.departmentMembers).where(eq(schema.departmentMembers.departmentId, input.departmentId))).map((m) => m.userId);
    await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, id));
    const ids = input.memberIds.filter((x) => deptMembers.includes(x));
    if (ids.length) await db.insert(schema.teamMembers).values(ids.map((userId) => ({ teamId: id!, userId }))).onConflictDoNothing();
    return done();
  });
}
export async function deleteTeam(id: string) { return deskGuard(async (_me, c) => { adminOnly(c); await db.update(schema.tickets).set({ teamId: null }).where(eq(schema.tickets.teamId, id)); await db.delete(schema.teams).where(eq(schema.teams.id, id)); return done(); }); }
export async function saveStatus(input: { id?: string; name: string; category: 'open' | 'onhold' | 'closed'; isDefault?: boolean }) {
  return deskGuard(async (_me, c) => {
    adminOnly(c); if (!input.name.trim()) return fail('Name the status.');
    if (input.isDefault) await db.update(schema.ticketStatuses).set({ isDefault: false }).where(eq(schema.ticketStatuses.category, input.category));
    if (input.id) { await db.update(schema.ticketStatuses).set({ name: input.name.trim(), category: input.category, isDefault: !!input.isDefault }).where(eq(schema.ticketStatuses.id, input.id)); await db.update(schema.tickets).set({ statusCategory: input.category }).where(eq(schema.tickets.statusId, input.id)); }
    else await db.insert(schema.ticketStatuses).values({ name: input.name.trim(), category: input.category, isDefault: !!input.isDefault, sortOrder: (await statuses()).length });
    return done();
  });
}
export async function deleteStatus(id: string) {
  return deskGuard(async (_me, c) => {
    adminOnly(c);
    const n = Number((await db.select({ c: sql<number>`count(*)` }).from(schema.tickets).where(eq(schema.tickets.statusId, id)))[0].c);
    if (n) return fail(`${n} tickets use this status. Move them first.`);
    const all = await statuses(); const st = all.find((s) => s.id === id);
    if (st && all.filter((s) => s.category === st.category).length < 2) return fail('Keep at least one status in each group (open, on hold, closed).');
    await db.delete(schema.ticketStatuses).where(eq(schema.ticketStatuses.id, id)); return done();
  });
}
export async function reorderStatuses(ids: string[]) { return deskGuard(async (_me, c) => { adminOnly(c); for (const [i, id] of ids.entries()) await db.update(schema.ticketStatuses).set({ sortOrder: i }).where(eq(schema.ticketStatuses.id, id)); return done(); }); }
export async function saveSlaPolicy(input: { id?: string; name: string; departmentId?: string | null; tier?: string | null; targets: Record<string, { first: number; resolve: number }>; businessHours: boolean; warnPct: number; escalateTo: 'manager' | 'department' | 'both'; active: boolean }) {
  return deskGuard(async (_me, c) => {
    adminOnly(c); if (!input.name.trim()) return fail('Name the policy.');
    for (const [p, t] of Object.entries(input.targets)) { if (!PRIORITIES.includes(p) || !(t.first >= 0) || !(t.resolve >= 0)) return fail('Enter targets in minutes for each priority.'); if (t.first && t.resolve && t.first > t.resolve) return fail(`${p}: first response can’t be later than resolution.`); }
    const v = { name: input.name.trim(), departmentId: input.departmentId || null, tier: input.tier || null, targets: input.targets, businessHours: input.businessHours, warnPct: Math.min(99, Math.max(1, +input.warnPct || 80)), escalateTo: input.escalateTo, active: input.active };
    if (input.id) await db.update(schema.slaPolicies).set(v).where(eq(schema.slaPolicies.id, input.id));
    else await db.insert(schema.slaPolicies).values({ ...v, sortOrder: (await db.select().from(schema.slaPolicies)).length });
    return done();
  });
}
export async function deleteSlaPolicy(id: string) { return deskGuard(async (_me, c) => { adminOnly(c); await db.delete(schema.slaPolicies).where(eq(schema.slaPolicies.id, id)); return done(); }); }
export async function reorderSla(ids: string[]) { return deskGuard(async (_me, c) => { adminOnly(c); for (const [i, id] of ids.entries()) await db.update(schema.slaPolicies).set({ sortOrder: i }).where(eq(schema.slaPolicies.id, id)); return done(); }); }
/** Re-run assignment rules on an unassigned ticket (button on the ticket). */
export async function autoAssignNow(id: string) {
  return deskGuard(async (_me, c) => { const t = await ticketFor(c, id, 'work'); if (t.assigneeId) return fail('Already assigned.'); const r = await autoAssign(t, 'load'); return r.assigneeId ? done() : fail('No available agent in this department right now.'); });
}
export async function myCannedAndArticles(departmentId?: string | null) {
  return deskGuard<{ canned: { id: string; name: string; body: string }[]; articles: { id: string; title: string; slug: string; visibility: string }[] }>(async (me) => {
    // The ticket's department's replies plus the ones meant for every department.
    const canned = (await db.select().from(schema.cannedResponses)).filter((x) => (!x.ownerId || x.ownerId === me.id) && (!departmentId || !x.departmentId || x.departmentId === departmentId)).map((x) => ({ id: x.id, name: x.name, body: x.body }));
    const articles = (await db.select({ id: schema.kbArticles.id, title: schema.kbArticles.title, slug: schema.kbArticles.slug, visibility: schema.kbArticles.visibility, status: schema.kbArticles.status }).from(schema.kbArticles)).filter((a) => a.status === 'published');
    return { ok: true, canned, articles };
  });
}


/* ---------- helpdesk settings (desk admins) ---------- */
type DeskSettings = Pick<OrgSettings, 'ticketPrefix' | 'ticketTypes' | 'ticketCategories' | 'businessHours' | 'csatEnabled' | 'portalEnabled' | 'webFormEnabled' | 'portalTitle' | 'portalWelcome' | 'autoCloseDays' | 'reopenOnReply'
  | 'handoffTicketToLead' | 'handoffKeywords' | 'aiTriage' | 'aiSentiment' | 'communityEnabled' | 'forumCategories' | 'statusComponents' | 'statusPageEnabled' | 'ticketLanguages' | 'contractTiers' | 'supportCostPerHour' | 'lowHoursPct'>;
export async function saveDeskSettings(patch: Partial<DeskSettings>) {
  return deskGuard(async (me, c) => {
    adminOnly(c);
    const allowed: (keyof DeskSettings)[] = ['ticketPrefix', 'ticketTypes', 'ticketCategories', 'businessHours', 'csatEnabled', 'portalEnabled', 'webFormEnabled', 'portalTitle', 'portalWelcome', 'autoCloseDays', 'reopenOnReply',
      'handoffTicketToLead', 'handoffKeywords', 'aiTriage', 'aiSentiment', 'communityEnabled', 'forumCategories', 'statusComponents', 'statusPageEnabled', 'ticketLanguages', 'contractTiers', 'supportCostPerHour', 'lowHoursPct'];
    if (patch.handoffKeywords != null) { try { new RegExp(patch.handoffKeywords); } catch { return fail('The handoff words aren’t valid. Separate words with |, e.g. renewal|upgrade|quote'); } }
    if (patch.supportCostPerHour != null && !(+patch.supportCostPerHour >= 0)) return fail('Enter the cost per support hour (0 or more).');
    const v: Partial<DeskSettings> = {}; for (const k of allowed) if (k in patch) (v as Record<string, unknown>)[k] = patch[k];
    if (v.ticketPrefix != null) { v.ticketPrefix = v.ticketPrefix.trim().toUpperCase(); if (!/^[A-Z]{1,6}$/.test(v.ticketPrefix)) return fail('Use 1–6 letters for the ticket prefix, e.g. RD.'); }
    if (v.autoCloseDays != null) v.autoCloseDays = Math.max(0, Math.min(90, Math.round(+v.autoCloseDays || 0)));
    if (v.businessHours) {
      const h = v.businessHours; const t = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!t.test(h.start) || !t.test(h.end) || h.start >= h.end) return fail('Business hours need a start time before the end time (e.g. 08:00 to 17:00).');
      if (!h.days.length) return fail('Pick at least one working day.');
      h.days = [...new Set(h.days.filter((d) => d >= 0 && d <= 6))].sort();
      h.holidays = [...new Set(h.holidays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    }
    for (const k of ['ticketTypes', 'ticketCategories', 'forumCategories', 'statusComponents', 'ticketLanguages', 'contractTiers'] as const) if (v[k]) v[k] = [...new Set(v[k]!.map((x) => x.trim()).filter(Boolean))].slice(0, 50);
    await saveSettings(v); await audit(me.id, 'settings.changed', 'settings', null, Object.keys(v).join(', '));
    revalidatePath('/', 'layout'); return done();
  });
}
/** Each agent's own email signature, added under their replies. */
export async function saveMySignature(signature: string) {
  return deskGuard(async (me) => { await db.update(schema.users).set({ signature: signature.trim().slice(0, 2000) || null }).where(eq(schema.users.id, me.id)); return done(); });
}
