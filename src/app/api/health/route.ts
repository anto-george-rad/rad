import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const dynamic = 'force-dynamic';
/** Used by Docker's healthcheck and uptime monitors: 200 only when the database answers. */
export async function GET() {
  const t = Date.now();
  try { await db.execute(sql`select 1`); return Response.json({ ok: true, db: 'up', ms: Date.now() - t }); }
  catch { return Response.json({ ok: false, db: 'down' }, { status: 503 }); }
}
