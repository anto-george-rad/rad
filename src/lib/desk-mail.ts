import 'server-only';
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Department, Ticket } from '@/db/schema';
import { getSettings } from './settings';
import { mailEnabled } from './mailer';
import { log } from './log';
import { readStored, store, MAX_UPLOAD } from './files';
import { open as openSecret } from './crypto-box';
import { isAutoReply, matchTicketRef, stripQuoted, ticketTag } from './mail-parse';
import { createTicketInternal, customerReplied } from './desk';

const transport = () => nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
const fromAddr = () => process.env.SMTP_FROM || process.env.SMTP_USER || 'support@localhost';
const domainOf = (a: string) => (a.match(/@([^>\s]+)/)?.[1] || 'rad.workspace');

/** Sends a ticket email with threading headers so the customer's reply lands on the same ticket. */
export async function sendTicketMail(t: Ticket, m: { kind: 'reply' | 'ack' | 'resolved'; body: string; cc?: string | null; authorName?: string; signature?: string | null; attachmentIds?: string[] }) {
  // WhatsApp tickets are answered on WhatsApp (files go as a portal link: WhatsApp media needs a separate upload).
  if (t.channel === 'whatsapp' && t.requesterPhone && m.kind !== 'ack') {
    const { sendWhatsApp } = await import('./whatsapp');
    const files = m.attachmentIds?.length ? `\n\n${m.attachmentIds.length} file${m.attachmentIds.length === 1 ? '' : 's'} attached — view in the support portal: ${(process.env.APP_URL || '').replace(/\/$/, '')}/portal/tickets/${t.id}` : '';
    return { messageId: null, delivery: await sendWhatsApp(t.requesterPhone, `${m.body.trim()}${files}`, t.lastCustomerReplyAt) };
  }
  if (!t.requesterEmail || !mailEnabled()) return { messageId: null, delivery: mailEnabled() ? 'no address' : 'email not set up' };
  const s = await getSettings();
  const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, t.departmentId) });
  const last = await db.select({ m: schema.ticketThreads.messageId }).from(schema.ticketThreads).where(and(eq(schema.ticketThreads.ticketId, t.id), inArray(schema.ticketThreads.kind, ['incoming', 'reply']))).orderBy(desc(schema.ticketThreads.createdAt)).limit(10);
  const refs = last.map((x) => x.m).filter(Boolean) as string[];
  const messageId = `<rad-${t.id.slice(0, 8)}-${randomBytes(6).toString('hex')}@${domainOf(fromAddr())}>`;
  const sig = [m.signature, dept?.signature].filter(Boolean).join('\n\n');
  const text = `${m.body.trim()}${sig ? `\n\n--\n${sig}` : ''}\n\n[Ref: ${ticketTag(s.ticketPrefix, t.number)}]`;
  const files = m.attachmentIds?.length ? await db.select().from(schema.attachments).where(and(inArray(schema.attachments.id, m.attachmentIds), eq(schema.attachments.relatedType, 'ticket'), eq(schema.attachments.relatedId, t.id))) : [];
  const attachments = await Promise.all(files.map(async (f) => ({ filename: f.fileName, contentType: f.mime, content: await readStored(f.storageKey) })));
  try {
    await transport().sendMail({
      from: { name: m.authorName ? `${m.authorName} · ${dept?.name || s.orgName}` : dept?.name || s.orgName, address: fromAddr() }, replyTo: dept?.email || undefined,
      to: t.requesterEmail, cc: m.cc || undefined, subject: `[#${ticketTag(s.ticketPrefix, t.number)}] ${t.subject}`, text, messageId,
      inReplyTo: refs[0] || undefined, references: refs.reverse(), headers: { 'Auto-Submitted': m.kind === 'reply' ? 'no' : 'auto-replied', 'X-RAD-Ticket': t.id }, ...(attachments.length ? { attachments } : {}),
    });
    return { messageId, delivery: 'sent' };
  } catch (e) { log.error('ticket_mail_failed', { ticket: t.id, error: String(e) }); return { messageId, delivery: 'failed' }; }
}

