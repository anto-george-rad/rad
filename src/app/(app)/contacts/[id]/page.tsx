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
import { desc } from 'drizzle-orm';
import { ContactDetail } from '@/components/entity-detail';
import { emailRows } from '@/lib/ext-data';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const c = /^[0-9a-f-]{36}$/.test(params.id) ? await db.query.contacts.findFirst({ where: eq(schema.contacts.id, params.id), columns: { firstName: true, lastName: true } }) : null;
  return { title: c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : 'Contact' };
}
export default async function ContactPage({ params }: { params: { id: string } }) {
  const me = await requireCrmPage(); const scope = await taskScope(me);
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const c = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, params.id) }); if (!c) notFound();
  const [company, deals, acts, notes, pipes, files, fav, s] = await Promise.all([
    c.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, c.companyId) }) : null,
    db.select().from(schema.deals).where(eq(schema.deals.contactId, c.id)),
    db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, 'contact'), eq(schema.activities.relatedId, c.id))),
    db.select().from(schema.notes).where(and(eq(schema.notes.relatedType, 'contact'), eq(schema.notes.relatedId, c.id))), getPipelineTree(),
    getAttachments('contact', c.id), isFavorite(me.id, 'contact', c.id), getSettings()]);
  const st = new Map(pipes.flatMap((p) => p.subs.flatMap((sb) => sb.stages.map((x) => [x.id, { name: x.name, type: x.type, pipe: p.name }] as const))));
  const T = schema.tickets;
  const [history, tickets] = await Promise.all([getHistory('contact', c.id), me.deskRole !== 'none' ? db.select({ id: T.id, number: T.number, subject: T.subject, statusCategory: T.statusCategory }).from(T).where(and(ticketWhere(await deskCtx(me)), eq(T.contactId, c.id))).orderBy(desc(T.createdAt)).limit(8) : Promise.resolve([])]);
  const emails = await emailRows({ contactId: c.id });
  return <ContactDetail c={c} company={company ?? null} files={files} fav={fav} history={history} tickets={tickets} emails={emails}
    deals={deals.map((d) => { const x = st.get(d.stageId); return { id: d.id, name: d.name, amount: d.amount, currency: d.currency, base: d.amountBase ?? toBase(d.amount, d.currency, s), type: x?.type || 'open', pipe: x?.pipe || '', stage: x?.name || '' }; })} acts={visibleTasks(acts, scope)} notes={notes} />;
}
