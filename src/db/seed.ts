import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import { config } from './env';
import { defaultPages } from '../lib/insights-defaults';
import { DEFAULT_SETTINGS } from '../lib/settings-defaults';

config();
const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });
const DAY = 86_400_000;
const iso = (offsetDays: number) => { const d = new Date(Date.now() + offsetDays * DAY); return d.toISOString().slice(0, 10); };
const ago = (days: number) => new Date(Date.now() - days * DAY);

/* ---------------- RAD Workspace: helpdesk setup (idempotent, also for existing installs) ---------------- */
const flagged = async (key: string) => !!(await db.query.settings.findFirst({ where: eq(schema.settings.key, key) }));
const setFlag = (key: string) => db.insert(schema.settings).values({ key, value: true }).onConflictDoNothing();
const TZ = process.env.APP_TIMEZONE || 'Asia/Dubai';

/** Departments, statuses, SLAs, knowledge base and canned replies, once. Admins become helpdesk admins. */
async function ensureDesk() {
  await db.update(schema.users).set({ deskRole: 'admin', ticketScope: 'all', crmAccess: true }).where(eq(schema.users.role, 'admin'));
  if (await flagged('seed_desk')) return;
  if (!(await db.select().from(schema.ticketStatuses).limit(1)).length) {
    await db.insert(schema.ticketStatuses).values(([['Open', 'open', true], ['In progress', 'open', false], ['Waiting on customer', 'onhold', false], ['Waiting on third party', 'onhold', false], ['Resolved', 'closed', false], ['Closed', 'closed', false]] as const)
      .map(([name, category, isDefault], i) => ({ name, category, isDefault, sortOrder: i })));
  }
  if (!(await db.select().from(schema.departments).limit(1)).length) {
    const [dep] = await db.insert(schema.departments).values({ name: 'Support', email: process.env.SUPPORT_EMAIL || null, assignMode: 'round_robin', autoAck: true, signature: 'Raidefend Support', sortOrder: 0 }).returning();
    const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'admin'));
    if (admins.length) await db.insert(schema.departmentMembers).values(admins.map((a) => ({ departmentId: dep.id, userId: a.id }))).onConflictDoNothing();
  }
  if (!(await db.select().from(schema.slaPolicies).limit(1)).length) {
    const h = (first: number, resolve: number) => ({ first: first * 60, resolve: resolve * 60 });
    await db.insert(schema.slaPolicies).values([
      { name: 'Strategic customers', tier: 'Strategic', targets: { Urgent: h(0.5, 4), High: h(2, 8), Medium: h(4, 24), Low: h(8, 40) }, businessHours: true, warnPct: 75, escalateTo: 'both', sortOrder: 0 },
      { name: 'Standard', targets: { Urgent: h(1, 8), High: h(4, 16), Medium: h(8, 40), Low: h(16, 80) }, businessHours: true, warnPct: 80, escalateTo: 'both', sortOrder: 1 },
    ]);
  }
  if (!(await db.select().from(schema.kbCategories).limit(1)).length) {
    const cats = await db.insert(schema.kbCategories).values([{ name: 'Getting started', description: 'Setting up and first steps', sortOrder: 0 }, { name: 'Licensing & renewals', description: 'Licence keys, activation and renewals', sortOrder: 1 }, { name: 'Troubleshooting', description: 'Fixes for common problems', sortOrder: 2 }]).returning();
    await db.insert(schema.kbArticles).values([
      { categoryId: cats[0].id, title: 'How to open a support request', slug: 'how-to-open-a-support-request', status: 'published', visibility: 'public', tags: ['portal'],
        body: 'You can reach us three ways:\n\n1. **Email** your support address — each email becomes a ticket and you get a ticket number such as RD-1042.\n2. **The support portal** — sign in to open requests, reply and see the history of every ticket for your company.\n3. **The web form** — no account needed.\n\nPlease include the product, the version and any error message you see. Screenshots help.' },
      { categoryId: cats[1].id, title: 'Activating your licence key', slug: 'activating-your-licence-key', status: 'published', visibility: 'public', tags: ['licence'],
        body: '1. Open the management console and go to **Settings → Licence**.\n2. Paste the key exactly as it appears in your delivery email.\n3. Click **Activate**. The console must reach the internet on port 443.\n\nIf activation fails, reply to your ticket with a screenshot of the error.' },
      { categoryId: cats[1].id, title: 'What happens when my licence expires?', slug: 'licence-expiry', status: 'published', visibility: 'public', tags: ['renewal'],
        body: 'You get reminders 90, 30 and 7 days before expiry. After expiry, protection keeps running for a 14-day grace period but updates stop. Ask your account manager for a renewal quote at any time.' },
      { categoryId: cats[2].id, title: 'Agents are not reporting to the console', slug: 'agents-not-reporting', status: 'published', visibility: 'public', tags: ['agent'],
        body: '- Check the endpoint can reach the console address on port 443.\n- Make sure the system clock is correct (certificates fail if it is more than 5 minutes off).\n- Restart the agent service.\n\nStill stuck? Open a ticket and attach the agent log.' },
      { categoryId: cats[2].id, title: 'Internal: escalation path to the vendor', slug: 'internal-vendor-escalation', status: 'published', visibility: 'internal', tags: ['internal'],
        body: 'For L3 issues, open a case on the vendor partner portal, put the vendor case number in the ticket tags, and set the status to **Waiting on third party** so the SLA pauses.' },
    ]);
  }
  if (!(await db.select().from(schema.cannedResponses).limit(1)).length) {
    await db.insert(schema.cannedResponses).values([
      { name: 'Acknowledge and investigate', body: 'Hi {{customer_name}},\n\nThanks for reaching out. I’m looking into {{ticket_number}} now and will update you shortly.\n\nRegards,\n{{agent_name}}' },
      { name: 'Need more details', body: 'Hi {{customer_name}},\n\nTo move this forward, could you send:\n- the product version\n- a screenshot of the error\n- when it started\n\nRegards,\n{{agent_name}}' },
      { name: 'Resolved — please confirm', body: 'Hi {{customer_name}},\n\nWe believe this is now fixed. If anything is still not right, just reply and the ticket reopens.\n\nRegards,\n{{agent_name}}' },
    ]);
  }
  await setFlag('seed_desk');
  console.log('Set up the helpdesk: Support department, statuses, SLA policies, knowledge base and canned replies.');
}

