import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { KbEditor } from '@/components/desk/kb';

export const metadata = { title: 'Article' };
export default async function KbArticlePage({ params }: { params: { id: string } }) {
  const me = await requireDeskPage();
  const cats = await db.select().from(schema.kbCategories).orderBy(asc(schema.kbCategories.sortOrder));
  if (params.id === 'new') { if (me.deskRole === 'light') notFound(); return <KbEditor a={null} cats={cats} />; }
  if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const a = await db.query.kbArticles.findFirst({ where: eq(schema.kbArticles.id, params.id) }); if (!a) notFound();
  if (me.deskRole === 'light' && a.status !== 'published') notFound();
  return <KbEditor a={a} cats={cats} />;
}
