import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { taskScope, visibleTasks } from '@/lib/visibility';
import { getPipelineTree } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { toBase } from '@/lib/settings-defaults';
import { getAttachments, getHistory, isFavorite } from '@/lib/records-data';
import { deskCtx, ticketWhere } from '@/lib/desk-access';
import { desc, inArray, or } from 'drizzle-orm';
import { CompanyDetail } from '@/components/entity-detail';
import { contractViews, emailRows, licenceRows, supportStats } from '@/lib/ext-data';
import { healthFor } from '@/lib/health';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const c = /^[0-9a-f-]{36}$/.test(params.id) ? await db.query.companies.findFirst({ where: eq(schema.companies.id, params.id), columns: { name: true } }) : null;
  return { title: c?.name || 'Company' };
}
export default async function CompanyPage({ params }: { params: { id: string } }) {
  const me = await requireCrmPage(); const scope = await taskScope(me);
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const c = await db.query.companies.findFirst({ where: eq(schema.companies.id, params.id) }); if (!c) notFound();
  const [people, deals, acts, notes, pipes, files, fav, s] = await Promise.all([
    db.select().from(schema.contacts).where(eq(schema.contacts.companyId, c.id)), db.select().from(schema.deals).where(eq(schema.deals.companyId, c.id)),
    db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, 'company'), eq(schema.activities.relatedId, c.id))),
    db.select().from(schema.notes).where(and(eq(schema.notes.relatedType, 'company'), eq(schema.notes.relatedId, c.id))), getPipelineTree(),
    getAttachments('company', c.id), isFavorite(me.id, 'company', c.id), getSettings()]);
  const st = new Map(pipes.flatMap((p) => p.subs.flatMap((sb) => sb.stages.map((x) => [x.id, { name: x.name, type: x.type, pipe: p.name }] as const))));
  const D = schema.deals; const T = schema.tickets;
  const [parent, subs, partnerDeals, history, tickets] = await Promise.all([
    c.parentId ? db.query.companies.findFirst({ where: eq(schema.companies.id, c.parentId), columns: { id: true, name: true } }) : null,
    db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.parentId, c.id)),
    db.select().from(D).where(or(eq(D.distributorId, c.id), eq(D.resellerId, c.id))),
    getHistory('company', c.id),
    me.deskRole !== 'none' ? db.select({ id: T.id, number: T.number, subject: T.subject, statusCategory: T.statusCategory }).from(T).where(and(ticketWhere(await deskCtx(me)), eq(T.companyId, c.id))).orderBy(desc(T.createdAt)).limit(8) : Promise.resolve([]),
  ]);
  const [licences, contracts, emails, support, health] = await Promise.all([licenceRows(eq(schema.licences.companyId, c.id)), contractViews(c.id), emailRows({ companyId: c.id }), supportStats(c.id), healthFor([c.id])]);
  const h = health.get(c.id)!;
  const subDeals = subs.length ? await db.select().from(D).where(inArray(D.companyId, subs.map((x) => x.id))) : [];
  const lite = (d: typeof deals[number]) => { const x = st.get(d.stageId); return { id: d.id, name: d.name, amount: d.amount, currency: d.currency, base: d.amountBase ?? toBase(d.amount, d.currency, s), type: x?.type || 'open', pipe: x?.pipe || '', stage: x?.name || '' }; };
  return <CompanyDetail c={c} people={people} files={files} fav={fav} parent={parent ?? null} subs={subs} partnerDeals={partnerDeals.map((d) => ({ ...lite(d), role: d.distributorId === c.id ? 'Distributor' : 'Reseller' }))}
    groupTotals={subs.length ? { open: subDeals.filter((d) => st.get(d.stageId)?.type === 'open').reduce((a, d) => a + toBase(d.amount, d.currency, s), 0), won: subDeals.filter((d) => st.get(d.stageId)?.type === 'won').reduce((a, d) => a + (d.amountBase ?? toBase(d.amount, d.currency, s)), 0) } : null}
    history={history} tickets={tickets} licences={licences} contracts={contracts} emails={emails} support={support} health={{ score: h.score, label: h.label, reasons: h.reasons }}
    deals={deals.map((d) => { const x = st.get(d.stageId); return { id: d.id, name: d.name, amount: d.amount, currency: d.currency, base: d.amountBase ?? toBase(d.amount, d.currency, s), type: x?.type || 'open', pipe: x?.pipe || '', stage: x?.name || '' }; })} acts={visibleTasks(acts, scope)} notes={notes} />;
}