/** Replace the old Service pipeline: its records become tickets (with notes), then the pipeline is removed. */
async function migrateServicePipeline() {
  if (await flagged('seed_service_migrated')) return;
  const pipe = (await db.select().from(schema.pipelines)).find((p) => p.name.toLowerCase() === 'service' && p.recordName.toLowerCase() === 'ticket');
  if (pipe) {
    const subs = await db.select().from(schema.subPipelines).where(eq(schema.subPipelines.pipelineId, pipe.id));
    const stages = (await Promise.all(subs.map((s) => db.select().from(schema.stages).where(eq(schema.stages.subPipelineId, s.id))))).flat();
    const sts = await db.select().from(schema.ticketStatuses); const dep = (await db.select().from(schema.departments))[0];
    const st = (n: string) => sts.find((s) => s.name === n) || sts[0];
    const deals = await db.select().from(schema.deals).where(eq(schema.deals.pipelineId, pipe.id));
    for (const d of deals) {
      const stage = stages.find((s) => s.id === d.stageId);
      const status = stage?.type === 'won' ? st('Resolved') : stage?.type === 'lost' ? st('Closed') : /wait/i.test(stage?.name || '') ? st('Waiting on customer') : /progress/i.test(stage?.name || '') ? st('In progress') : st('Open');
      const contact = d.contactId ? await db.query.contacts.findFirst({ where: eq(schema.contacts.id, d.contactId) }) : null;
      const [t] = await db.insert(schema.tickets).values({ subject: d.name, description: d.description, statusId: status.id, statusCategory: status.category, priority: d.priority === 'High' ? 'High' : d.priority === 'Low' ? 'Low' : 'Medium', channel: 'internal', departmentId: dep.id,
        assigneeId: d.ownerId, contactId: d.contactId, companyId: d.companyId, tags: d.tags, requesterName: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null, requesterEmail: contact?.email || null,
        resolvedAt: status.category === 'closed' ? d.closedAt || d.updatedAt : null, closedAt: status.name === 'Closed' ? d.closedAt || d.updatedAt : null, isSample: d.isSample, createdAt: d.createdAt, createdBy: d.ownerId }).returning();
      await db.insert(schema.ticketEvents).values({ ticketId: t.id, text: `Moved from the old Service pipeline (stage “${stage?.name || '—'}”)` });
      const notes = await db.select().from(schema.notes).where(eq(schema.notes.relatedId, d.id));
      if (notes.length) await db.insert(schema.ticketThreads).values(notes.map((n) => ({ ticketId: t.id, kind: 'note' as const, authorId: n.authorId, body: n.body, createdAt: n.createdAt })));
      const acts = await db.select().from(schema.activities).where(eq(schema.activities.relatedId, d.id));
      if (acts.length) await db.insert(schema.ticketThreads).values({ ticketId: t.id, kind: 'note', body: 'Activities from the old record:\n' + acts.map((a) => `- ${a.done ? '✓' : '○'} ${a.type}: ${a.title}${a.dueDate ? ` (${a.dueDate})` : ''}`).join('\n') });
      await db.update(schema.attachments).set({ relatedType: 'ticket', relatedId: t.id }).where(eq(schema.attachments.relatedId, d.id));
      await db.delete(schema.notes).where(eq(schema.notes.relatedId, d.id)); await db.delete(schema.activities).where(eq(schema.activities.relatedId, d.id));
      await db.delete(schema.deals).where(eq(schema.deals.id, d.id));
    }
    for (const a of await db.select().from(schema.automations)) if (a.trigger.pipelineId === pipe.id || a.actions.createDeal?.pipelineId === pipe.id) await db.delete(schema.automations).where(eq(schema.automations.id, a.id));
    await db.delete(schema.stageRules).where(eq(schema.stageRules.pipelineId, pipe.id));
    await db.delete(schema.customFields).where(eq(schema.customFields.pipelineId, pipe.id));
    for (const s of subs) await db.delete(schema.stages).where(eq(schema.stages.subPipelineId, s.id));
    await db.delete(schema.subPipelines).where(eq(schema.subPipelines.pipelineId, pipe.id));
    await db.delete(schema.pipelines).where(eq(schema.pipelines.id, pipe.id));
    console.log(`Moved ${deals.length} Service records into helpdesk tickets and removed the Service pipeline.`);
  }
  await setFlag('seed_service_migrated'); await setFlag('seed_service');
}

