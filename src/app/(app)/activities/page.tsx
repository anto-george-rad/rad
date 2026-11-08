import { sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { fullName } from '@/lib/utils';
import { requireCrmPage } from '@/lib/auth';
import { taskScope, visibleTasks } from '@/lib/visibility';
import ActivitiesView from '@/components/activities';

export const metadata = { title: 'Activities' };
export default async function ActivitiesPage() {
  const scope = await taskScope(await requireCrmPage());
  const [acts, deals, leads, contacts, companies] = await Promise.all([db.select().from(schema.activities).where(sql`${schema.activities.done} = false or ${schema.activities.doneAt} > now() - interval '90 days' or ${schema.activities.dueDate} > current_date - 120`),
    db.select({ id: schema.deals.id, name: schema.deals.name }).from(schema.deals), db.select({ id: schema.leads.id, firstName: schema.leads.firstName, lastName: schema.leads.lastName }).from(schema.leads),
    db.select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName }).from(schema.contacts), db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies)]);
  const label = (t: string | null, id: string | null) => t === 'deal' ? deals.find((x) => x.id === id)?.name : t === 'lead' ? fullName(leads.find((x) => x.id === id)) : t === 'contact' ? fullName(contacts.find((x) => x.id === id)) : t === 'company' ? companies.find((x) => x.id === id)?.name : undefined;
  return <ActivitiesView items={visibleTasks(acts, scope).map((a) => ({ ...a, relLabel: label(a.relatedType, a.relatedId) || undefined }))} />;
}
