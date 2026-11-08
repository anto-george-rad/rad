import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSettings } from '@/lib/settings';
import { LeadFormPublic } from '@/components/lead-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contact us' };
export default async function Page() {
  const s = await getSettings(); if (!s.leadFormEnabled) notFound();
  const prods = await db.select({ name: schema.products.name }).from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.name));
  return <div className="min-h-dvh bg-bg px-4 py-8"><div className="panel mx-auto max-w-xl p-6"><LeadFormPublic orgName={s.orgName} products={prods.map((p) => p.name.replace(/^Sample:\s*/, ''))} /></div></div>;
}
