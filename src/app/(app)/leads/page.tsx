import { asc, desc, eq, notInArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { getScoringRules } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { scoreLead } from '@/lib/scoring';
import { all, pageOf, PAGE_SIZE, search, viewsFor, type ListParams } from '@/lib/list-query';
import LeadsView from '@/components/leads';

export const metadata = { title: 'Leads' };
const L = schema.leads;
const SORTS: Record<string, SQL> = { name: sql`lower(${L.firstName} || ' ' || coalesce(${L.lastName}, ''))`, company: sql`lower(coalesce(${L.companyName}, '~'))`, status: sql`${L.status}`, source: sql`coalesce(${L.source}, '~')`, added: sql`${L.createdAt}`,
  owner: sql`(select lower(name) from users u where u.id = leads.owner_id)` };
export default async function LeadsPage({ searchParams: p }: { searchParams: ListParams }) {
  const me = await requireCrmPage(); const page = pageOf(p); const tab = p.tab || 'open';
  const base = all(p.mine ? eq(L.ownerId, me.id) : undefined, p.source ? eq(L.source, p.source) : undefined, p.emirate ? eq(L.emirate, p.emirate) : undefined,
    search(p.q, [sql`${L.firstName} || ' ' || coalesce(${L.lastName}, '')`, L.companyName, L.email, L.phone, L.jobTitle, L.campaign]));
  const tabCond = tab === 'all' ? undefined : tab === 'open' ? notInArray(L.status, ['Converted', 'Unqualified']) : eq(L.status, tab as 'New');
  const where = all(base, tabCond);
  const [rules, s, countRows, views] = await Promise.all([getScoringRules(), getSettings(), db.select({ status: L.status, c: sql<number>`count(*)` }).from(L).where(base).groupBy(L.status), viewsFor(me.id, 'leads')]);
  const counts: Record<string, number> = { all: 0, open: 0 };
  for (const r of countRows) { counts[r.status] = Number(r.c); counts.all += Number(r.c); if (!['Converted', 'Unqualified'].includes(r.status)) counts.open += Number(r.c); }
  const total = counts[tab] ?? 0; const dir = p.dir === 'asc' ? asc : desc; const sortKey = p.sort || 'added';
  let rows;
  if (sortKey === 'score') {
    const allRows = (await db.select().from(L).where(where)).map((l) => ({ ...l, score: scoreLead(l, rules).score }));
    allRows.sort((a, b) => (a.score - b.score) * (p.dir === 'asc' ? 1 : -1));
    rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    const col = SORTS[sortKey] || SORTS.added;
    rows = (await db.select().from(L).where(where).orderBy(dir(col), desc(L.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)).map((l) => ({ ...l, score: scoreLead(l, rules).score }));
  }
  const sources = (await db.selectDistinct({ s: L.source }).from(L)).map((x) => x.s).filter(Boolean) as string[];

  return <LeadsView leads={rows} hot={s.hotScore} warm={s.warmScore} total={total} page={page} size={PAGE_SIZE} counts={counts} views={views} sources={sources.sort()} />;
}
