'use server';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { AgentSkills, EscalationRule, StatusIncident } from '@/db/schema';
import { clean, deskAct, deskAdminOnly, done, fail, isUuid, ticketFor } from './action-kit';
import { audit } from './audit';
import { seal } from './crypto-box';
import { getIntegrations, getSettings, saveIntegrations, saveSettings } from './settings';
import { createTicketInternal, event, findOrCreateRequester, setStatusInternal, statuses, tag } from './desk';
import { tagsOf, todayISO } from './utils';
import { PRIORITIES, VENDOR_STATUSES } from './options';

/* ---------------- support contracts ---------------- */
export type ContractInput = { id?: string; companyId: string; name: string; tier: string; slaPolicyId?: string | null; hoursIncluded?: number | string | null; startDate: string; endDate: string;
  value?: number | string | null; currency?: string; productIds?: string[]; notes?: string };
export async function saveContract(input: ContractInput) {
  return deskAct<{ id: string }>(async (me, c) => {
    deskAdminOnly(c);
    if (!isUuid(input.companyId)) return fail('Choose the customer.');
    if (!input.name?.trim()) return fail('Name the contract, e.g. “Premium support 2027”.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate || '')) return fail('Enter the start and end dates.');
    if (input.endDate < input.startDate) return fail('The end date is before the start date.');
    const hours = input.hoursIncluded == null || input.hoursIncluded === '' ? null : +input.hoursIncluded; if (hours != null && !(hours >= 0)) return fail('Included hours must be 0 or more.');
    const v = { companyId: input.companyId, name: input.name.trim().slice(0, 160), tier: input.tier || 'Standard', slaPolicyId: isUuid(input.slaPolicyId) ? input.slaPolicyId : null, hoursIncluded: hours,
      startDate: input.startDate, endDate: input.endDate, value: input.value == null || input.value === '' ? null : +input.value, currency: input.currency || 'AED', productIds: (input.productIds || []).filter(isUuid), notes: clean(input.notes) as string | null };
    if (input.id) { await db.update(schema.supportContracts).set({ ...v, lowHoursWarnedAt: null }).where(eq(schema.supportContracts.id, input.id)); await audit(me.id, 'contract.updated', 'contract', input.id, v.name); return done({ id: input.id }); }
    const [row] = await db.insert(schema.supportContracts).values(v).returning(); await audit(me.id, 'contract.created', 'contract', row.id, v.name);
    // Open tickets of this customer pick the new contract up.
    const today = todayISO();
    if (v.startDate <= today && today <= v.endDate) await db.update(schema.tickets).set({ contractId: row.id }).where(and(eq(schema.tickets.companyId, v.companyId), ne(schema.tickets.statusCategory, 'closed'), sql`${schema.tickets.contractId} is null`));
    return done({ id: row.id });
  });
}
export async function deleteContract(id: string) {
  return deskAct(async (me, c) => {
    deskAdminOnly(c); await db.update(schema.tickets).set({ contractId: null }).where(eq(schema.tickets.contractId, id));
    await db.delete(schema.supportContracts).where(eq(schema.supportContracts.id, id)); await audit(me.id, 'contract.deleted', 'contract', id); return done();
  });
}

/* ---------------- vendor case ---------------- */
export async function setVendorCase(ticketId: string, input: { vendorName?: string; vendorCaseNo?: string; vendorStatus?: string | null }) {
  return deskAct(async (me, c) => {
    const t = await ticketFor(c, ticketId, 'work');
    const status = input.vendorStatus && (VENDOR_STATUSES as readonly string[]).includes(input.vendorStatus) ? input.vendorStatus : null;
    const vendorName = clean(input.vendorName) as string | null; const vendorCaseNo = clean(input.vendorCaseNo) as string | null;
    if (status && !vendorName) return fail('Enter the vendor’s name.');
    let row = (await db.update(schema.tickets).set({ vendorName, vendorCaseNo, vendorStatus: status, vendorOpenedAt: status && !t.vendorOpenedAt ? new Date() : status ? t.vendorOpenedAt : null, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id)).returning())[0];
    if (status !== t.vendorStatus || vendorCaseNo !== t.vendorCaseNo) await event(t.id, me.id, status ? `Vendor case ${vendorName}${vendorCaseNo ? ` #${vendorCaseNo}` : ''}: ${status}` : 'Vendor case removed');
    // Waiting on the vendor pauses the SLA (an on-hold status); their answer resumes it.
    const all = await statuses();
    if (status === 'Waiting on vendor' && row.statusCategory !== 'onhold') {
      const hold = all.find((s) => s.category === 'onhold' && /third|vendor/i.test(s.name)) || all.find((s) => s.category === 'onhold');
      if (hold) row = await setStatusInternal(row, hold.id, me.id);
    } else if ((status === 'Vendor responded' || status === 'Closed by vendor') && row.statusCategory === 'onhold') {
      const back = all.find((s) => s.category === 'open' && /progress/i.test(s.name)) || all.find((s) => s.category === 'open');
      if (back) await setStatusInternal(row, back.id, me.id);
    }
    return done();
  });
}

/* ---------------- escalation ladder ---------------- */
export async function saveEscalationRule(input: { id?: string; departmentId?: string | null; level: number; afterMinutes: number; target: EscalationRule['target']; userId?: string | null; reassign?: boolean; raisePriority?: boolean; active?: boolean }) {
  return deskAct(async (me, c) => {
    deskAdminOnly(c);
    const level = Math.round(+input.level); if (!(level >= 1 && level <= 5)) return fail('Choose a level between 1 and 5.');
    const after = Math.round(+input.afterMinutes); if (!(after >= 0)) return fail('Enter how many minutes after the due time.');
    if (!['team_lead', 'manager', 'desk_admins', 'user'].includes(input.target)) return fail('Choose who to escalate to.');
    if (input.target === 'user' && !isUuid(input.userId)) return fail('Choose the person to escalate to.');
    const v = { departmentId: isUuid(input.departmentId) ? input.departmentId : null, level, afterMinutes: after, target: input.target, userId: input.target === 'user' ? input.userId! : null, reassign: !!input.reassign && input.target !== 'desk_admins', raisePriority: !!input.raisePriority, active: input.active !== false };
    if (input.id) await db.update(schema.escalationRules).set(v).where(eq(schema.escalationRules.id, input.id)); else await db.insert(schema.escalationRules).values(v);
    await audit(me.id, 'settings.changed', 'settings', null, 'escalation ladder'); return done();
  });
}
export async function deleteEscalationRule(id: string) { return deskAct(async (_me, c) => { deskAdminOnly(c); await db.delete(schema.escalationRules).where(eq(schema.escalationRules.id, id)); return done(); }); }

/* ---------------- skills, shifts, leave ---------------- */
export async function saveAgentRouting(userId: string, input: { skills: AgentSkills; shift: { days: number[]; start: string; end: string } | null }) {
  return deskAct(async (me, c) => {
    if (userId !== me.id) deskAdminOnly(c);
    const t = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (input.shift && (!t.test(input.shift.start) || !t.test(input.shift.end) || !input.shift.days.length)) return fail('A shift needs working days and start/end times like 08:00.');
    const s = { products: (input.skills.products || []).filter(isUuid), vendors: (input.skills.vendors || []).map((x) => x.trim()).filter(Boolean).slice(0, 30), languages: (input.skills.languages || []).map((x) => x.trim()).filter(Boolean).slice(0, 20) };
    await db.update(schema.users).set({ skills: s, shift: input.shift ? { days: [...new Set(input.shift.days)].sort(), start: input.shift.start, end: input.shift.end } : null }).where(eq(schema.users.id, userId));
    return done();
  });
}
export async function addLeave(userId: string, startDate: string, endDate: string, note?: string) {
  return deskAct(async (me, c) => {
    if (userId !== me.id) deskAdminOnly(c);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return fail('Enter a start date and an end date on or after it.');
    await db.insert(schema.agentLeave).values({ userId, startDate, endDate, note: clean(note) as string | null }); return done();
  });
}
export async function deleteLeave(id: string) {
  return deskAct(async (me, c) => { const l = await db.query.agentLeave.findFirst({ where: eq(schema.agentLeave.id, id) }); if (!l) return done(); if (l.userId !== me.id) deskAdminOnly(c); await db.delete(schema.agentLeave).where(eq(schema.agentLeave.id, id)); return done(); });
}

/* ---------------- major incidents ---------------- */
export async function setMajorIncident(ticketId: string, on: boolean) {
  return deskAct(async (me, c) => {
    const t = await ticketFor(c, ticketId, 'work'); if (t.incidentId) return fail('This ticket is linked to another incident. Unlink it first.');
    await db.update(schema.tickets).set({ isIncident: on, priority: on && t.priority !== 'Urgent' ? 'Urgent' : t.priority, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id));
    if (!on) await db.update(schema.tickets).set({ incidentId: null }).where(eq(schema.tickets.incidentId, t.id));
    await event(t.id, me.id, on ? 'Marked as a major incident' : 'No longer a major incident'); return done();
  });
}
export async function linkToIncident(ticketIds: string[], incidentId: string | null) {
  return deskAct<{ linked: number }>(async (me, c) => {
    let inc: Awaited<ReturnType<typeof ticketFor>> | null = null;
    if (incidentId) { inc = await ticketFor(c, incidentId, 'work'); if (!inc.isIncident) return fail('That ticket isn’t a major incident.'); }
    let linked = 0;
    for (const id of ticketIds.slice(0, 500)) {
      if (id === incidentId) continue; const t = await ticketFor(c, id, 'work'); if (t.isIncident) continue;
      await db.update(schema.tickets).set({ incidentId: inc?.id || null, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id));
      await event(t.id, me.id, inc ? `Linked to major incident ${await tag(inc.number)}` : 'Unlinked from major incident'); linked++;
    }
    if (inc) await event(inc.id, me.id, `${linked} ticket${linked === 1 ? '' : 's'} linked`);
    return done({ linked });
  });
}

/* ---------------- status page ---------------- */
export async function saveStatusIncident(input: { id?: string; title: string; kind: StatusIncident['kind']; status: StatusIncident['status']; impact: StatusIncident['impact']; components: string[]; message: string; startsAt?: string; endsAt?: string | null; ticketId?: string | null }) {
  return deskAct<{ id: string }>(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t post status updates.');
    if (!input.title?.trim()) return fail('Give the incident a title.');
    if (!input.message?.trim()) return fail('Write an update for customers.');
    const closed = ['resolved', 'completed'].includes(input.status); const now = new Date();
    const upd = { at: now.toISOString(), status: input.status, text: input.message.trim().slice(0, 2000) };
    const startsAt = input.startsAt ? new Date(input.startsAt) : now; if (isNaN(+startsAt)) return fail('Enter a valid start time.');
    if (input.id) {
      const prev = await db.query.statusIncidents.findFirst({ where: eq(schema.statusIncidents.id, input.id) }); if (!prev) return fail('This incident no longer exists.');
      await db.update(schema.statusIncidents).set({ title: input.title.trim(), kind: input.kind, status: input.status, impact: input.impact, components: input.components, startsAt, endsAt: closed ? prev.endsAt || now : input.endsAt ? new Date(input.endsAt) : null, updates: [upd, ...prev.updates] }).where(eq(schema.statusIncidents.id, input.id));
      return done({ id: input.id });
    }
    const [row] = await db.insert(schema.statusIncidents).values({ title: input.title.trim(), kind: input.kind, status: input.status, impact: input.impact, components: input.components, startsAt, endsAt: closed ? now : input.endsAt ? new Date(input.endsAt) : null, updates: [upd], ticketId: isUuid(input.ticketId) ? input.ticketId : null, createdBy: me.id }).returning();
    await audit(me.id, 'status.posted', 'status', row.id, row.title); return done({ id: row.id });
  });
}
export async function deleteStatusIncident(id: string) { return deskAct(async (_me, c) => { deskAdminOnly(c); await db.delete(schema.statusIncidents).where(eq(schema.statusIncidents.id, id)); return done(); }); }

/* ---------------- community moderation ---------------- */
export async function agentForumReply(topicId: string, body: string) {
  return deskAct(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t post in the community.');
    const topic = await db.query.forumTopics.findFirst({ where: eq(schema.forumTopics.id, topicId) }); if (!topic) return fail('This topic no longer exists.');
    if (!body.trim()) return fail('Write a reply.');
    await db.insert(schema.forumPosts).values({ topicId, body: body.trim().slice(0, 10000), userId: me.id, authorName: `${me.name} · Raidefend` });
    await db.update(schema.forumTopics).set({ lastPostAt: new Date() }).where(eq(schema.forumTopics.id, topicId)); return done();
  });
}
export async function moderateTopic(topicId: string, patch: { pinned?: boolean; locked?: boolean; hidden?: boolean; answerId?: string | null; category?: string }) {
  return deskAct(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t moderate the community.');
    const v: Record<string, unknown> = {}; for (const k of ['pinned', 'locked', 'hidden'] as const) if (k in patch) v[k] = !!patch[k];
    if ('answerId' in patch) v.answerId = isUuid(patch.answerId) ? patch.answerId : null; if (patch.category) v.category = patch.category;
    await db.update(schema.forumTopics).set(v).where(eq(schema.forumTopics.id, topicId)); await audit(me.id, 'community.moderated', 'topic', topicId, Object.keys(v).join(', ')); return done();
  });
}
export async function hideForumPost(postId: string, hidden: boolean) {
  return deskAct(async (me, c) => { if (c.role === 'light') return fail('Light agents can’t moderate the community.'); await db.update(schema.forumPosts).set({ hidden }).where(eq(schema.forumPosts.id, postId)); await audit(me.id, 'community.moderated', 'post', postId, hidden ? 'hidden' : 'shown'); return done(); });
}
/** Turn a community question into a ticket when it needs private follow-up. */
export async function topicToTicket(topicId: string) {
  return deskAct<{ id: string }>(async (me, c) => {
    if (c.role === 'light') return fail('Light agents can’t create tickets.');
    const tp = await db.query.forumTopics.findFirst({ where: eq(schema.forumTopics.id, topicId) }); if (!tp) return fail('This topic no longer exists.');
    const ct = tp.contactId ? await db.query.contacts.findFirst({ where: eq(schema.contacts.id, tp.contactId) }) : null;
    const t = await createTicketInternal({ subject: tp.title, channel: 'portal', contactId: ct?.id || null, companyId: ct?.companyId || null, createdBy: me.id, firstMessage: { kind: 'incoming', body: tp.body, fromName: tp.authorName, fromEmail: ct?.email || null } });
    return done({ id: t.id });
  });
}