/** Lost deals come back: a re-engagement task six months later (added once). */
async function ensureReengagement() {
  if (await flagged('seed_reengage')) return;
  const sales = (await db.select().from(schema.pipelines)).find((p) => p.name === 'Sales');
  await db.insert(schema.automations).values({ name: 'Re-engage lost deals after 6 months', trigger: { event: 'deal.lost', ...(sales ? { pipelineId: sales.id } : {}) }, actions: { task: { title: 'Re-engage: {{name}}', type: 'call', dueDays: 180 } } });
  await db.insert(schema.automations).values({ name: 'Urgent tickets alert the department', trigger: { event: 'ticket.created', priority: 'Urgent' }, actions: { notify: { to: 'department', message: 'Urgent ticket: {{name}}' } } });
  await setFlag('seed_reengage');
}

/** Escalation ladder and an example custom role, once (existing installs get them on upgrade). */
async function ensureLadder() {
  if (await flagged('seed_v2')) return;
  if (!(await db.select().from(schema.escalationRules).limit(1)).length) await db.insert(schema.escalationRules).values([
    { level: 1, afterMinutes: 0, target: 'team_lead', reassign: false, raisePriority: false },
    { level: 2, afterMinutes: 240, target: 'manager', reassign: false, raisePriority: true },
    { level: 3, afterMinutes: 480, target: 'desk_admins', reassign: false, raisePriority: false },
  ]);
  if (!(await db.select().from(schema.customRoles).limit(1)).length) await db.insert(schema.customRoles).values({ name: 'Contractor (no export or delete)', description: 'For temporary staff: can work records but not export, import, delete or see cost and margin.',
    permissions: { exportData: false, importData: false, deleteRecords: false, viewCost: false, bulkEdit: false, viewInsights: true, deleteTickets: false, mergeTickets: true } });
  await setFlag('seed_v2');
}
async function ensureWorkspace() { await ensureDesk(); await migrateServicePipeline(); await ensureReengagement(); await ensureLadder(); }

/** Sample licences, contracts, community, status page and synced emails. */
async function sampleExtras(me: string, cts: schema.Contact[], cos: schema.Company[], prods: schema.Product[]) {
  await db.insert(schema.licences).values([
    { companyId: cos[0].id, contactId: cts[0].id, productId: prods[1].id, productName: prods[1].name, vendor: 'Licence', seats: 250, startDate: iso(-345), endDate: iso(20), value: 120000, isSample: true },
    { companyId: cos[0].id, contactId: cts[0].id, productId: prods[3].id, productName: prods[3].name, vendor: 'Support', seats: 1, startDate: iso(-345), endDate: iso(20), value: 18000, isSample: true },
    { companyId: cos[2].id, contactId: cts[2].id, productId: prods[0].id, productName: prods[0].name, vendor: 'Licence', seats: 1200, startDate: iso(-300), endDate: iso(65), value: 48000, isSample: true },
    { companyId: cos[1].id, contactId: cts[1].id, productId: prods[0].id, productName: prods[0].name, vendor: 'Licence', seats: 80, startDate: iso(-400), endDate: iso(-35), value: 48000, status: 'expired', isSample: true },
  ]);
  const sla = await db.select().from(schema.slaPolicies);
  await db.insert(schema.supportContracts).values([
    { companyId: cos[2].id, name: 'Sample: Strategic support 2026', tier: 'Strategic', slaPolicyId: sla.find((x) => x.tier === 'Strategic')?.id || null, hoursIncluded: 120, startDate: iso(-120), endDate: iso(245), value: 60000, isSample: true },
    { companyId: cos[0].id, name: 'Sample: Premium support', tier: 'Premium', hoursIncluded: 20, startDate: iso(-200), endDate: iso(165), value: 12000, isSample: true },
    { companyId: cos[1].id, name: 'Sample: Standard support 2025', tier: 'Standard', hoursIncluded: 10, startDate: iso(-400), endDate: iso(-35), value: 5000, isSample: true },
  ]);
  const [topic] = await db.insert(schema.forumTopics).values({ category: 'How-to', title: 'Sample: How do I exclude a folder from on-access scanning?', body: 'Our backup software gets slowed down by scanning. Where do I add an exclusion for D:\\Backups?', contactId: cts[0].id, authorName: 'Sara E.', views: 14 }).returning();
  const [ans] = await db.insert(schema.forumPosts).values({ topicId: topic.id, body: 'In the console go to Policies → Threat protection → Exclusions → Add, choose “Folder” and enter D:\\Backups\\. It applies on the next policy sync (about 5 minutes).', userId: me, authorName: 'Support · Raidefend' }).returning();
  await db.update(schema.forumTopics).set({ answerId: ans.id }).where(eq(schema.forumTopics.id, topic.id));
  await db.insert(schema.statusIncidents).values({ title: 'Sample: Licensing server maintenance', kind: 'maintenance', status: 'scheduled', impact: 'minor', components: ['Licensing server'], startsAt: new Date(Date.now() + 2 * 864e5), endsAt: new Date(Date.now() + 2 * 864e5 + 2 * 3600_000),
    updates: [{ at: new Date().toISOString(), status: 'scheduled', text: 'Licence activations will be unavailable for up to 2 hours while we upgrade the licensing server. Existing protection is not affected.' }], createdBy: me });
  await db.insert(schema.emailLogs).values([
    { userId: me, messageId: '<sample-1@raidefend.com>', direction: 'out', subject: 'Sample: Renewal options for 2027', snippet: 'Hi Sara, attached are the renewal options we discussed, including the 3-year term with a 12% saving…', fromEmail: 'you@raidefend.com', toEmails: 'sara@example.com', contactId: cts[0].id, companyId: cos[0].id, at: ago(3) },
    { userId: me, messageId: '<sample-2@example.com>', direction: 'in', subject: 'Re: Sample: Renewal options for 2027', snippet: 'Thanks — the 3-year option works for us. Could you add 50 more seats for the new warehouse?', fromEmail: 'sara@example.com', toEmails: 'you@raidefend.com', contactId: cts[0].id, companyId: cos[0].id, at: ago(2) },
  ]);
  console.log('Loaded sample licences, contracts, community topic, status notice and emails.');
}

