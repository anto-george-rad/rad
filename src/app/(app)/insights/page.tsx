import { asc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { buildDataset } from '@/lib/insights-data';
import type { Tile } from '@/lib/insights-defaults';
import Insights from '@/components/insights/insights';
import { requireCrmPage } from '@/lib/auth';
import { taskScope } from '@/lib/visibility';
import { deskCtx, ticketWhere } from '@/lib/desk-access';

export const metadata = { title: 'Insights' };
export default async function InsightsPage() {
  const me = await requireCrmPage(); if (!me.perms.viewInsights) redirect('/');
  const scope = await taskScope(me);
  const deskWhere = me.deskRole === 'none' ? false : ticketWhere(await deskCtx(me));
  const [data, pages] = await Promise.all([buildDataset(scope, deskWhere), db.select().from(schema.reportPages).orderBy(asc(schema.reportPages.sortOrder))]);
  return <Insights data={data} pages={pages.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sortOrder, tiles: p.tiles as Tile[] }))} />;
}
