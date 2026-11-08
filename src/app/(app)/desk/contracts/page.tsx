import { asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { contractEconomics, contractMinutes } from '@/lib/contracts';
import { ContractsView } from '@/components/desk/contracts';

export const metadata = { title: 'Support contracts' };
export default async function Page({ searchParams }: { searchParams: { id?: string } }) {
  await requireDeskPage(); const s = await getSettings(); const C = schema.supportContracts;
  const [rows, policies, tix] = await Promise.all([
    db.select({ c: C, company: schema.companies.name }).from(C).leftJoin(schema.companies, eq(schema.companies.id, C.companyId)).orderBy(desc(C.endDate)),
    db.select({ id: schema.slaPolicies.id, name: schema.slaPolicies.name }).from(schema.slaPolicies).orderBy(asc(schema.slaPolicies.sortOrder)),
    db.select({ id: schema.tickets.contractId, n: sql<number>`count(*)` }).from(schema.tickets).where(sql`${schema.tickets.contractId} is not null`).groupBy(schema.tickets.contractId),
  ]);
  const used = await contractMinutes(rows.map((r) => r.c.id));
  return <ContractsView focus={searchParams.id || null} costPerHour={s.supportCostPerHour} policies={policies}
    rows={rows.map(({ c, company }) => ({ ...c, companyName: company || '', tickets: Number(tix.find((t) => t.id === c.id)?.n || 0), ...contractEconomics(c, used.get(c.id) || 0, s.supportCostPerHour) }))} />;
}