/** Sample tickets for the sample customers. */
async function sampleTickets(me: string, cts: schema.Contact[], cos: schema.Company[], prods: schema.Product[]) {
  const sts = await db.select().from(schema.ticketStatuses); const dep = (await db.select().from(schema.departments))[0]; const pols = await db.select().from(schema.slaPolicies);
  const { dueDates, pickPolicy } = await import('../lib/sla');
  const st = (n: string) => sts.find((s) => s.name === n)!;
  const H = 3_600_000; const at = (h: number) => new Date(Date.now() - h * H);
  const mk = async (subject: string, ci: number, priority: string, status: string, hoursAgo: number, channel: string, msgs: [('incoming' | 'reply' | 'note'), string][], extra: Partial<schema.Ticket> = {}) => {
    const created = at(hoursAgo); const pol = pickPolicy(pols, dep.id, cos[ci].tier);
    const due = dueDates(pol, priority, created, DEFAULT_SETTINGS.businessHours, TZ); const s = st(status);
    const [t] = await db.insert(schema.tickets).values({ subject: 'Sample: ' + subject, description: msgs[0][1], statusId: s.id, statusCategory: s.category, priority, channel, departmentId: dep.id, assigneeId: me, contactId: cts[ci].id, companyId: cos[ci].id,
      requesterName: `${cts[ci].firstName} ${cts[ci].lastName || ''}`.trim(), requesterEmail: cts[ci].email, slaPolicyId: pol?.id, ...due, type: 'Problem', productId: prods[1].id, isSample: true, createdAt: created, createdBy: me,
      lastCustomerReplyAt: created, ...(s.category === 'closed' ? { resolvedAt: at(hoursAgo - 6) } : {}), ...(s.category === 'onhold' ? { onHoldSince: at(2) } : {}), ...extra }).returning();
    await db.insert(schema.ticketThreads).values(msgs.map(([kind, body], i) => ({ ticketId: t.id, kind, body, authorId: kind === 'incoming' ? null : me, fromName: kind === 'incoming' ? t.requesterName : null, fromEmail: kind === 'incoming' ? t.requesterEmail : null, channel, createdAt: new Date(+created + i * 40 * 60_000) })));
    await db.insert(schema.ticketEvents).values({ ticketId: t.id, text: 'Created', userId: me, at: created });
    return t;
  };
  await mk('Console licence will not activate', 0, 'High', 'In progress', 5, 'email', [['incoming', 'Hi team, the new Enterprise key gives “activation server unreachable”. Our proxy allows 443. Can you help today?'], ['reply', 'Hi Sara, thanks — can you send a screenshot of the proxy settings page? I am checking the key on our side.'], ['note', 'Key is valid on the vendor portal. Probably SSL inspection on their proxy.']], { firstRespondedAt: at(4.3) });
  await mk('Agents not reporting after Windows update', 2, 'Urgent', 'Open', 1, 'portal', [['incoming', 'About 40 branch endpoints stopped reporting after last night’s Windows update. Please treat as urgent.']]);
  await mk('Request: add two admin users', 1, 'Low', 'Waiting on customer', 30, 'web', [['incoming', 'Please add two more console admins for our new SOC analysts.'], ['reply', 'Happy to — please confirm their full names and email addresses.']], { firstRespondedAt: at(29) });
  await mk('Renewal quote for 2027', 0, 'Medium', 'Resolved', 80, 'email', [['incoming', 'Could you send the renewal quote for next year?'], ['reply', 'Sent — your account manager has shared the quote by email.']], { firstRespondedAt: at(78), rating: 'good', ratedAt: at(70) });
  await mk('Dashboard shows wrong time zone', 3, 'Medium', 'Open', 50, 'email', [['incoming', 'Times in the dashboard are 4 hours behind Dubai time.']], { breachedAt: at(2), frBreachedAt: at(30), escalated: true });
  console.log('Loaded 5 sample tickets.');
}

