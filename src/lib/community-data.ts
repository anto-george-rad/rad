import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

/** Topics for the portal (hidden ones excluded) or moderators (all). */
export async function topics(opts: { cat?: string; q?: string; includeHidden: boolean }) {
  const T = schema.forumTopics;
  const where = and(opts.includeHidden ? undefined : eq(T.hidden, false), opts.cat ? eq(T.category, opts.cat) : undefined,
    opts.q?.trim() ? sql`(${T.title} ilike ${'%' + opts.q.trim() + '%'} or ${T.body} ilike ${'%' + opts.q.trim() + '%'})` : undefined);
  const rows = await db.select({ t: T, replies: sql<number>`(select count(*) from forum_posts p where p.topic_id = ${T.id} and not p.hidden)` }).from(T).where(where).orderBy(desc(T.pinned), desc(T.lastPostAt)).limit(200);
  return rows.map(({ t, replies }) => ({ id: t.id, title: t.title, category: t.category, authorName: t.authorName, replies: Number(replies), answered: !!t.answerId, pinned: t.pinned, locked: t.locked, hidden: t.hidden, lastPostAt: t.lastPostAt, views: t.views }));
}
export async function topic(id: string, includeHidden: boolean, viewerContactId: string | null, countView: boolean) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const t = await db.query.forumTopics.findFirst({ where: eq(schema.forumTopics.id, id) }); if (!t || (t.hidden && !includeHidden)) return null;
  if (countView) await db.update(schema.forumTopics).set({ views: sql`${schema.forumTopics.views} + 1` }).where(eq(schema.forumTopics.id, id));
  const posts = await db.select().from(schema.forumPosts).where(and(eq(schema.forumPosts.topicId, id), includeHidden ? undefined : eq(schema.forumPosts.hidden, false))).orderBy(asc(schema.forumPosts.createdAt));
  return { t: { id: t.id, title: t.title, category: t.category, authorName: t.authorName, replies: posts.length, answered: !!t.answerId, pinned: t.pinned, locked: t.locked, hidden: t.hidden, lastPostAt: t.lastPostAt, views: t.views, body: t.body, createdAt: t.createdAt, answerId: t.answerId, mine: !!viewerContactId && t.contactId === viewerContactId },
    posts: posts.map((p) => ({ id: p.id, body: p.body, authorName: p.authorName, agent: !!p.userId, createdAt: p.createdAt, hidden: p.hidden })) };
}
/** Active or upcoming status-page entries (for the portal banner and /status). */
export async function activeIncidents() {
  const S = schema.statusIncidents;
  return db.select().from(S).where(sql`${S.status} not in ('resolved','completed') or ${S.endsAt} > now() - interval '24 hours'`).orderBy(desc(S.startsAt)).limit(20);
}
