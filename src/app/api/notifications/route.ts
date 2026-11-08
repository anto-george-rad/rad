import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export async function GET() {
  const me = await getUser(); if (!me) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const [items, unread] = await Promise.all([
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, me.id)).orderBy(desc(schema.notifications.createdAt)).limit(30),
    db.select({ c: sql<number>`count(*)` }).from(schema.notifications).where(and(eq(schema.notifications.userId, me.id), isNull(schema.notifications.readAt))),
  ]);
  return Response.json({ items, unread: Number(unread[0].c) });
}