async function main() {
  // 1. Admin account
  const email = (process.env.ADMIN_EMAIL || 'admin@raidefend.com').toLowerCase();
  let admin = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!admin) {
    [admin] = await db.insert(schema.users).values({ email, name: process.env.ADMIN_NAME || 'Admin', role: 'admin', passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe123!', 10) }).returning();
    console.log(`Created admin ${email}`);
  }

  // 2. Structure (only once)
  const existing = await db.select().from(schema.pipelines).limit(1);
  if (existing.length) { await ensureWorkspace(); console.log('Pipelines already exist, skipping structure and sample data.'); await client.end(); return; }

  await db.insert(schema.settings).values({ key: 'org', value: DEFAULT_SETTINGS }).onConflictDoNothing();

  const mkPipe = async (name: string, recordName: string, sortOrder: number, subs: { name: string; stages: [string, 'open' | 'won' | 'lost', number | null, number | null][] }[]) => {
    const [p] = await db.insert(schema.pipelines).values({ name, recordName, sortOrder }).returning();
    const out: { sub: schema.SubPipeline; stages: schema.Stage[] }[] = [];
    for (const [i, s] of subs.entries()) {
      const [sp] = await db.insert(schema.subPipelines).values({ pipelineId: p.id, name: s.name, sortOrder: i }).returning();
      const sts = await db.insert(schema.stages).values(s.stages.map(([n, type, probability, idleDays], j) => ({ subPipelineId: sp.id, name: n, type, probability, idleDays, sortOrder: j }))).returning();
      out.push({ sub: sp, stages: sts });
    }
    return { p, out };
  };
  const sales = await mkPipe('Sales', 'Deal', 0, [
    { name: 'Direct sales', stages: [['Qualification', 'open', 10, 14], ['Needs analysis', 'open', 25, 14], ['Demo / PoC', 'open', 45, 21], ['Proposal sent', 'open', 65, 14], ['Negotiation', 'open', 80, 10], ['Closed won', 'won', 100, null], ['Closed lost', 'lost', 0, null]] },
    { name: 'Channel partners', stages: [['Deal registered', 'open', 15, 14], ['Joint discovery', 'open', 35, 14], ['Partner proposal', 'open', 60, 14], ['Closed won', 'won', 100, null], ['Closed lost', 'lost', 0, null]] },
  ]);
  const delivery = await mkPipe('Delivery', 'Project', 1, [
    { name: 'Onboarding', stages: [['Kick-off', 'open', null, 7], ['Implementation', 'open', null, 21], ['Acceptance', 'open', null, 10], ['Live', 'won', 100, null], ['On hold / cancelled', 'lost', 0, null]] },
  ]);
  await mkPipe('Renewals', 'Renewal', 2, [
    { name: 'Annual contracts', stages: [['Due in 90 days', 'open', 60, 30], ['Account review', 'open', 75, 14], ['Quote sent', 'open', 85, 14], ['Renewed', 'won', 100, null], ['Churned', 'lost', 0, null]] },
  ]);
  await ensureWorkspace();
  const S = sales.out[0].stages; const byName = (n: string) => S.find((s) => s.name === n)!;
  await db.insert(schema.stageRules).values([
    { pipelineId: sales.p.id, toStageId: byName('Proposal sent').id, requiredItems: ['amount', 'contact'] },
    { pipelineId: sales.p.id, toStageId: byName('Closed won').id, requiredItems: ['amount', 'closingDate'] },
  ]);
  await db.insert(schema.scoringRules).values([
    { field: 'email', operator: 'filled', points: 10 }, { field: 'phone', operator: 'filled', points: 10 }, { field: 'companyName', operator: 'filled', points: 10 },
    { field: 'jobTitle', operator: 'contains', value: 'director|head|chief|ciso|cio|cto|ceo|manager', points: 20 },
    { field: 'source', operator: 'is', value: 'Referral', points: 25 }, { field: 'source', operator: 'is', value: 'Partner', points: 20 },
    { field: 'source', operator: 'is', value: 'Website', points: 15 }, { field: 'source', operator: 'is', value: 'Event', points: 10 },
  ]);
  await db.insert(schema.emailTemplates).values([
    { name: 'Thanks for the meeting', subject: 'Next steps after our meeting, {{first_name}}', body: 'Hi {{first_name}},\n\nThank you for your time today. As discussed, I will share a short proposal for {{company}} covering scope, timeline and pricing.\n\nCould you confirm who else should be part of the review?\n\nBest regards,\n{{my_name}}' },
    { name: 'Proposal follow-up', subject: 'Following up on the proposal for {{company}}', body: 'Hi {{first_name}},\n\nI wanted to check whether you had a chance to review our proposal for {{deal}} ({{amount}}).\n\nHappy to walk your team through it this week. Would Tuesday or Wednesday suit you?\n\nBest regards,\n{{my_name}}' },
    { name: 'Renewal reminder', subject: 'Your {{company}} renewal', body: 'Hi {{first_name}},\n\nYour annual agreement is due for renewal soon. I would like to set up a short review of the past year and plans for the next one.\n\nBest regards,\n{{my_name}}' },
  ]);
  const D = delivery.out[0];
  await db.insert(schema.automations).values([
    { name: 'Won deal starts a delivery project', trigger: { event: 'deal.won', pipelineId: sales.p.id }, actions: { createDeal: { pipelineId: delivery.p.id, subPipelineId: D.sub.id, stageId: D.stages[0].id }, task: { title: 'Schedule kick-off for {{name}}', type: 'meeting', dueDays: 2 } } },
    { name: 'New lead gets a first-contact call', trigger: { event: 'lead.created' }, actions: { task: { title: 'First contact: {{name}}', type: 'call', dueDays: 1 } } },
    { name: 'Proposal follow-up', trigger: { event: 'deal.stage', pipelineId: sales.p.id, stageId: byName('Proposal sent').id }, actions: { task: { title: 'Follow up on proposal: {{name}}', type: 'call', dueDays: 3 } } },
    { name: 'Closing date is near', trigger: { event: 'deal.closing_soon', pipelineId: sales.p.id, days: 7 }, actions: { notify: { to: 'owner', message: '{{name}} is due to close within a week' } } },
    { name: 'Stuck deal alert', trigger: { event: 'deal.idle', pipelineId: sales.p.id, days: 21 }, actions: { notify: { to: 'manager', message: '{{name}} has not moved for 3 weeks' }, task: { title: 'Unblock {{name}}', type: 'task', dueDays: 1 } } },
  ]);
  await db.insert(schema.reportPages).values(defaultPages().map((p, i) => ({ name: p.name, sortOrder: i, tiles: p.tiles })));
  console.log('Created pipelines, rules, templates, automations and report pages.');

  if (process.env.SEED_SAMPLE_DATA !== 'true') { await client.end(); return; }

  // 3. Sample data, clearly marked
  const me = admin.id;
  const cos = await db.insert(schema.companies).values([
    { name: 'Sample: Al Noor Logistics', industry: 'Logistics', city: 'Dubai', emirate: 'Dubai', zone: 'Free zone', sector: 'Private', accountType: 'Customer', customerSince: iso(-8), tier: 'Key', employees: '201–500', tradeLicenceNo: 'DMCC-000000', tradeLicenceExpiry: iso(25), ownerId: me, isSample: true, createdAt: ago(60) },
    { name: 'Sample: Gulfstar Hospitals', industry: 'Healthcare', city: 'Abu Dhabi', emirate: 'Abu Dhabi', zone: 'Mainland', sector: 'Private', ownerId: me, isSample: true, createdAt: ago(55) },
    { name: 'Sample: Meridian Bank', industry: 'Banking', city: 'Dubai', emirate: 'Dubai', zone: 'Mainland', sector: 'Private', accountType: 'Customer', customerSince: iso(-40), tier: 'Strategic', employees: '1,000+', ownerId: me, isSample: true, createdAt: ago(50) },
    { name: 'Sample: Oasis Retail Group', industry: 'Retail', city: 'Sharjah', emirate: 'Sharjah', ownerId: me, isSample: true, createdAt: ago(45) },
    { name: 'Sample: Gulf Tech Distribution', industry: 'IT distribution', city: 'Dubai', emirate: 'Dubai', zone: 'Free zone', sector: 'Private', accountType: 'Distributor', tier: 'Key', employees: '51–200', ownerId: me, isSample: true, createdAt: ago(70) },
  ]).returning();
  const cts = await db.insert(schema.contacts).values([
    { firstName: 'Sara', lastName: 'Example', jobTitle: 'IT Director', companyId: cos[0].id, email: 'sara@example.com', mobile: '+971500000010', buyingRole: 'Decision maker', department: 'IT', language: 'English', consent: true, consentAt: ago(30), lastContactedAt: ago(5), source: 'Website', ownerId: me, isSample: true },
    { firstName: 'Omar', lastName: 'Example', jobTitle: 'CISO', companyId: cos[1].id, email: 'omar@example.com', mobile: '+971500000020', buyingRole: 'Champion', department: 'Security', language: 'Arabic', source: 'Referral', ownerId: me, isSample: true },
    { firstName: 'Priya', lastName: 'Example', jobTitle: 'Head of Procurement', companyId: cos[2].id, email: 'priya@example.com', buyingRole: 'Influencer', department: 'Procurement', source: 'Event', ownerId: me, isSample: true },
    { firstName: 'Daniel', lastName: 'Example', jobTitle: 'Operations Manager', companyId: cos[3].id, email: 'daniel@example.com', source: 'LinkedIn', ownerId: me, isSample: true },
  ]).returning();
  const prods = await db.insert(schema.products).values([
    { name: 'Platform licence – Standard', sku: 'LIC-STD', category: 'Licence', unitPrice: 48000, costPrice: 30000, billingType: 'Annual', unit: 'site', isSample: true },
    { name: 'Platform licence – Enterprise', sku: 'LIC-ENT', category: 'Licence', unitPrice: 120000, costPrice: 72000, billingType: 'Annual', unit: 'site', isSample: true },
    { name: 'Implementation services (per day)', sku: 'SVC-DAY', category: 'Services', unitPrice: 3500, costPrice: 1800, billingType: 'One-time', unit: 'day', isSample: true },
    { name: 'Annual support plan', sku: 'SUP-ANN', category: 'Support', unitPrice: 18000, costPrice: 6000, billingType: 'Annual', unit: 'plan', isSample: true },
  ]).returning();
  // A distributor with two people, each handling different products.
  const ctsDist = await db.insert(schema.contacts).values([
    { firstName: 'Hassan', lastName: 'Example', jobTitle: 'Licensing Product Manager', companyId: cos[4].id, email: 'hassan@example.com', mobile: '+971500000050', buyingRole: 'Influencer', department: 'Software', productIds: [prods[0].id, prods[1].id], ownerId: me, isSample: true },
    { firstName: 'Leena', lastName: 'Example', jobTitle: 'Services & Support Lead', companyId: cos[4].id, email: 'leena@example.com', mobile: '+971500000060', buyingRole: 'User', department: 'Services', productIds: [prods[2].id, prods[3].id], ownerId: me, isSample: true },
  ]).returning();
  const sp = sales.out[0].sub.id;
  const mk = (name: string, stage: string, amount: number, ci: number, close: number, inStage: number, extra: Partial<schema.Deal> = {}) => ({
    name: 'Sample: ' + name, pipelineId: sales.p.id, subPipelineId: sp, stageId: byName(stage).id, amount, currency: 'AED', companyId: cos[ci].id, contactId: cts[ci].id,
    closingDate: iso(close), ownerId: me, stageEnteredAt: ago(inStage), createdAt: ago(inStage + 12), isSample: true, ...extra,
  });
  const dls = await db.insert(schema.deals).values([
    mk('Al Noor fleet security rollout', 'Demo / PoC', 168000, 0, 30, 5, { priority: 'High', tags: ['strategic'], nextStep: 'Agree SSO and on-prem log option with IT', dealType: 'Upsell', leadSource: 'Website' }),
    mk('Gulfstar network assessment', 'Proposal sent', 96000, 1, 21, 18, { priority: 'High', tenderNumber: 'RFP-2026-118', submissionDeadline: iso(5), leadSource: 'Referral' }),
    mk('Meridian Bank SOC pilot', 'Needs analysis', 240000, 2, 60, 4, { tags: ['strategic'] }),
    mk('Oasis store network', 'Qualification', 52000, 3, 75, 2, { priority: 'Low' }),
    mk('Gulfstar clinics expansion', 'Negotiation', 72000, 1, 10, 6),
    mk('Al Noor warehouse phase 1', 'Closed won', 85000, 0, -8, 8, { closedAt: ago(8), amountBase: 85000, winReason: 'Best technical fit', poNumber: 'PO-55120', paymentTerms: '30 days' }),
    mk('Meridian branch hardening', 'Closed won', 64000, 2, -40, 40, { closedAt: ago(40), createdAt: ago(95), amountBase: 64000, winReason: 'Local support', contractStart: iso(-320), termMonths: 12, contractEnd: iso(44), recurringValue: 48000, paymentTerms: 'Advance' }),
    mk('Oasis e-commerce audit', 'Closed lost', 40000, 3, -20, 20, { closedAt: ago(20), amountBase: 40000, lossReason: 'Price', competitor: 'Other vendor' }),
  ]).returning();
  await db.insert(schema.dealEvents).values(dls.flatMap((d) => [{ dealId: d.id, kind: 'created', text: 'Created', userId: me, at: d.createdAt }, { dealId: d.id, kind: 'stage', stageId: d.stageId, userId: me, at: d.stageEnteredAt }]));
  await db.insert(schema.dealItems).values([
    { dealId: dls[0].id, productId: prods[1].id, name: prods[1].name, qty: 1, unitPrice: 120000 },
    { dealId: dls[0].id, productId: prods[2].id, name: prods[2].name, qty: 10, unitPrice: 3500 },
    { dealId: dls[0].id, productId: prods[3].id, name: prods[3].name, qty: 1, unitPrice: 13000 },
  ]);
  await db.insert(schema.activities).values([
    { type: 'meeting', title: 'PoC results review', dueDate: iso(2), dueTime: '10:00', relatedType: 'deal', relatedId: dls[0].id, ownerId: me, isSample: true },
    { type: 'call', title: 'Chase proposal feedback', dueDate: iso(-3), relatedType: 'deal', relatedId: dls[1].id, ownerId: me, isSample: true },
    { type: 'task', title: 'Send discovery questionnaire', dueDate: iso(0), relatedType: 'deal', relatedId: dls[2].id, ownerId: me, isSample: true },
    { type: 'call', title: 'Final pricing call with CFO', dueDate: iso(1), dueTime: '14:30', relatedType: 'deal', relatedId: dls[4].id, ownerId: me, isSample: true },
    { type: 'email', title: 'Sent case study', dueDate: iso(-5), done: true, doneAt: ago(5), relatedType: 'deal', relatedId: dls[0].id, ownerId: me, isSample: true },
  ]);
  await db.insert(schema.notes).values([
    { relatedType: 'deal', relatedId: dls[0].id, body: 'PoC running on two depots. IT wants SSO and an on-prem log option before sign-off.', authorId: me, isSample: true },
    { relatedType: 'deal', relatedId: dls[7].id, body: 'Lost on price; competitor bundled the audit with hardware.', authorId: me, isSample: true },
  ]);
  await db.insert(schema.leads).values([
    { firstName: 'Khalid', lastName: 'Example', companyName: 'Sample: Emirates Freight Co', jobTitle: 'Chief Information Security Officer', email: 'khalid@example.com', phone: '+971500000101', source: 'Referral', status: 'New', industry: 'Logistics', emirate: 'Dubai', companySize: '501–1,000', timeline: '1–3 months', budget: 150000, productInterestId: prods[1].id, ownerId: me, isSample: true, createdAt: ago(1) },
    { firstName: 'Aisha', lastName: 'Example', companyName: 'Sample: Desert Bloom Clinics', jobTitle: 'IT Manager', email: 'aisha@example.com', source: 'Website', status: 'Contacted', emirate: 'Abu Dhabi', consent: true, consentAt: ago(3), firstContactedAt: ago(2), ownerId: me, isSample: true, createdAt: ago(3) },
    { firstName: 'Rahul', lastName: 'Example', companyName: 'Sample: Corniche Hotels', jobTitle: 'Procurement Officer', phone: '+971550000303', source: 'Event', campaign: 'GITEX 2026', status: 'New', emirate: 'Abu Dhabi', ownerId: me, isSample: true, createdAt: ago(5) },
    { firstName: 'Mariam', lastName: 'Example', companyName: 'Sample: Falcon Fintech', jobTitle: 'CTO', email: 'mariam@example.com', phone: '+971520000404', source: 'Partner', status: 'Qualified', industry: 'Fintech', emirate: 'Abu Dhabi', timeline: 'This month', firstContactedAt: ago(7), ownerId: me, isSample: true, createdAt: ago(8) },
    { firstName: 'John', lastName: 'Example', jobTitle: 'Student', email: 'john@example.com', source: 'Cold outreach', status: 'Unqualified', disqualReason: 'No need', firstContactedAt: ago(19), ownerId: me, isSample: true, createdAt: ago(20) },
    { firstName: 'Fatima', lastName: 'Example', companyName: 'Sample: Palm Logistics', jobTitle: 'Head of Operations', email: 'fatima@example.com', phone: '+971500000606', source: 'LinkedIn', status: 'Contacted', firstContactedAt: ago(1), ownerId: me, isSample: true, createdAt: ago(2) },
  ]);
  await db.update(schema.companies).set({ parentId: cos[0].id }).where(eq(schema.companies.id, cos[3].id));
  await db.update(schema.deals).set({ distributorId: cos[4].id, dealRegNumber: 'DR-77310', dealRegExpiry: iso(12), forecastCategory: 'Commit' }).where(eq(schema.deals.id, dls[0].id));
  await db.update(schema.deals).set({ forecastCategory: 'Best case' }).where(eq(schema.deals.id, dls[1].id));
  await db.update(schema.deals).set({ forecastCategory: 'Commit' }).where(eq(schema.deals.id, dls[4].id));
  await db.insert(schema.dealContacts).values([{ dealId: dls[0].id, contactId: cts[0].id, role: 'Decision maker' }, { dealId: dls[0].id, contactId: ctsDist[0].id, role: 'Distributor contact' }]).onConflictDoNothing();
  await sampleTickets(me, cts, cos, prods);
  await sampleExtras(me, cts, cos, prods);
  await db.execute(sql`update tickets t set contract_id = c.id from support_contracts c where c.company_id = t.company_id and c.start_date <= current_date and c.end_date >= current_date and t.contract_id is null`);
  await db.execute(sql`insert into ticket_time (ticket_id, user_id, minutes, note, billable, date) select id, ${me}, 150, 'Sample: remote session', true, current_date from tickets where contract_id is not null and is_sample`);
  console.log('Loaded sample data (marked "Sample:"). Remove it any time in Settings → Data.');
  await client.end();
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
