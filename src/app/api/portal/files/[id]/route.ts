import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getPortalUser, portalCanSee } from '@/lib/portal-auth';
import { readStored } from '@/lib/files';

export const dynamic = 'force-dynamic';
/** Customers download only customer-uploaded files on requests they can see. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await getPortalUser(); if (!me) return new Response('Please sign in.', { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new Response('Not found', { status: 404 });
  const a = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, params.id) });
  if (!a || a.relatedType !== 'ticket') return new Response('Not found', { status: 404 });
  // Agent files are visible only when they were sent with a public reply.
  if (a.uploadedBy && !(await db.query.ticketThreads.findFirst({ where: and(eq(schema.ticketThreads.ticketId, a.relatedId), eq(schema.ticketThreads.kind, 'reply'), sql`${schema.ticketThreads.attachmentIds} @> ${JSON.stringify([a.id])}::jsonb`), columns: { id: true } }))) return new Response('Not found', { status: 404 });
  const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, a.relatedId) }); if (!t || !portalCanSee(me, t)) return new Response('Not found', { status: 404 });
  const buf = await readStored(a.storageKey).catch(() => null); if (!buf) return new Response('Missing', { status: 410 });
  return new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`, 'x-content-type-options': 'nosniff' } });
}
