import { emailRows } from '@/lib/ext-data';
import { notFound } from 'next/navigation';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { taskScope, visibleTasks } from '@/lib/visibility';
import { getPipelineTree } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { getAttachments, isFavorite } from '@/lib/records-data';
import DealDetail from '@/components/deal-detail';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const d = /^[0-9a-f-]{36}$/.test(params.id) ? await db.query.deals.findFirst({ where: eq(schema.deals.id, params.id), columns: { name: true } }) : null;
  return { title: d?.name || 'Deal' };
}
export default async function DealPage({ params }: { params: { id: string } }) {
  const me = await requireCrmPage(); const scope = await taskScope(me);
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const deal = await db.query.deals.findFirst({ where: eq(schema.deals.id, params.id) }); if (!deal) notFound();
  const link = (id: string | null) => id ? db.query.deals.findFirst({ where: eq(schema.deals.id, id), columns: { id: true, name: true } }) : null;
  const [pipes, s, company, contact, items, acts, notes, events, source, renewal, files, fav] = await Promise.all([
    getPipelineTree(), getSettings(),
    deal.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, deal.companyId) }) : null,
    deal.contactId ? db.query.contacts.findFirst({ where: eq(schema.contacts.id, deal.contactId) }) : null,
    db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, deal.id)),
    db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, 'deal'), eq(schema.activities.relatedId, deal.id))),
    db.select().from(schema.notes).where(and(eq(schema.notes.relatedType, 'deal'), eq(schema.notes.relatedId, deal.id))),
    db.select().from(schema.dealEvents).where(eq(schema.dealEvents.dealId, deal.id)).orderBy(asc(schema.dealEvents.at)),
    link(deal.sourceDealId), link(deal.renewalDealId), getAttachments('deal', deal.id), isFavorite(me.id, 'deal', deal.id),
  ]);
  // Partners, people involved, product costs and who handles these products at the distributor.
  const partnerIds = [deal.distributorId, deal.resellerId].filter(Boolean) as string[];
  const [partners, people, costs, handlers] = await Promise.all([
    partnerIds.length ? db.select({ id: schema.companies.id, name: schema.companies.name, accountType: schema.companies.accountType }).from(schema.companies).where(inArray(schema.companies.id, partnerIds)) : [],
    db.select({ id: schema.dealContacts.id, role: schema.dealContacts.role, contactId: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName, jobTitle: schema.contacts.jobTitle, email: schema.contacts.email })
      .from(schema.dealContacts).innerJoin(schema.contacts, eq(schema.contacts.id, schema.dealContacts.contactId)).where(eq(schema.dealContacts.dealId, deal.id)),
    items.length ? db.select({ id: schema.products.id, cost: schema.products.costPrice }).from(schema.products).where(inArray(schema.products.id, items.map((i) => i.productId).filter(Boolean) as string[])) : [],
    deal.distributorId ? db.select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName, productIds: schema.contacts.productIds, email: schema.contacts.email, mobile: schema.contacts.mobile }).from(schema.contacts).where(eq(schema.contacts.companyId, deal.distributorId)) : [],
  ]);
  const pipe = pipes.find((p) => p.id === deal.pipelineId)!; const sub = pipe.subs.find((x) => x.id === deal.subPipelineId)!;
  const emails = await emailRows({ dealId: deal.id });
  return <DealDetail emails={emails} deal={deal} pipe={pipe} sub={sub} company={company ?? null} contact={contact ?? null} items={items} acts={visibleTasks(acts, scope)} notes={notes} events={events}
    rate={s.currencies[deal.currency] || 1} source={source ?? null} renewal={renewal ?? null} files={files} fav={fav} minMargin={s.minMarginPct}
    distributor={partners.find((x) => x.id === deal.distributorId) ?? null} reseller={partners.find((x) => x.id === deal.resellerId) ?? null}
    people={people} costs={me.perms.viewCost ? Object.fromEntries(costs.map((c) => [c.id, c.cost])) : {}} handlers={handlers.filter((h) => h.productIds.some((pid) => items.some((i) => i.productId === pid)))} />;
}
