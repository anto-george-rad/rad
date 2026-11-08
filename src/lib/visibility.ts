import 'server-only';
import { db, schema } from '@/db';
import type { SessionUser } from './auth';

/**
 * Whose tasks this user may see.
 * - Admins: everyone (returns null = no restriction).
 * - Everyone else: themselves plus everyone who reports to them, directly or through
 *   other managers. Someone with no reports sees only their own tasks.
 */
export async function taskScope(me: SessionUser): Promise<Set<string> | null> {
  if (me.role === 'admin') return null;
  const users = await db.select({ id: schema.users.id, managerId: schema.users.managerId }).from(schema.users);
  return computeScope(users, me.id);
}
/** Pure part of taskScope: the person plus everyone below them in the reporting line. */
export function computeScope(users: { id: string; managerId: string | null }[], meId: string) {
  const scope = new Set<string>([meId]);
  let added = true;
  while (added) { added = false; for (const u of users) if (u.managerId && scope.has(u.managerId) && !scope.has(u.id)) { scope.add(u.id); added = true; } }
  return scope;
}
/** Unassigned tasks are visible to everyone. */
export const canSeeTask = (scope: Set<string> | null, ownerId: string | null | undefined) => !scope || !ownerId || scope.has(ownerId);
export const visibleTasks = <T extends { ownerId: string | null }>(rows: T[], scope: Set<string> | null) => rows.filter((r) => canSeeTask(scope, r.ownerId));
