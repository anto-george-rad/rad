import { healthFor } from '@/lib/health';
import { asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { all, pageOf, PAGE_SIZE, search, viewsFor, type ListParams } from '@/lib/list-query';
import { CompaniesView } from '@/components/people';

export const metadata = { title: 'Companies' };
const CO = schema.companies;
export default async function CompaniesPage({ searchParams: p }: { searchParams: ListParams }) {
  const me = await requireCrmPage(); const page = pageOf(p); const s = await getSettings();
  // AED value of a deal, using the rates in Settings (numbers only, so safe to inline).
  const rate = sql.raw(`case d.currency ${Object.entries(s.currencies).filter(([k, v]) => /^[A-Z]{3}$/.test(k) && Number.isFinite(+v)).map(([k, v]) => `when '${k}' then ${+v}`).join(' ')} else 1 end`);
  const sum = (type: string) => sql<number>`(select coalesce(sum(coalesce(d.amount_base, d.amount * ${rate})), 0) from deals d join stages st on st.id = d.stage_id where d.company_id = companies.id and st.type = ${type})`;
  const contactsN = sql<number>`(select count(*) from contacts c where c.company_id = companies.id)`;
  const SORTS: Record<string, SQL> = { name: sql`lower(${CO.name})`, type: sql`${CO.accountType}`, emirate: sql`coalesce(${CO.emirate}, '~')`, industry: sql`lower(coalesce(${CO.industry}, '~'))`, contacts: contactsN, open: sum('open'), won: sum('won'), owner: sql`(select lower(name) from users u where u.id = companies.owner_id)` };
  const where = all(p.mine ? eq(CO.ownerId, me.id) : undefined, p.type ? eq(CO.accountType, p.type) : undefined, p.emirate ? eq(CO.emirate, p.emirate) : undefined, p.tier ? eq(CO.tier, p.tier) : undefined,
    p.licence === 'soon' ? sql`${CO.tradeLicenceExpiry} <= current_date + 60` : undefined,
    search(p.q, [CO.name, CO.industry, CO.city, CO.website, CO.vatTrn, CO.tradeLicenceNo]));
  const dir = (p.dir === 'desc' ? desc : asc); const col = SORTS[p.sort || ''] || SORTS.open; const d0 = p.sort ? dir : desc;
  const [rows, [{ c: total }], totals, views] = await Promise.all([
    db.select({ co: CO, contacts: contactsN, open: sum('open'), won: sum('won') }).from(CO).where(where).orderBy(d0(col), asc(CO.name)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ c: sql<number>`count(*)` }).from(CO).where(where),
    db.select({ open: sql<number>`coalesce(sum(${sum('open')}), 0)` }).from(CO).where(where),
    viewsFor(me.id, 'companies'),
  ]);
  const health = await healthFor(rows.map((r) => r.co.id));
  return <CompaniesView companies={rows.map((r) => { const h = health.get(r.co.id); return { ...r.co, contacts: Number(r.contacts), open: Number(r.open), won: Number(r.won), health: h ? { score: h.score, label: h.label, reasons: h.reasons } : undefined }; })} total={Number(total)} page={page} size={PAGE_SIZE} openTotal={Number(totals[0].open)} views={views} />;
}
