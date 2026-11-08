import Link from 'next/link';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requirePortalUser } from '@/lib/portal-auth';
import { getSettings } from '@/lib/settings';

export const metadata = { title: 'My requests' };
export default async function PortalTickets() {
  const me = await requirePortalUser(); const T = schema.tickets; const s = await getSettings();
  const who = me.portalCompanyAccess && me.companyId ? or(eq(T.contactId, me.id), eq(T.companyId, me.companyId)) : eq(T.contactId, me.id);
  const rows = await db.select({ id: T.id, number: T.number, subject: T.subject, cat: T.statusCategory, statusName: schema.ticketStatuses.name, updatedAt: T.updatedAt, requester: T.requesterName, contactId: T.contactId }).from(T).leftJoin(schema.ticketStatuses, eq(schema.ticketStatuses.id, T.statusId)).where(and(who, eq(T.isSpam, false), isNull(T.mergedIntoId))).orderBy(desc(T.updatedAt)).limit(200);
  return <div>
    <div className="mb-4 flex flex-wrap items-end gap-3"><h1 className="flex-1 font-display text-[28px] font-bold">My requests</h1><Link href="/portal/new" className="rounded-lg bg-accent px-4 py-2 text-[13.5px] font-semibold text-accent-ink">Submit a request</Link></div>
    {me.portalCompanyAccess && <p className="mb-3 text-[13px] text-muted">Showing requests from everyone at your company.</p>}
    {rows.length ? <div className="panel">{rows.map((t) => <Link key={t.id} href={`/portal/tickets/${t.id}`} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4 last:border-0 hover:bg-raised">
      <span className="num text-xs text-muted">#{s.ticketPrefix}-{1000 + t.number}</span><span className="min-w-0 flex-1 truncate font-semibold">{t.subject}</span>
      {t.contactId !== me.id && <span className="text-xs text-muted">{t.requester}</span>}
      <span className={`chip ${t.cat === 'closed' ? 'bg-good-soft text-good' : t.cat === 'onhold' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'}`}>{t.cat === 'closed' ? 'Resolved' : t.cat === 'onhold' ? (/customer/i.test(t.statusName || '') ? 'Awaiting your reply' : 'In progress') : 'Open'}</span>
      <span className="text-xs text-faint">{t.updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></Link>)}</div>
      : <div className="panel p-8 text-center text-muted">You haven’t opened any requests yet.</div>}
  </div>;
}
