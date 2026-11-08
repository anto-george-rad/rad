import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { renderMarkdown } from '@/lib/markdown';
import { ArticleVote } from '@/components/portal';

async function load(slug: string) { const A = schema.kbArticles; return db.query.kbArticles.findFirst({ where: and(eq(A.slug, slug), eq(A.status, 'published'), eq(A.visibility, 'public')) }); }
export async function generateMetadata({ params }: { params: { slug: string } }) { const a = await load(params.slug); return { title: a?.title || 'Article' }; }
export default async function PortalArticle({ params }: { params: { slug: string } }) {
  const a = await load(params.slug); if (!a) notFound();
  await db.update(schema.kbArticles).set({ views: sql`${schema.kbArticles.views} + 1` }).where(eq(schema.kbArticles.id, a.id));
  return <article className="panel p-6 md:p-10">
    <Link href="/portal/kb" className="text-[13px] font-semibold text-muted hover:text-ink">← Help articles</Link>
    <h1 className="mt-3 text-balance font-display text-[30px] font-bold leading-tight">{a.title}</h1>
    <p className="mt-1 text-xs text-faint">Updated {a.updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <div className="prose-rad mt-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body) }} />
    <ArticleVote slug={a.slug} />
  </article>;
}
