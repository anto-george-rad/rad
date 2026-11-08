import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { deskCtx, ticketWhere } from '@/lib/desk-access';
import { CustomerContact, CustomerCompany } from '@/components/desk/customers';
import { contractViews, licenceRows, supportStats } from '@/lib/ext-data';
import { healthFor } from '@/lib/health';

export const metadata = { title: 'Customer' };
export default async function CustomerPage({ params }: { params: { id: string } }) {
  const me = await requireDeskPage(); const c = await deskCtx(me); const T = schema.tickets;
  const isCo = params.id.startsWith('c-'); const id = isCo ? params.id.slice(2) : params.id;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const cols = { id: T.id, number: T.number, subject: T.subject, statusCategory: T.statusCategory, priority: T.priority, createdAt: T.createdAt, rating: T.rating };
  if (isCo) {
    const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, id) }); if (!co) notFound();
    const [people, tickets] = await Promise.all([db.select().from(schema.contacts).where(eq(schema.contacts.companyId, co.id)), db.select(cols).from(T).where(and(ticketWhere(c), eq(T.companyId, co.id))).orderBy(desc(T.createdAt)).limit(100)]);
    const [contracts, licences, support, health] = await Promise.all([contractViews(co.id), licenceRows(eq(schema.licences.companyId, co.id)), supportStats(co.id), healthFor([co.id])]); const h = health.get(co.id)!;
    return <CustomerCompany health={{ score: h.score, label: h.label, reasons: h.reasons }} contracts={contracts} licences={licences} support={support} co={{ id: co.id, name: co.name, tier: co.tier, accountType: co.accountType, phone: co.phone, website: co.website, emirate: co.emirate }} people={people.map((p) => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(' '), email: p.email, jobTitle: p.jobTitle, portal: p.portalEnabled }))} tickets={tickets} />;
  }
  const ct = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, id) }); if (!ct) notFound();
  const [co, tickets] = await Promise.all([ct.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, ct.companyId), columns: { id: true, name: true, tier: true } }) : null,
    db.select(cols).from(T).where(and(ticketWhere(c), eq(T.contactId, ct.id))).orderBy(desc(T.createdAt)).limit(100)]);
  return <CustomerContact ct={{ id: ct.id, name: [ct.firstName, ct.lastName].filter(Boolean).join(' '), email: ct.email, phone: ct.phone, mobile: ct.mobile, jobTitle: ct.jobTitle, portalEnabled: ct.portalEnabled, portalCompanyAccess: ct.portalCompanyAccess, portalLastLogin: ct.portalLastLogin, language: ct.language }}
    company={co ?? null} tickets={tickets} />;
}
