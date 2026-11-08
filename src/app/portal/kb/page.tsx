import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { search } from '@/lib/list-query';
import { plainExcerpt } from '@/lib/markdown';

export const metadata = { title: 'Help articles' };
export default async function PortalKb({ searchParams }: { searchParams: { q?: string; cat?: string } }) {
  const A = schema.kbArticles; const cat = searchParams.cat && /^[0-9a-f-]{36}$/.test(searchParams.cat) ? searchParams.cat : undefined;
  const [rows, c] = await Promise.all([db.select({ title: A.title, slug: A.slug, body: A.body }).from(A).where(and(eq(A.status, 'published'), eq(A.visibility, 'public'), cat ? eq(A.categoryId, cat) : undefined, search(searchParams.q, [A.title, A.body]))).orderBy(desc(A.views)).limit(100),
    cat ? db.query.kbCategories.findFirst({ where: eq(schema.kbCategories.id, cat) }) : null]);
  return <div>
    <h1 className="font-display text-[28px] font-bold">{c?.name || (searchParams.q ? `Results for “${searchParams.q}”` : 'Help articles')}</h1>
    <form className="my-4 flex max-w-lg gap-2"><input name="q" defaultValue={searchParams.q} placeholder="Search help articles" aria-label="Search" className="inp" /><button className="rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-ink">Search</button></form>
    {rows.length ? <div className="panel">{rows.map((a) => <Link key={a.slug} href={`/portal/kb/${a.slug}`} className="block border-b border-line px-5 py-4 last:border-0 hover:bg-raised"><b className="text-[14.5px]">{a.title}</b><p className="mt-0.5 text-[13px] text-muted">{plainExcerpt(a.body)}…</p></Link>)}</div>
      : <div className="panel p-8 text-center"><p className="text-muted">No articles found.</p><Link href="/portal/new" className="mt-3 inline-block font-semibold text-accent hover:underline">Submit a request instead</Link></div>}
  </div>;
}
