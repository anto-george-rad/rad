import 'server-only';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getIntegrations, getSettings, saveIntegrations } from './settings';
import { open as openSecret } from './crypto-box';
import { log } from './log';

type Fetch = typeof fetch;
type GraphMsg = { id: string; internetMessageId?: string; subject?: string; bodyPreview?: string; webLink?: string; sentDateTime?: string; receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } }; toRecipients?: { emailAddress?: { address?: string } }[]; ccRecipients?: { emailAddress?: { address?: string } }[] };

/** App-only Microsoft Graph token (client credentials) for the tenant. */
export async function graphToken(cfg: { tenantId: string; clientId: string; clientSecret: string }, f: Fetch = fetch) {
  const res = await f(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: openSecret(cfg.clientSecret), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) });
  const j = await res.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Microsoft sign-in failed: ${(j.error_description || res.statusText || '').split('\n')[0].slice(0, 200)}`);
  return j.access_token;
}
/** Pure (unit-tested): which outside addresses a message involves, and whether the rep sent it. */
export function messageParties(m: GraphMsg, mailbox: string) {
  const me = mailbox.toLowerCase(); const myDomain = me.split('@')[1];
  const addr = (x?: { emailAddress?: { address?: string } }) => (x?.emailAddress?.address || '').toLowerCase().trim();
  const from = addr(m.from); const all = [from, ...(m.toRecipients || []).map(addr), ...(m.ccRecipients || []).map(addr)].filter(Boolean);
  const outside = Array.from(new Set(all.filter((a) => a !== me && a.split('@')[1] !== myDomain)));
  return { direction: (from === me ? 'out' : 'in') as 'in' | 'out', from, outside, to: (m.toRecipients || []).map(addr).filter(Boolean) };
}
/** Pulls recent mail for every rep with sync on and logs messages that involve a known contact. */
export async function syncMailboxes(f: Fetch = fetch, opts: { force?: boolean } = {}) {
  const s = await getSettings(); const integ = await getIntegrations(); const cfg = integ.outlook;
  if (!s.outlookEnabled || !cfg?.tenantId || !cfg.clientId || !cfg.clientSecret) return { skipped: 'not set up' };
  if (!opts.force && cfg.lastRunAt && Date.now() - +new Date(cfg.lastRunAt) < 9 * 60_000) return { skipped: 'ran recently' };
  const users = await db.select().from(schema.users).where(and(eq(schema.users.mailSync, true), eq(schema.users.active, true)));
  let logged = 0; const errors: string[] = [];
  try {
    const token = await graphToken(cfg, f);
    for (const u of users) {
      try {
        const since = (u.mailSyncedAt ? new Date(+u.mailSyncedAt - 5 * 60_000) : new Date(Date.now() - 14 * 864e5)).toISOString();
        let url: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(u.email)}/messages?$select=id,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,webLink&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc&$top=50`;
        let pages = 0;
        while (url && pages++ < 6) {
          const res = await f(url, { headers: { authorization: `Bearer ${token}` } });
          const j = await res.json().catch(() => ({})) as { value?: GraphMsg[]; '@odata.nextLink'?: string; error?: { message?: string } };
          if (!res.ok) throw new Error(j.error?.message || `Graph ${res.status}`);
          logged += await logMessages(u.id, u.email, j.value || []);
          url = j['@odata.nextLink'] || null;
        }
        await db.update(schema.users).set({ mailSyncedAt: new Date() }).where(eq(schema.users.id, u.id));
      } catch (e) { errors.push(`${u.email}: ${String((e as Error).message || e).slice(0, 160)}`); }
    }
  } catch (e) { errors.push(String((e as Error).message || e)); }
  await saveIntegrations({ outlook: { ...cfg, lastRunAt: new Date().toISOString(), lastError: errors.join(' · ') || null } });
  if (errors.length) log.error('outlook_sync_errors', { errors }); else log.info('outlook_synced', { users: users.length, logged });
  return { users: users.length, logged, errors };
}
/** Stores messages that involve at least one CRM contact (others are ignored — private mail stays private). */
export async function logMessages(userId: string, mailbox: string, msgs: GraphMsg[]) {
  if (!msgs.length) return 0;
  const parsed = msgs.map((m) => ({ m, p: messageParties(m, mailbox) })).filter((x) => x.p.outside.length);
  const addrs = Array.from(new Set(parsed.flatMap((x) => x.p.outside))); if (!addrs.length) return 0;
  const contacts = await db.select({ id: schema.contacts.id, email: schema.contacts.email, companyId: schema.contacts.companyId }).from(schema.contacts).where(inArray(sql`lower(${schema.contacts.email})`, addrs));
  if (!contacts.length) return 0;
  const openDeals = await db.select({ id: schema.deals.id, contactId: schema.deals.contactId, companyId: schema.deals.companyId, updatedAt: schema.deals.updatedAt }).from(schema.deals)
    .innerJoin(schema.stages, eq(schema.stages.id, schema.deals.stageId)).where(and(eq(schema.stages.type, 'open'), ne(schema.deals.isSample, true)));
  let n = 0;
  for (const { m, p } of parsed) {
    const c = contacts.find((x) => p.outside.includes((x.email || '').toLowerCase())); if (!c) continue;
    const deal = openDeals.filter((d) => d.contactId === c.id || (c.companyId && d.companyId === c.companyId)).sort((a, b) => +b.updatedAt - +a.updatedAt)[0];
    const r = await db.insert(schema.emailLogs).values({ userId, messageId: m.internetMessageId || m.id, direction: p.direction, subject: (m.subject || '(no subject)').slice(0, 300), snippet: (m.bodyPreview || '').slice(0, 400),
      fromEmail: p.from, toEmails: p.to.join(', ').slice(0, 500), contactId: c.id, companyId: c.companyId, dealId: deal?.id || null, webLink: m.webLink || null,
      at: new Date(m.receivedDateTime || m.sentDateTime || Date.now()) }).onConflictDoNothing().returning({ id: schema.emailLogs.id });
    n += r.length;
  }
  return n;
}
