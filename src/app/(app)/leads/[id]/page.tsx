import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { getHistory } from '@/lib/records-data';
import { sql } from 'drizzle-orm';
import { taskScope, visibleTasks } from '@/lib/visibility';
import { getScoringRules } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { scoreLead } from '@/lib/scoring';
import { getAttachments, isFavorite } from '@/lib/records-data';
import LeadDetail from '@/components/lead-detail';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const l = /^[0-9a-f-]{36}$/.test(params.id) ? await db.query.leads.findFirst({ where: eq(schema.leads.id, params.id), columns: { firstName: true, lastName: true } }) : null;
  return { title: l ? [l.firstName, l.lastName].filter(Boolean).join(' ') : 'Lead' };
}
export default async function LeadPage({ params }: { params: { id: string } }) {
  const me = await requireCrmPage(); const scope = await taskScope(me);
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, params.id) }); if (!lead) notFound();
  const [rules, s, acts, notes, files, fav] = await Promise.all([getScoringRules(), getSettings(),
    db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, 'lead'), eq(schema.activities.relatedId, lead.id))),
    db.select().from(schema.notes).where(and(eq(schema.notes.relatedType, 'lead'), eq(schema.notes.relatedId, lead.id))), getAttachments('lead', lead.id), isFavorite(me.id, 'lead', lead.id)]);
  const [mc, mco, history] = await Promise.all([
    lead.email ? db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${lead.email.toLowerCase()}`, columns: { firstName: true, lastName: true } }) : null,
    lead.companyName ? db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${lead.companyName.toLowerCase()}`, columns: { name: true } }) : null, getHistory('lead', lead.id)]);
  const sc = scoreLead(lead, rules);
  return <LeadDetail lead={lead} score={sc.score} hits={sc.hits} hot={s.hotScore} warm={s.warmScore} acts={visibleTasks(acts, scope)} notes={notes} files={files} fav={fav} matches={{ contact: mc ?? null, company: mco ?? null }} history={history} />;
}
