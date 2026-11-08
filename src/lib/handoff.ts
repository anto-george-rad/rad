import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Deal, Ticket } from '@/db/schema';
import { getSettings } from './settings';
import { notify } from './notify';
import { log } from './log';

/** Pure check (unit-tested): does this text ask for something sales should follow up? */
export function wantsSales(text: string, pattern: string) {
  if (!pattern.trim()) return false;
  try { return new RegExp(`\\b(${pattern})\\b`, 'i').test(text); } catch { return false; }
}

/** Helpdesk → sales: a ticket asking about renewal, upgrade or more licences becomes a lead for the account owner (once per ticket). */
export async function ticketHandoff(t: Ticket, text: string) {
  const s = await getSettings();
  if (!s.handoffTicketToLead || t.handoffLeadId || t.isSample || !wantsSales(text, s.handoffKeywords)) return null;
  const [contact, company] = await Promise.all([
    t.contactId ? db.query.contacts.findFirst({ where: eq(schema.contacts.id, t.contactId) }) : null,
    t.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, t.companyId) }) : null,
  ]);
  const ownerId = company?.ownerId || contact?.ownerId || s.leadFormOwnerId || null;
  const { tag, ticketHref, event } = await import('./desk'); const T = await tag(t.number);
  const [first, ...rest] = (t.requesterName || contact?.firstName || 'Support customer').split(' ');
  const [lead] = await db.insert(schema.leads).values({
    firstName: contact?.firstName || first, lastName: contact?.lastName || rest.join(' ') || null, companyName: company?.name || null, email: t.requesterEmail || contact?.email || null,
    phone: t.requesterPhone || contact?.mobile || contact?.phone || null, source: 'Support ticket', ownerId, productInterestId: t.productId, tags: ['from-helpdesk'],
    notes: `Raised in support ticket ${T} — “${t.subject}”.\n\n${text.trim().slice(0, 800)}`,
  }).returning();
  await db.update(schema.tickets).set({ handoffLeadId: lead.id }).where(eq(schema.tickets.id, t.id));
  await event(t.id, null, 'Sales opportunity spotted — lead created for the account owner');
  await notify([ownerId], `Sales lead from support: ${company?.name || lead.firstName}`, `${T}: ${t.subject}`, `/leads/${lead.id}`);
  log.info('handoff_ticket_to_lead', { ticket: t.id, lead: lead.id }); void ticketHref;
  return lead.id;
}

/** Sales → helpdesk: a won deal opens an onboarding ticket in the chosen department (once per deal). */
export async function wonDealHandoff(d: Deal, actorId: string | null) {
  const s = await getSettings(); if (!s.handoffWonToOnboarding || d.isSample) return null;
  const pipe = await db.query.pipelines.findFirst({ where: eq(schema.pipelines.id, d.pipelineId) });
  if (d.dealType === 'Renewal' || /renewal/i.test(pipe?.name || '')) return null; // renewals need no onboarding
  const exists = await db.query.tickets.findFirst({ where: eq(schema.tickets.dealId, d.id), columns: { id: true } }); if (exists) return null;
  const items = await db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, d.id));
  const company = d.companyId ? await db.query.companies.findFirst({ where: eq(schema.companies.id, d.companyId) }) : null;
  const { createTicketInternal } = await import('./desk');
  const t = await createTicketInternal({
    subject: `Onboarding: ${d.name}`, channel: 'internal', departmentId: s.onboardingDepartmentId || null, priority: 'Medium', type: 'Service request', category: 'Installation',
    contactId: d.contactId, companyId: d.companyId, dealId: d.id, productId: items.find((i) => i.productId)?.productId || null, createdBy: actorId, tags: ['onboarding'],
    firstMessage: { kind: 'note', body: `Deal won${company ? ` with ${company.name}` : ''}. Please schedule onboarding.\n\nProducts:\n${items.map((i) => `- ${i.name} × ${i.qty}`).join('\n') || '- (no line items)'}\n\nChecklist:\n- [ ] Kick-off call with the customer\n- [ ] Licences delivered and activated\n- [ ] Installation / configuration done\n- [ ] Admin training\n- [ ] Customer invited to the support portal` },
  });
  await db.insert(schema.dealEvents).values({ dealId: d.id, kind: 'change', text: 'Onboarding ticket opened in the helpdesk' }).catch(() => undefined);
  return t.id;
}
