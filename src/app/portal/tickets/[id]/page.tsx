import { notFound } from 'next/navigation';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requirePortalUser, portalCanSee } from '@/lib/portal-auth';
import { getSettings } from '@/lib/settings';
import { PortalTicket } from '@/components/portal';

export const metadata = { title: 'Request' };
export default async function Page({ params }: { params: { id: string } }) {
  const me = await requirePortalUser(); if (!/^[0-9a-f-]{36}$/.test(params.id)) notFound();
  const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, params.id) }); if (!t || !portalCanSee(me, t)) notFound();
  const [threads, s, users, files] = await Promise.all([
    db.select({ id: schema.ticketThreads.id, kind: schema.ticketThreads.kind, body: schema.ticketThreads.body, fromName: schema.ticketThreads.fromName, authorId: schema.ticketThreads.authorId, createdAt: schema.ticketThreads.createdAt, attachmentIds: schema.ticketThreads.attachmentIds }).from(schema.ticketThreads)
      .where(and(eq(schema.ticketThreads.ticketId, t.id), inArray(schema.ticketThreads.kind, ['incoming', 'reply']))).orderBy(asc(schema.ticketThreads.createdAt)),
    getSettings(), db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
    db.select({ id: schema.attachments.id, fileName: schema.attachments.fileName, size: schema.attachments.size, uploadedBy: schema.attachments.uploadedBy }).from(schema.attachments).where(and(eq(schema.attachments.relatedType, 'ticket'), eq(schema.attachments.relatedId, t.id)))]);
  // Customers see their own uploads plus files an agent sent with a public reply — never internal files.
  const shared = new Set(threads.filter((x) => x.kind === 'reply').flatMap((x) => x.attachmentIds));
  const visible = files.filter((f) => !f.uploadedBy || shared.has(f.id)).map(({ uploadedBy: _u, ...f }) => f);
  return <PortalTicket t={{ id: t.id, label: `#${s.ticketPrefix}-${1000 + t.number}`, subject: t.subject, cat: t.statusCategory === 'onhold' && !/customer/i.test((await db.query.ticketStatuses.findFirst({ where: eq(schema.ticketStatuses.id, t.statusId) }))?.name || '') ? 'open' : t.statusCategory, createdAt: t.createdAt, rating: t.rating, merged: !!t.mergedIntoId }} csat={s.csatEnabled}
    threads={threads.map((x) => ({ id: x.id, mine: x.kind === 'incoming', who: x.kind === 'incoming' ? x.fromName || 'You' : (users.find((u) => u.id === x.authorId)?.name.split(' ')[0] || 'Support'), body: x.body, at: x.createdAt, files: visible.filter((f) => x.attachmentIds.includes(f.id)) }))} files={visible.filter((f) => !threads.some((x) => x.attachmentIds.includes(f.id)))} />;
}
