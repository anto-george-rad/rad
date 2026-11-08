import 'server-only';
import { db, schema } from '@/db';

/** In-app notification for one or more users (skips empty ids and duplicates). */
export async function notify(userIds: (string | null | undefined)[], title: string, body?: string, href?: string) {
  const ids = Array.from(new Set(userIds.filter(Boolean) as string[]));
  if (ids.length) await db.insert(schema.notifications).values(ids.map((userId) => ({ userId, title, body, href })));
}
