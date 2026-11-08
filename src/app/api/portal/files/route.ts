import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getPortalUser, portalCanSee } from '@/lib/portal-auth';
import { store } from '@/lib/files';
import { rateLimit } from '@/lib/rate-limit';
import { event } from '@/lib/desk';

export const dynamic = 'force-dynamic';
const MAX = 10 * 1024 * 1024;
const OK = /\.(pdf|png|jpe?g|gif|webp|txt|log|csv|docx?|xlsx?|pptx?|zip|7z|eml|msg|json|xml|cfg|conf)$/i;
/** Customers attach files to their own requests (stored with no uploader = visible to the customer). */
export async function POST(req: Request) {
  const me = await getPortalUser(); if (!me) return Response.json({ error: 'Please sign in.' }, { status: 401 });
  if (!rateLimit(`pfile:${me.id}`, 20, 60 * 60_000)) return Response.json({ error: 'Too many uploads. Try again later.' }, { status: 429 });
  const form = await req.formData().catch(() => null); const f = form?.get('file'); const id = String(form?.get('ticketId') || '');
  if (!(f instanceof File)) return Response.json({ error: 'Choose a file.' }, { status: 400 });
  const t = /^[0-9a-f-]{36}$/.test(id) ? await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) }) : null;
  if (!t || !portalCanSee(me, t)) return Response.json({ error: 'Request not found.' }, { status: 404 });
  if (f.size > MAX) return Response.json({ error: `${f.name} is over 10 MB.` }, { status: 413 });
  if (!OK.test(f.name)) return Response.json({ error: 'That file type isn’t accepted. Use PDF, images, Office files, text logs or ZIP.' }, { status: 415 });
  const key = await store(Buffer.from(await f.arrayBuffer()));
  await db.insert(schema.attachments).values({ relatedType: 'ticket', relatedId: t.id, fileName: f.name.slice(0, 200), mime: f.type || 'application/octet-stream', size: f.size, storageKey: key, uploadedBy: null });
  await event(t.id, null, `${me.firstName} attached ${f.name.slice(0, 80)} in the portal`);
  await db.update(schema.tickets).set({ updatedAt: new Date() }).where(eq(schema.tickets.id, t.id));
  return Response.json({ ok: true });
}
