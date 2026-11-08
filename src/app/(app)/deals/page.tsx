import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getPipelineTree } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { toBase } from '@/lib/settings-defaults';
import DealsView from '@/components/deals';
import { requireCrmPage } from '@/lib/auth';
import { canSeeTask, taskScope } from '@/lib/visibility';

export const metadata = { title: 'Deals' };
/** Board and list show open deals plus deals closed in the last 90 days (all closed with ?closed=all), so the page stays fast as history grows. */
export default async function DealsPage({ searchParams }: { searchParams: { p?: string; s?: string; closed?: string } }) {
  const me = await requireCrmPage();
  const pipes = await getPipelineTree();
  const pipe = pipes.find((p) => p.id === searchParams.p) || pipes[0];
  if (!pipe) return <DealsView pipe={null} sub={null} deals={[]} hiddenClosed={0} />;
  const sub = pipe.subs.find((s) => s.id === searchParams.s) || pipe.subs[0];
  const D = schema.deals; const allClosed = searchParams.closed === 'all';
  const base = and(eq(D.pipelineId, pipe.id), eq(D.subPipelineId, sub.id));
  const recent = or(isNull(D.closedAt), gte(D.closedAt, sql`now() - interval '90 days'`));
  const [deals, s, hidden] = await Promise.all([
    db.select({ d: D, companyName: schema.companies.name }).from(D).leftJoin(schema.companies, eq(schema.companies.id, D.companyId)).where(allClosed ? base : and(base, recent)),
    getSettings(), allClosed ? Promise.resolve([{ c: 0 }]) : db.select({ c: sql<number>`count(*)` }).from(D).where(and(base, sql`${D.closedAt} < now() - interval '90 days'`)),
  ]);
  const scope = await taskScope(me);
  const ids = deals.map((d) => d.d.id);
  const acts = ids.length ? await db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, 'deal'), inArray(schema.activities.relatedId, ids), eq(schema.activities.done, false))) : [];
  const rows = deals.map(({ d, companyName }) => {
    const next = acts.filter((a) => a.relatedId === d.id).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'))[0];
    return { ...d, base: d.amountBase ?? toBase(d.amount, d.currency, s), companyName, next: next ? { title: canSeeTask(scope, next.ownerId) ? next.title : 'Scheduled by a colleague', dueDate: next.dueDate } : null };
  });
  return <DealsView pipe={pipe} sub={sub} deals={rows} hiddenClosed={Number(hidden[0].c)} />;
}
