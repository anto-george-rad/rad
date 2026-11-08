import 'server-only';
import { db, schema } from '@/db';
import { log } from './log';

export async function audit(userId: string | null, action: string, entity?: string, entityId?: string | null, detail?: string) {
  try { await db.insert(schema.auditLog).values({ userId, action, entity, entityId: entityId ?? null, detail }); }
  catch (e) { log.error('audit_failed', { action, error: String(e) }); }
}
