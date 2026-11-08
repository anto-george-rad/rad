import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { search } from '@/lib/list-query';

export const dynamic = 'force-dynamic';
/** Public: suggest published help articles while a customer types their subject. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 3) return Response.json({ items: [] });
  const words = q.split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
  const A = schema.kbArticles;
  const rows = await db.select({ title: A.title, slug: A.slug }).from(A).where(and(eq(A.status, 'published'), eq(A.visibility, 'public'), search(words[0] || q, [A.title, A.body]))).orderBy(desc(A.views)).limit(4);
  return Response.json({ items: rows });
}
