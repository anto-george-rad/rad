import { notFound } from 'next/navigation';
import { and, asc, desc, eq, ne, or } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { agents, canAssign, canWorkTicket, deskCtx, loadVisibleTicket, ticketWhere } from '@/lib/desk-access';
import { getAttachments, isFavorite } from '@/lib/records-data';
import { getSettings } from '@/lib/settings';
import { ticketTag } from '@/lib/mail-parse';
import TicketDetail from '@/components/desk/ticket-detail';
import { contractFor } from '@/lib/desk';
import { contractEconomics, contractMinutes } from '@/lib/contracts';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const t = /^[0-9a-f-]{36}$/.test(params.id) ? await db.query.tickets.findFirst({ where: eq(schema.tickets.id, params.id), columns: { number: true, subject: true } }) : null;
  const s = await getSettings();
  return { title: t ? `${ticketTag(s.ticketPrefix, t.number)} ${t.subject}` : 'Ticket' };
}
export default async function TicketPage({ params }: { params: { id: string } }) {
  const me = await requireDeskPage(); const c = await deskCtx(me);
  const t = await loadVisibleTicket(c, params.id); if (!t) notFound();
  const T = schema.tickets;
  const related = or(t.parentId ? eq(T.id, t.parentId) : undefined, eq(T.parentId, t.id), eq(T.mergedIntoId, t.id), t.mergedIntoId ? eq(T.id, t.mergedIntoId) : undefined);
  const [threads, events, time, watchers, files, ag, contact, company, rel, others, policy, fav] = await Promise.all([
    db.select().from(schema.ticketThreads).where(eq(schema.ticketThreads.ticketId, t.id)).orderBy(asc(schema.ticketThreads.createdAt)),
    db.select().from(schema.ticketEvents).where(eq(schema.ticketEvents.ticketId, t.id)).orderBy(desc(schema.ticketEvents.at)),
    db.select().from(schema.ticketTime).where(eq(schema.ticketTime.ticketId, t.id)).orderBy(desc(schema.ticketTime.createdAt)),
    db.select({ u: schema.ticketWatchers.userId }).from(schema.ticketWatchers).where(eq(schema.ticketWatchers.ticketId, t.id)),
    getAttachments('ticket', t.id), agents(),
    t.contactId ? db.query.contacts.findFirst({ where: eq(schema.contacts.id, t.contactId) }) : null,
    t.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, t.companyId) }) : null,
    db.select({ id: T.id, number: T.number, subject: T.subject, statusCategory: T.statusCategory, parentId: T.parentId, mergedIntoId: T.mergedIntoId }).from(T).where(and(ticketWhere(c), related)),
    t.contactId || t.requesterEmail ? db.select({ id: T.id, number: T.number, subject: T.subject, statusCategory: T.statusCategory, createdAt: T.createdAt }).from(T)
      .where(and(ticketWhere(c), ne(T.id, t.id), t.contactId ? eq(T.contactId, t.contactId) : eq(T.requesterEmail, t.requesterEmail!))).orderBy(desc(T.createdAt)).limit(6) : Promise.resolve([]),
    t.slaPolicyId ? db.query.slaPolicies.findFirst({ where: eq(schema.slaPolicies.id, t.slaPolicyId), columns: { name: true } }) : null,
    isFavorite(me.id, 'ticket', t.id),
  ]);
  const deals = me.crmAccess && t.companyId ? await db.select({ id: schema.deals.id, name: schema.deals.name, stageId: schema.deals.stageId, amount: schema.deals.amount, currency: schema.deals.currency }).from(schema.deals)
    .innerJoin(schema.stages, eq(schema.stages.id, schema.deals.stageId)).where(and(eq(schema.deals.companyId, t.companyId), eq(schema.stages.type, 'open'))).limit(5) : [];
  const assignable = ag.filter((a) => canAssign(c, t, a)).map((a) => ({ id: a.id, name: a.name, available: a.available }));
  const canUnassign = canAssign(c, t, null);
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.departmentId, t.departmentId));
  const s = await getSettings();
  const contractRow = t.contractId ? await db.query.supportContracts.findFirst({ where: eq(schema.supportContracts.id, t.contractId) }) : null;
  const lapsed = contractRow ? null : (await contractFor(t.companyId, t.productId)).expired;
  const contractUse = contractRow ? contractEconomics(contractRow, (await contractMinutes([contractRow.id])).get(contractRow.id) || 0, s.supportCostPerHour) : null;
  const lite = { id: T.id, number: T.number, subject: T.subject, statusCategory: T.statusCategory };
  const [master, linked] = await Promise.all([t.incidentId ? db.select(lite).from(T).where(eq(T.id, t.incidentId)).then((r) => r[0] || null) : null, t.isIncident ? db.select(lite).from(T).where(eq(T.incidentId, t.id)).orderBy(desc(T.createdAt)) : Promise.resolve([])]);
  return <TicketDetail ticket={t} threads={threads} events={events} time={time} watching={watchers.some((w) => w.u === me.id)} files={files} fav={fav}
    contact={contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), email: contact.email, phone: contact.mobile || contact.phone, jobTitle: contact.jobTitle, portalEnabled: contact.portalEnabled, portalLastLogin: contact.portalLastLogin, doNotContact: contact.doNotContact } : null}
    company={company ? { id: company.id, name: company.name, tier: company.tier, accountType: company.accountType } : null}
    contract={contractRow && contractUse ? { id: contractRow.id, name: contractRow.name, tier: contractRow.tier, endDate: contractRow.endDate, hoursIncluded: contractRow.hoursIncluded, hours: contractUse.hours, usedPct: contractUse.usedPct } : null} lapsedContract={lapsed}
    incident={{ master, linked }} aiOn={!!process.env.ANTHROPIC_API_KEY}
    related={rel} others={others} deals={deals} policyName={policy?.name || null} canWork={canWorkTicket(c, t)} assignable={assignable} canUnassign={canUnassign} teams={teams}
    userNames={Object.fromEntries((await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)).map((u) => [u.id, u.name]))} />;
}
