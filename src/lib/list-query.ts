import 'server-only';
import { and, desc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db, schema } from '@/db';

export const PAGE_SIZE = 50;
export type ListParams = { q?: string; page?: string; sort?: string; dir?: string; [k: string]: string | undefined };
export const pageOf = (p: ListParams) => Math.max(1, Math.floor(+(p.page || 1)) || 1);
/** Case-insensitive "contains" over several columns, safe for user input. */
export function search(q: string | undefined, cols: SQLWrapper[]) {
  const s = (q || '').trim(); if (!s) return undefined;
  const like = `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  return sql`(${sql.join(cols.map((c) => sql`coalesce(${c}, '') ilike ${like}`), sql` or `)})`;
}
export const all = (...w: (SQL | undefined)[]) => { const x = w.filter(Boolean) as SQL[]; return x.length ? and(...x) : undefined; };
export async function viewsFor(userId: string, page: string) {
  return db.select({ id: schema.savedViews.id, name: schema.savedViews.name, query: schema.savedViews.query }).from(schema.savedViews)
    .where(and(eq(schema.savedViews.userId, userId), eq(schema.savedViews.page, page))).orderBy(desc(schema.savedViews.createdAt));
}
