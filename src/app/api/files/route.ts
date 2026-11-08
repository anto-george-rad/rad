import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getUser } from '@/lib/auth';
import { MAX_UPLOAD, store } from '@/lib/files';
import { audit } from '@/lib/audit';
import { canUseFilesOf } from '@/lib/file-access';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const TYPES = ['lead', 'deal', 'contact', 'company', 'ticket'] as const;
const TABLE = { lead: schema.leads, deal: schema.deals, contact: schema.contacts, company: schema.companies, ticket: schema.tickets };
const BLOCKED = /\.(exe|bat|cmd|com|scr|msi|js|vbs|ps1|sh|jar|html?|svg)$/i;

export async function POST(req: Request) {
  const me = await getUser(); if (!me) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!rateLimit(`upload:${me.id}`, 60, 10 * 60_000)) return Response.json({ error: 'Too many uploads. Wait a few minutes.' }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file'); const relatedType = String(form?.get('relatedType') || ''); const relatedId = String(form?.get('relatedId') || '');
  if (!(file instanceof File)) return Response.json({ error: 'Choose a file.' }, { status: 400 });
  if (!TYPES.includes(relatedType as never) || !/^[0-9a-f-]{36}$/.test(relatedId)) return Response.json({ error: 'Unknown record.' }, { status: 400 });
  if (!(await canUseFilesOf(me, relatedType, relatedId))) return Response.json({ error: 'You can’t add files to this record.' }, { status: 403 });
  const t = TABLE[relatedType as keyof typeof TABLE];
  const [rec] = await db.select({ id: t.id }).from(t).where(eq(t.id, relatedId)); if (!rec) return Response.json({ error: 'That record no longer exists.' }, { status: 404 });
  if (file.size > MAX_UPLOAD) return Response.json({ error: `${file.name} is over 15 MB.` }, { status: 413 });
  if (BLOCKED.test(file.name)) return Response.json({ error: 'That file type is not allowed. Zip it first if you need to share it.' }, { status: 415 });
  const key = await store(Buffer.from(await file.arrayBuffer()));
  const [row] = await db.insert(schema.attachments).values({ relatedType, relatedId, fileName: file.name.slice(0, 200), mime: file.type || 'application/octet-stream', size: file.size, storageKey: key, uploadedBy: me.id }).returning();
  await audit(me.id, 'file.uploaded', relatedType, relatedId, file.name);
  return Response.json({ ok: true, id: row.id });
}
