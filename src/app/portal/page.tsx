import Link from 'next/link';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { BookOpen, LifeBuoy, Search } from 'lucide-react';
import { db, schema } from '@/db';
import { getSettings } from '@/lib/settings';
import { getPortalUser } from '@/lib/portal-auth';

export default async function PortalHome() {
  const A = schema.kbArticles; const pub = and(eq(A.status, 'published'), eq(A.visibility, 'public'));
  const [s, me, cats, top] = await Promise.all([getSettings(), getPortalUser(),
    db.select({ id: schema.kbCategories.id, name: schema.kbCategories.name, description: schema.kbCategories.description, n: sql<number>`(select count(*) from kb_articles a where a.category_id = kb_categories.id and a.status = 'published' and a.visibility = 'public')` }).from(schema.kbCategories).orderBy(asc(schema.kbCategories.sortOrder)),
    db.select({ title: A.title, slug: A.slug }).from(A).where(pub).orderBy(desc(A.views)).limit(6)]);
  return <div className="flex flex-col gap-8">
    <section className="rounded-3xl bg-rail px-6 py-12 text-center text-white md:px-12">
      <h1 className="text-balance font-display text-[34px] font-bold leading-tight md:text-[44px]">{me ? `Hello ${me.firstName}, how can we help?` : 'How can we help?'}</h1>
      <p className="mx-auto mt-3 max-w-xl text-[15px] text-[#A3AAC8]">{s.portalWelcome}</p>
      <form action="/portal/kb" className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-white p-1.5 text-ink">
        <Search size={18} className="ml-3 text-faint" /><input name="q" placeholder="Search help articles" aria-label="Search help articles" className="h-11 flex-1 bg-transparent text-[15px] outline-none" />
        <button className="h-11 rounded-xl bg-accent px-5 text-[14px] font-semibold text-accent-ink">Search</button></form>
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <Link href="/portal/new" className="panel flex items-start gap-4 p-6 hover:border-accent/40"><span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent"><LifeBuoy /></span><div><h2 className="font-display text-lg font-bold">Submit a request</h2><p className="text-[13.5px] text-muted">Tell us what’s wrong and we’ll get back to you by email.</p></div></Link>
      <Link href={me ? '/portal/tickets' : '/portal/login'} className="panel flex items-start gap-4 p-6 hover:border-accent/40"><span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent"><BookOpen /></span><div><h2 className="font-display text-lg font-bold">{me ? 'My requests' : 'Track your requests'}</h2><p className="text-[13.5px] text-muted">{me ? 'See updates and reply to our team.' : 'Sign in with the account support set up for you.'}</p></div></Link>
    </div>
    {cats.some((c) => Number(c.n)) && <section><h2 className="mb-3 font-display text-xl font-bold">Browse topics</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cats.filter((c) => Number(c.n)).map((c) => <Link key={c.id} href={`/portal/kb?cat=${c.id}`} className="panel p-5 hover:border-accent/40"><b className="text-[14.5px]">{c.name}</b>{c.description && <p className="mt-1 text-[13px] text-muted">{c.description}</p>}<p className="mt-2 text-xs text-faint">{c.n} articles</p></Link>)}</div></section>}
    {top.length > 0 && <section><h2 className="mb-3 font-display text-xl font-bold">Popular articles</h2><div className="panel">{top.map((a) => <Link key={a.slug} href={`/portal/kb/${a.slug}`} className="block border-b border-line px-5 py-3.5 text-[14px] font-medium last:border-0 hover:bg-raised hover:text-accent">{a.title}</Link>)}</div></section>}
  </div>;
}
