import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getPortalUser } from '@/lib/portal-auth';
import { getSettings } from '@/lib/settings';
import { PortalNewTicket } from '@/components/portal';
export const metadata = { title: 'Submit a request' };
export default async function Page() {
  const [me, s, products, deps] = await Promise.all([getPortalUser(), getSettings(), db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.name)),
    db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.active, true)).orderBy(asc(schema.departments.sortOrder))]);
  if (!me && !s.webFormEnabled) return <div className="panel p-8 text-center"><h1 className="font-display text-2xl font-bold">Contact support</h1><p className="mt-2 text-muted">Please email {s.email || 'our support team'} or sign in to open a request.</p></div>;
  return <PortalNewTicket signedIn={!!me} name={me ? [me.firstName, me.lastName].filter(Boolean).join(' ') : ''} products={products} departments={deps} />;
}
