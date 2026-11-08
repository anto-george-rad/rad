import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getUser } from '@/lib/auth';
import { readStored } from '@/lib/files';
import { canUseFilesOf } from '@/lib/file-access';

export const dynamic = 'force-dynamic';
const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const me = await getUser(); if (!me) return new Response('Sign in first.', { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(params.id)) return new Response('Not found', { status: 404 });
  const a = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, params.id) }); if (!a) return new Response('Not found', { status: 404 });
  if (!(await canUseFilesOf(me, a.relatedType, a.relatedId))) return new Response('Not found', { status: 404 });
  const buf = await readStored(a.storageKey).catch(() => null); if (!buf) return new Response('The file is missing from storage.', { status: 410 });
  const download = new URL(req.url).searchParams.has('download') || !INLINE.test(a.mime);
  return new Response(buf, { headers: {
    'content-type': INLINE.test(a.mime) ? a.mime : 'application/octet-stream', 'content-length': String(buf.length),
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'cache-control': 'private, max-age=0',
  } });
}