/* ---------------- ticket history import ---------------- */
type ImportRow = Record<string, string>;
const parseDate = (v?: string) => { if (!v?.trim()) return null; const d = new Date(v.trim().replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/, '$3-$2-$1')); return isNaN(+d) ? null : d; };
export async function importTickets(rows: ImportRow[], mode: 'skip' | 'update') {
  return deskAct<{ created: number; updated: number; skipped: number; errors: string[] }>(async (me, c) => {
    deskAdminOnly(c); if (rows.length > 20000) return fail('Import up to 20,000 tickets at a time.');
    const [deps, sts, us, s] = await Promise.all([db.select().from(schema.departments), statuses(), db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users), getSettings()]);
    let created = 0, updated = 0, skipped = 0; const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      const subject = (r.subject || '').trim(); if (!subject) { skipped++; if (errors.length < 20) errors.push(`Row ${i + 2}: no subject`); continue; }
      const ext = (r.externalId || '').trim();
      const prev = ext ? await db.query.tickets.findFirst({ where: sql`${schema.tickets.custom}->>'importId' = ${ext}` }) : null;
      if (prev && mode === 'skip') { skipped++; continue; }
      const dept = deps.find((d) => d.name.toLowerCase() === (r.department || '').trim().toLowerCase()) || deps[0];
      const st = sts.find((x) => x.name.toLowerCase() === (r.status || '').trim().toLowerCase()) || sts.find((x) => x.category === (/(closed|resolved|done)/i.test(r.status || '') ? 'closed' : 'open')) || sts[0];
      const pr = PRIORITIES.find((p) => p.toLowerCase() === (r.priority || '').trim().toLowerCase()) || 'Medium';
      const assignee = us.find((u) => u.email.toLowerCase() === (r.assigneeEmail || '').trim().toLowerCase());
      const createdAt = parseDate(r.createdAt) || new Date(); const resolvedAt = parseDate(r.resolvedAt) || (st.category === 'closed' ? createdAt : null);
      const req = r.requesterEmail?.trim() ? await findOrCreateRequester(r.requesterEmail.trim(), r.requesterName, r.requesterPhone) : { contactId: null, companyId: null };
      const co = !req.companyId && r.company?.trim() ? await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${r.company.trim().toLowerCase()}` }) : null;
      const v = { subject: subject.slice(0, 250), description: r.description?.trim() || null, statusId: st.id, statusCategory: st.category, priority: pr, type: r.type?.trim() || null, channel: (r.channel || 'email').trim().toLowerCase(), category: r.category?.trim() || null,
        departmentId: dept.id, assigneeId: assignee?.id || null, contactId: req.contactId, companyId: req.companyId || co?.id || null, requesterName: r.requesterName?.trim() || null, requesterEmail: r.requesterEmail?.trim().toLowerCase() || null,
        requesterPhone: r.requesterPhone?.trim() || null, tags: tagsOf(r.tags || ''), custom: ext ? { importId: ext } : {}, createdAt, updatedAt: resolvedAt || createdAt, resolvedAt, closedAt: st.category === 'closed' && /^closed/i.test(st.name) ? resolvedAt : null, firstRespondedAt: parseDate(r.firstResponseAt), createdBy: me.id };
      try {
        if (prev) { await db.update(schema.tickets).set(v).where(eq(schema.tickets.id, prev.id)); updated++; continue; }
        const [t] = await db.insert(schema.tickets).values(v).returning();
        if (r.description?.trim()) await db.insert(schema.ticketThreads).values({ ticketId: t.id, kind: 'incoming', body: r.description.trim(), fromName: v.requesterName, fromEmail: v.requesterEmail, channel: v.channel, createdAt });
        if (r.resolution?.trim()) await db.insert(schema.ticketThreads).values({ ticketId: t.id, kind: 'reply', body: r.resolution.trim(), authorId: assignee?.id || null, fromName: assignee?.name || 'Support', createdAt: resolvedAt || createdAt });
        await db.insert(schema.ticketEvents).values({ ticketId: t.id, userId: me.id, text: `Imported${ext ? ` (old ID ${ext})` : ''}`, at: createdAt });
        created++;
      } catch (e) { skipped++; if (errors.length < 20) errors.push(`Row ${i + 2}: ${String((e as Error).message).slice(0, 120)}`); }
    }
    await audit(me.id, 'tickets.imported', 'ticket', null, `${created} created, ${updated} updated, ${skipped} skipped`); void s;
    return done({ created, updated, skipped, errors });
  });
}

/* ---------------- WhatsApp settings ---------------- */
export async function saveWhatsApp(input: { enabled: boolean; departmentId: string; phoneNumberId: string; accessToken?: string; verifyToken: string; appSecret?: string }) {
  return deskAct(async (me, c) => {
    deskAdminOnly(c); const prev = (await getIntegrations()).whatsapp;
    const phoneNumberId = input.phoneNumberId?.trim(); const verifyToken = input.verifyToken?.trim();
    if (input.enabled && (!phoneNumberId || !verifyToken || (!input.accessToken && !prev?.accessToken) || (!input.appSecret && !prev?.appSecret))) return fail('Enter the phone number ID, access token, app secret and a verify token.');
    await saveIntegrations({ whatsapp: { phoneNumberId: phoneNumberId || '', verifyToken: verifyToken || '', accessToken: input.accessToken?.trim() ? seal(input.accessToken.trim()) : prev?.accessToken || '',
      appSecret: input.appSecret?.trim() ? seal(input.appSecret.trim()) : prev?.appSecret || '', lastError: null, lastInboundAt: prev?.lastInboundAt || null } });
    await saveSettings({ whatsappEnabled: !!input.enabled, whatsappDepartmentId: isUuid(input.departmentId) ? input.departmentId : '' });
    await audit(me.id, 'settings.changed', 'settings', null, 'whatsapp'); return done();
  });
}

/* ---------------- AI helpers ---------------- */
async function threadText(ticketId: string) {
  const th = await db.select().from(schema.ticketThreads).where(eq(schema.ticketThreads.ticketId, ticketId)).orderBy(schema.ticketThreads.createdAt);
  return th.slice(-20).map((x) => `${x.kind === 'incoming' ? 'CUSTOMER' : x.kind === 'note' ? 'INTERNAL NOTE' : 'AGENT'} (${x.createdAt.toISOString().slice(0, 16)}): ${x.body.slice(0, 1500)}`).join('\n\n');
}
export async function aiSuggestReply(ticketId: string) {
  return deskAct<{ text: string; sources: string[] }>(async (me, c) => {
    const t = await ticketFor(c, ticketId, 'work'); const { askClaude, aiOn } = await import('./ai'); if (!aiOn()) return fail('The AI assistant is not set up. Add ANTHROPIC_API_KEY to the server environment.');
    // Ground the draft in published help articles and similar resolved tickets.
    const words = `${t.subject}`.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 6);
    const arts = words.length ? await db.select({ title: schema.kbArticles.title, body: schema.kbArticles.body }).from(schema.kbArticles).where(and(eq(schema.kbArticles.status, 'published'), sql`(${sql.join(words.map((w) => sql`lower(${schema.kbArticles.title} || ' ' || ${schema.kbArticles.body}) like ${'%' + w + '%'}`), sql` or `)})`)).limit(3) : [];
    const similar = words.length ? await db.select({ id: schema.tickets.id, subject: schema.tickets.subject }).from(schema.tickets).where(and(eq(schema.tickets.statusCategory, 'closed'), ne(schema.tickets.id, t.id), sql`(${sql.join(words.map((w) => sql`lower(${schema.tickets.subject}) like ${'%' + w + '%'}`), sql` or `)})`)).orderBy(desc(schema.tickets.resolvedAt)).limit(3) : [];
    const sims = await Promise.all(similar.map(async (x) => { const last = await db.query.ticketThreads.findFirst({ where: and(eq(schema.ticketThreads.ticketId, x.id), eq(schema.ticketThreads.kind, 'reply')), orderBy: desc(schema.ticketThreads.createdAt) }); return last ? `Resolved ticket “${x.subject}”: ${last.body.slice(0, 800)}` : null; }));
    const text = await askClaude(`You are ${me.name}, a support engineer at Raidefend (a cybersecurity reseller in the UAE). Draft the next reply to the customer. Be specific, friendly and brief; use numbered steps for instructions. Do not invent facts, licence keys or promises; if information is missing, ask for it. Write in ${t.language || 'English'}. Reply with the message only (no subject, no signature).\n\nTicket: ${t.subject}\n\nConversation:\n${await threadText(t.id)}\n\nHelp articles:\n${arts.map((a) => `# ${a.title}\n${a.body.slice(0, 1200)}`).join('\n\n') || '(none)'}\n\nSimilar resolved tickets:\n${sims.filter(Boolean).join('\n\n') || '(none)'}`, { maxTokens: 700, timeoutMs: 30000 });
    return { ok: true as const, text, sources: [...arts.map((a) => a.title), ...similar.map((s) => s.subject)] };
  });
}
export async function aiSummarize(ticketId: string) {
  return deskAct<{ text: string }>(async (_me, c) => {
    const t = await ticketFor(c, ticketId, 'see'); const { askClaude, aiOn } = await import('./ai'); if (!aiOn()) return fail('The AI assistant is not set up. Add ANTHROPIC_API_KEY to the server environment.');
    const text = await askClaude(`Summarise this support ticket for a colleague taking it over. Three short lines: the problem, what has been tried, and what is needed next. No preamble.\n\nTicket: ${t.subject}\n\n${await threadText(t.id)}`, { maxTokens: 250, timeoutMs: 25000 });
    return { ok: true as const, text };
  });
}
