import { desc, gt, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { StatusAdmin } from '@/components/status-page';

export const metadata = { title: 'Status page' };
export default async function Page() {
  await requireDeskPage(); const S = schema.statusIncidents;
  const list = await db.select().from(S).where(or(sql`${S.status} not in ('resolved','completed')`, gt(S.startsAt, new Date(Date.now() - 30 * 864e5)))).orderBy(desc(S.startsAt));
  return <StatusAdmin incidents={list} />;
}
