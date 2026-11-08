import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getUser } from '@/lib/auth';
import { deskCtx, loadVisibleTicket } from '@/lib/desk-access';

export const dynamic = 'force-dynamic';
/** Collision detection: records that I have the ticket open (and whether I'm typing a reply) and returns who else does. */
export async function POST(req: Request) {
  const me = await getUser(); if (!me || me.deskRole === 'none') return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { ticketId?: string; replying?: boolean; leave?: boolean };
  const t = b.ticketId ? await loadVisibleTicket(await deskCtx(me), b.ticketId) : null; if (!t) return Response.json({ error: 'Not found' }, { status: 404 });
  if (b.leave) await db.delete(schema.ticketPresence).where(and(eq(schema.ticketPresence.ticketId, t.id), eq(schema.ticketPresence.userId, me.id)));
  else await db.insert(schema.ticketPresence).values({ ticketId: t.id, userId: me.id, replying: !!b.replying, at: new Date() })
    .onConflictDoUpdate({ target: [schema.ticketPresence.ticketId, schema.ticketPresence.userId], set: { replying: !!b.replying, at: new Date() } });
  const others = await db.select({ userId: schema.ticketPresence.userId, replying: schema.ticketPresence.replying, name: schema.users.name }).from(schema.ticketPresence)
    .innerJoin(schema.users, eq(schema.users.id, schema.ticketPresence.userId)).where(and(eq(schema.ticketPresence.ticketId, t.id), ne(schema.ticketPresence.userId, me.id), gt(schema.ticketPresence.at, sql`now() - interval '45 seconds'`)));
  return Response.json({ others, updatedAt: t.updatedAt });
}
