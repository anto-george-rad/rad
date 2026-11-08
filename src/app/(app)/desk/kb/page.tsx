import { asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireDeskPage } from '@/lib/auth';
import { search } from '@/lib/list-query';
import KbList from '@/components/desk/kb';

export const metadata = { title: 'Knowledge base' };
export default async function KbPage({ searchParams }: { searchParams: { q?: string; cat?: string } }) {
  const me = await requireDeskPage(); const A = schema.kbArticles;
  // Light agents read published articles; agents also see drafts; everyone sees their own drafts.
  const vis = me.deskRole === 'light' ? eq(A.status, 'published') : undefined;
  const [cats, arts] = await Promise.all([db.select().from(schema.kbCategories).orderBy(asc(schema.kbCategories.sortOrder)),
    db.select({ id: A.id, title: A.title, slug: A.slug, status: A.status, visibility: A.visibility, categoryId: A.categoryId, views: A.views, helpful: A.helpful, notHelpful: A.notHelpful, updatedAt: A.updatedAt, authorId: A.authorId }).from(A)
      .where(sql`${vis ?? sql`true`} and ${search(searchParams.q, [A.title, A.body]) ?? sql`true`} and ${searchParams.cat ? eq(A.categoryId, searchParams.cat) : sql`true`}`).orderBy(desc(A.updatedAt))]);
  return <KbList cats={cats} arts={arts} />;
}
