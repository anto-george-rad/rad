import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export const getAttachments = (relatedType: string, relatedId: string) =>
  db.select().from(schema.attachments).where(and(eq(schema.attachments.relatedType, relatedType), eq(schema.attachments.relatedId, relatedId))).orderBy(desc(schema.attachments.createdAt));
export async function isFavorite(userId: string, recordType: string, recordId: string) {
  return (await db.select({ id: schema.favorites.id }).from(schema.favorites).where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.recordType, recordType), eq(schema.favorites.recordId, recordId)))).length > 0;
}
export const getHistory = (recordType: string, recordId: string) =>
  db.select({ id: schema.recordHistory.id, text: schema.recordHistory.text, userId: schema.recordHistory.userId, at: schema.recordHistory.at }).from(schema.recordHistory)
    .where(and(eq(schema.recordHistory.recordType, recordType), eq(schema.recordHistory.recordId, recordId))).orderBy(desc(schema.recordHistory.at)).limit(100);
