import { asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { all, pageOf, PAGE_SIZE, search, viewsFor, type ListParams } from '@/lib/list-query';
import { PeopleView } from '@/components/people';

export const metadata = { title: 'Contacts' };
const C = schema.contacts;
const SORTS: Record<string, SQL> = {
  name: sql`lower(${C.firstName} || ' ' || coalesce(${C.lastName}, ''))`, company: sql`(select lower(name) from companies co where co.id = contacts.company_id)`, email: sql`lower(coalesce(${C.email}, '~'))`,
  last: sql`${C.lastContactedAt}`, owner: sql`(select lower(name) from users u where u.id = contacts.owner_id)`, added: sql`${C.createdAt}`,
};
export default async function ContactsPage({ searchParams: p }: { searchParams: ListParams }) {
  const me = await requireCrmPage(); const page = pageOf(p);
  const where = all(p.mine ? eq(C.ownerId, me.id) : undefined, p.company ? eq(C.companyId, p.company) : undefined, p.role ? eq(C.buyingRole, p.role) : undefined,
    p.tag ? sql`${C.tags} @> ${JSON.stringify([p.tag])}::jsonb` : undefined, p.product ? sql`${C.productIds} @> ${JSON.stringify([p.product])}::jsonb` : undefined,
    p.type ? sql`${C.companyId} in (select id from companies where account_type = ${p.type})` : undefined,
    search(p.q, [sql`${C.firstName} || ' ' || coalesce(${C.lastName}, '')`, C.email, C.phone, C.mobile, C.jobTitle, sql`(select name from companies co where co.id = contacts.company_id)`]));
  const dir = (p.dir === 'desc' ? desc : asc); const col = SORTS[p.sort || 'name'] || SORTS.name;
  const [rows, [{ c: total }], tagRows, views] = await Promise.all([
    db.select({ c: C, companyName: schema.companies.name, companyType: schema.companies.accountType }).from(C).leftJoin(schema.companies, eq(schema.companies.id, C.companyId)).where(where).orderBy(dir(col), asc(C.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ c: sql<number>`count(*)` }).from(C).where(where),
    db.execute(sql`select distinct jsonb_array_elements_text(tags) as t from contacts order by 1`),
    viewsFor(me.id, 'contacts'),
  ]);
  const ids = rows.map((r) => r.c.id);
  const open = ids.length ? await db.select({ id: schema.deals.contactId, c: sql<number>`count(*)` }).from(schema.deals).innerJoin(schema.stages, eq(schema.stages.id, schema.deals.stageId))
    .where(all(inArray(schema.deals.contactId, ids), eq(schema.stages.type, 'open'))).groupBy(schema.deals.contactId) : [];
  return <PeopleView contacts={rows.map((r) => ({ ...r.c, companyName: r.companyName, companyType: r.companyType, openDeals: Number(open.find((o) => o.id === r.c.id)?.c || 0) }))} total={Number(total)} page={page} size={PAGE_SIZE}
    tags={(tagRows as unknown as { t: string }[]).map((r) => r.t)} views={views} />;
}
