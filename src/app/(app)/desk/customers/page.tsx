import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { deskCtx, ticketWhere } from '@/lib/desk-access';
import { pageOf, PAGE_SIZE, search, type ListParams } from '@/lib/list-query';
import DeskCustomers from '@/components/desk/customers';

export const metadata = { title: 'Customers' };
/** Helpdesk view of customers: people and companies with their ticket counts (no sales data). */
export default async function CustomersPage({ searchParams: p }: { searchParams: ListParams }) {
  const me = await requireDeskPage(); const c = await deskCtx(me); const page = pageOf(p);
  const P = schema.contacts; const T = schema.tickets; const vis = ticketWhere(c) ?? sql`true`;
  const openN = sql<number>`(select count(*) from tickets where tickets.contact_id = contacts.id and status_category <> 'closed' and ${vis})`;
  const allN = sql<number>`(select count(*) from tickets where tickets.contact_id = contacts.id and ${vis})`;
  const where = and(search(p.q, [sql`${P.firstName} || ' ' || coalesce(${P.lastName}, '')`, P.email, P.phone, P.mobile, schema.companies.name]), p.portal ? eq(P.portalEnabled, true) : undefined, p.withTickets ? sql`${allN} > 0` : undefined);
  const [rows, [{ n }]] = await Promise.all([
    db.select({ c: P, company: schema.companies.name, open: openN, all: allN }).from(P).leftJoin(schema.companies, eq(schema.companies.id, P.companyId)).where(where)
      .orderBy(p.sort === 'name' ? asc(P.firstName) : desc(allN), asc(P.firstName)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)` }).from(P).leftJoin(schema.companies, eq(schema.companies.id, P.companyId)).where(where),
  ]);
  return <DeskCustomers rows={rows.map((r) => ({ id: r.c.id, name: [r.c.firstName, r.c.lastName].filter(Boolean).join(' '), email: r.c.email, phone: r.c.mobile || r.c.phone, company: r.company, companyId: r.c.companyId, portal: r.c.portalEnabled, open: Number(r.open), all: Number(r.all) }))} total={Number(n)} page={page} size={PAGE_SIZE} />;
}