export type Inbound = { from: string; fromName?: string | null; to?: string; cc?: string | null; subject: string; text: string; messageId?: string | null; inReplyTo?: string | null; references?: string[]; headers: Record<string, string | undefined>; attachments?: { filename: string; contentType: string; content: Buffer }[] };
/** Turns one inbound email into a new ticket or a reply on an existing one. Returns what happened. */
export async function ingestEmail(dept: Department, m: Inbound): Promise<{ action: 'skipped' | 'reply' | 'created'; ticketId?: string; reason?: string }> {
  const from = m.from.toLowerCase().trim();
  if (!from || isAutoReply(m.headers, from)) return { action: 'skipped', reason: 'auto-reply or bounce' };
  const own = [fromAddr(), ...(await db.select({ e: schema.departments.email }).from(schema.departments)).map((d) => d.e)].filter(Boolean).map((x) => x!.toLowerCase());
  if (own.includes(from)) return { action: 'skipped', reason: 'sent by us' };
  if (m.messageId && (await db.select({ id: schema.ticketThreads.id }).from(schema.ticketThreads).where(eq(schema.ticketThreads.messageId, m.messageId)).limit(1)).length) return { action: 'skipped', reason: 'already imported' };
  const s = await getSettings();
  // 1) threading headers, 2) [#RD-1234] in the subject
  let ticket: Ticket | undefined;
  const ids = [m.inReplyTo, ...(m.references || [])].filter(Boolean) as string[];
  if (ids.length) {
    const th = await db.select({ t: schema.ticketThreads.ticketId }).from(schema.ticketThreads).where(inArray(schema.ticketThreads.messageId, ids)).limit(1);
    if (th[0]) ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, th[0].t) });
  }
  if (!ticket) { const n = matchTicketRef(m.subject, s.ticketPrefix); if (n) ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.number, n) }); }
  // Follow merges to the surviving ticket.
  for (let i = 0; ticket?.mergedIntoId && i < 5; i++) ticket = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.mergedIntoId) });
  const body = (ticket ? stripQuoted(m.text) : m.text).trim() || '(no text)';
  let id: string;
  if (ticket && (ticket.requesterEmail === from || (ticket.cc || '').toLowerCase().includes(from) || (await db.query.contacts.findFirst({ where: eq(schema.contacts.email, from) }))?.companyId === ticket.companyId)) {
    await customerReplied(ticket, body, { fromName: m.fromName, fromEmail: from, messageId: m.messageId, inReplyTo: m.inReplyTo, channel: 'email' }); id = ticket.id;
  } else {
    const t = await createTicketInternal({ subject: m.subject.replace(/^(re|fw|fwd):\s*/i, '') || '(no subject)', description: body, departmentId: dept.id, channel: 'email', requesterEmail: from, requesterName: m.fromName, cc: m.cc,
      firstMessage: { kind: 'incoming', body, fromName: m.fromName, fromEmail: from, messageId: m.messageId, inReplyTo: m.inReplyTo }, ack: true });
    id = t.id;
  }
  for (const a of (m.attachments || []).slice(0, 10)) {
    if (a.content.length > MAX_UPLOAD || /\.(exe|bat|cmd|scr|js|vbs|ps1|msi)$/i.test(a.filename)) continue;
    const key = await store(a.content);
    await db.insert(schema.attachments).values({ relatedType: 'ticket', relatedId: id, fileName: (a.filename || 'attachment').slice(0, 200), mime: a.contentType || 'application/octet-stream', size: a.content.length, storageKey: key });
  }
  return { action: ticket?.id === id ? 'reply' : 'created', ticketId: id };
}

/** Checks every department mailbox for new mail (runs every 2 minutes). */
export async function pollMailboxes() {
  const deps = (await db.select().from(schema.departments).where(eq(schema.departments.active, true))).filter((d) => d.imap?.host);
  const out: Record<string, string> = {};
  for (const d of deps) {
    const c = d.imap!; let client: import('imapflow').ImapFlow | null = null;
    try {
      const { ImapFlow } = await import('imapflow'); const { simpleParser } = await import('mailparser');
      client = new ImapFlow({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: openSecret(c.passwordEnc) }, logger: false });
      await client.connect(); const lock = await client.getMailboxLock(c.folder || 'INBOX'); let last = d.imapLastUid; let n = 0;
      try {
        const range = `${d.imapLastUid + 1}:*`;
        for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= d.imapLastUid || !msg.source) continue;
          const p = await simpleParser(msg.source);
          const hdr: Record<string, string> = {}; p.headers.forEach((v, k) => { hdr[k.toLowerCase()] = typeof v === 'string' ? v : JSON.stringify(v); });
          const fromV = p.from?.value?.[0];
          await ingestEmail(d, { from: fromV?.address || '', fromName: fromV?.name || null, subject: p.subject || '', text: p.text || (p.html ? String(p.html).replace(/<[^>]+>/g, ' ') : ''), cc: Array.isArray(p.cc) ? p.cc.map((x) => x.text).join(', ') : p.cc?.text || null,
            messageId: p.messageId || null, inReplyTo: p.inReplyTo || null, references: Array.isArray(p.references) ? p.references : p.references ? [p.references] : [], headers: hdr,
            attachments: p.attachments.map((a) => ({ filename: a.filename || 'file', contentType: a.contentType, content: a.content })) });
          last = Math.max(last, msg.uid); n++;
        }
      } finally { lock.release(); }
      await db.update(schema.departments).set({ imapLastUid: last, imapStatus: `OK · ${n} new`, imapCheckedAt: new Date() }).where(eq(schema.departments.id, d.id));
      out[d.name] = `${n} new`;
    } catch (e) {
      await db.update(schema.departments).set({ imapStatus: `Error: ${String((e as Error).message || e).slice(0, 160)}`, imapCheckedAt: new Date() }).where(eq(schema.departments.id, d.id));
      log.error('mailbox_failed', { department: d.name, error: String(e) }); out[d.name] = 'error';
    } finally { await client?.logout().catch(() => {}); }
  }
  return out;
}
