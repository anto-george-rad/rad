import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getUser } from '@/lib/auth';
import { deskCtx, ticketWhere } from '@/lib/desk-access';
import { search } from '@/lib/list-query';
import { getSettings } from '@/lib/settings';
import { ticketTag } from '@/lib/mail-parse';
import { fullName } from '@/lib/utils';

export const dynamic = 'force-dynamic';
type Hit = { type: string; id: string; label: string; sub?: string; extra?: Record<string, unknown> };
/**
 * Search-as-you-type for pickers and the command palette. Only returns what the person may see:
 * leads and deals need CRM access; contacts and companies need CRM access or a helpdesk agent role; tickets follow helpdesk visibility.
 */
export async function GET(req: Request) {
  const me = await getUser(); if (!me) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const u = new URL(req.url); const type = u.searchParams.get('type') || 'all'; const q = (u.searchParams.get('q') || '').slice(0, 80); const ids = (u.searchParams.get('ids') || '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 50);
  const lim = Math.min(25, Number(u.searchParams.get('limit')) || 12);
  const crm = me.crmAccess; const agent = me.deskRole === 'admin' || me.deskRole === 'agent'; const desk = me.deskRole !== 'none';
  const want = (t: string) => type === 'all' || type === t;
  const out: Hit[] = [];
  const C = schema.companies, P = schema.contacts, D = schema.deals, L = schema.leads, T = schema.tickets;
  if (want('company') && (crm || agent)) {
    const w = ids.length ? inArray(C.id, ids) : search(q, [C.name, C.website, C.vatTrn]);
    for (const r of await db.select({ id: C.id, name: C.name, accountType: C.accountType, city: C.city, tier: C.tier }).from(C).where(w).orderBy(C.name).limit(ids.length || lim))
      out.push({ type: 'company', id: r.id, label: r.name, sub: [r.accountType, r.city].filter(Boolean).join(' · '), extra: { accountType: r.accountType, tier: r.tier } });
  }
  if (want('contact') && (crm || agent)) {
    const company = u.searchParams.get('company');
    const w = ids.length ? inArray(P.id, ids) : and(company && /^[0-9a-f-]{36}$/.test(company) ? eq(P.companyId, company) : undefined, search(q, [sql`${P.firstName} || ' ' || coalesce(${P.lastName}, '')`, P.email, P.phone, P.mobile]));
    const rows = await db.select({ id: P.id, firstName: P.firstName, lastName: P.lastName, email: P.email, companyId: P.companyId, co: C.name, accountType: C.accountType, dnc: P.doNotContact }).from(P).leftJoin(C, eq(C.id, P.companyId)).where(w).orderBy(P.firstName).limit(ids.length || lim);
    for (const r of rows) out.push({ type: 'contact', id: r.id, label: fullName(r), sub: [r.co, r.email].filter(Boolean).join(' · '), extra: { companyId: r.companyId, companyName: r.co, accountType: r.accountType, email: r.email, doNotContact: r.dnc } });
  }
  if (want('deal') && crm) {
    const w = ids.length ? inArray(D.id, ids) : search(q, [D.name, D.tenderNumber, D.poNumber]);
    for (const r of await db.select({ id: D.id, name: D.name, co: C.name }).from(D).leftJoin(C, eq(C.id, D.companyId)).where(w).orderBy(desc(D.updatedAt)).limit(ids.length || lim)) out.push({ type: 'deal', id: r.id, label: r.name, sub: r.co || undefined });
  }
  if (want('lead') && crm) {
    const w = ids.length ? inArray(L.id, ids) : and(type === 'all' ? sql`${L.status} <> 'Converted'` : undefined, search(q, [sql`${L.firstName} || ' ' || coalesce(${L.lastName}, '')`, L.companyName, L.email, L.phone]));
    for (const r of await db.select({ id: L.id, firstName: L.firstName, lastName: L.lastName, companyName: L.companyName, status: L.status }).from(L).where(w).orderBy(desc(L.createdAt)).limit(ids.length || lim)) out.push({ type: 'lead', id: r.id, label: fullName(r), sub: [r.companyName, r.status].filter(Boolean).join(' · ') });
  }
  if (want('ticket') && desk) {
    const c = await deskCtx(me); const s = await getSettings();
    const num = q.match(/(\d{4,})/)?.[1]; const n = num ? +num - 1000 : null;
    const w = ids.length ? inArray(T.id, ids) : (n && n > 0 ? eq(T.number, n) : search(q, [T.subject, T.requesterEmail, T.requesterName]));
    for (const r of await db.select({ id: T.id, number: T.number, subject: T.subject, req: T.requesterName }).from(T).where(and(ticketWhere(c), w)).orderBy(desc(T.updatedAt)).limit(ids.length || lim))
      out.push({ type: 'ticket', id: r.id, label: `${ticketTag(s.ticketPrefix, r.number)} ${r.subject}`, sub: r.req || undefined });
  }
  return Response.json({ items: out });
}
