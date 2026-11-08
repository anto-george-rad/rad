import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getIntegrations, getSettings, saveIntegrations } from './settings';
import { open as openSecret } from './crypto-box';
import { store, MAX_UPLOAD } from './files';
import { log } from './log';

const GRAPH = 'https://graph.facebook.com/v20.0';
type Fetch = typeof fetch;
/** Pure (unit-tested): Meta signs the raw body with the app secret. */
export function validSignature(raw: string, header: string | null, appSecret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const want = Buffer.from(createHmac('sha256', appSecret).update(raw).digest('hex')); const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}
/** Pure: E.164-ish digits for matching contacts (last 9 digits ignore 00/+971/0 prefixes). */
export const phoneKey = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-9);

type WaMessage = { from: string; id: string; timestamp?: string; type: string; text?: { body?: string }; image?: { id: string; caption?: string; mime_type?: string }; document?: { id: string; caption?: string; filename?: string; mime_type?: string }; audio?: { id: string; mime_type?: string }; video?: { id: string; caption?: string; mime_type?: string } };
type WaPayload = { entry?: { changes?: { value?: { messages?: WaMessage[]; contacts?: { wa_id?: string; profile?: { name?: string } }[]; statuses?: unknown[] } }[] }[] };

/** Incoming WhatsApp messages become tickets (or replies on the customer's open WhatsApp ticket). */
export async function handleInbound(payload: WaPayload, f: Fetch = fetch) {
  const s = await getSettings(); const integ = (await getIntegrations()).whatsapp; if (!s.whatsappEnabled || !integ) return 0;
  const { createTicketInternal, customerReplied } = await import('./desk');
  let n = 0;
  for (const ch of (payload.entry || []).flatMap((e) => e.changes || [])) {
    const v = ch.value || {}; const names = new Map((v.contacts || []).map((c) => [c.wa_id || '', c.profile?.name || '']));
    for (const m of v.messages || []) {
      const msgId = `wa:${m.id}`;
      if (await db.query.ticketThreads.findFirst({ where: eq(schema.ticketThreads.messageId, msgId), columns: { id: true } })) continue; // Meta retries
      const media = (m.image || m.document || m.audio || m.video) as { id: string; caption?: string; filename?: string; mime_type?: string } | undefined;
      const body = (m.text?.body || media?.caption || (media ? `[${m.type} attached]` : `[${m.type} message]`)).trim();
      const phone = `+${m.from.replace(/\D/g, '')}`; const name = names.get(m.from) || phone; const key = phoneKey(phone);
      const contact = key.length >= 8 ? await db.query.contacts.findFirst({ where: sql`right(regexp_replace(coalesce(${schema.contacts.mobile}, ''), '\\D', '', 'g'), 9) = ${key} or right(regexp_replace(coalesce(${schema.contacts.phone}, ''), '\\D', '', 'g'), 9) = ${key}` }) : null;
      let ticket = await db.query.tickets.findFirst({ where: and(eq(schema.tickets.channel, 'whatsapp'), eq(schema.tickets.requesterPhone, phone), ne(schema.tickets.statusCategory, 'closed')), orderBy: desc(schema.tickets.updatedAt) });
      if (ticket) await customerReplied(ticket, body, { fromName: name, channel: 'whatsapp', messageId: msgId });
      else {
        ticket = await createTicketInternal({ subject: body.split('\n')[0].slice(0, 120) || 'WhatsApp message', channel: 'whatsapp', departmentId: s.whatsappDepartmentId || null, requesterName: contact ? null : name, requesterPhone: phone,
          contactId: contact?.id || null, companyId: contact?.companyId || null, firstMessage: { kind: 'incoming', body, fromName: name, messageId: msgId } });
      }
      if (media) await saveMedia(ticket.id, media, integ.accessToken, f).catch((e) => log.error('wa_media_failed', { error: String(e) }));
      n++;
    }
  }
  if (n) await saveIntegrations({ whatsapp: { ...integ, lastInboundAt: new Date().toISOString() } });
  return n;
}
async function saveMedia(ticketId: string, media: { id: string; mime_type?: string; filename?: string }, sealedToken: string, f: Fetch) {
  const token = openSecret(sealedToken);
  const meta = await (await f(`${GRAPH}/${media.id}`, { headers: { authorization: `Bearer ${token}` } })).json() as { url?: string; file_size?: number; mime_type?: string };
  if (!meta.url || (meta.file_size || 0) > MAX_UPLOAD) return;
  const buf = Buffer.from(await (await f(meta.url, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
  const ext = (meta.mime_type || media.mime_type || '').split('/')[1]?.split(';')[0] || 'bin';
  await db.insert(schema.attachments).values({ relatedType: 'ticket', relatedId: ticketId, fileName: (media.filename || `whatsapp-${media.id.slice(-6)}.${ext}`).slice(0, 200), mime: meta.mime_type || media.mime_type || 'application/octet-stream', size: buf.length, storageKey: await store(buf) });
}
/** Sends a WhatsApp text. Outside Meta's 24-hour window a free-form message is refused, so we say so. */
export async function sendWhatsApp(to: string, text: string, lastCustomerAt: Date | null, f: Fetch = fetch): Promise<string> {
  const s = await getSettings(); const integ = (await getIntegrations()).whatsapp;
  if (!s.whatsappEnabled || !integ?.phoneNumberId || !integ.accessToken) return 'WhatsApp not set up';
  if (lastCustomerAt && Date.now() - +lastCustomerAt > 24 * 3600_000) return 'WhatsApp not sent: over 24 h since the customer last wrote (WhatsApp rule) — email or call instead';
  try {
    const res = await f(`${GRAPH}/${integ.phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${openSecret(integ.accessToken)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { preview_url: true, body: text.slice(0, 4000) } }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})) as { error?: { message?: string } }; log.error('wa_send_failed', { status: res.status, error: j.error?.message }); return `WhatsApp send failed: ${(j.error?.message || res.status).toString().slice(0, 120)}`; }
    return 'sent via WhatsApp';
  } catch (e) { log.error('wa_send_failed', { error: String(e) }); return 'WhatsApp send failed (couldn’t reach WhatsApp)'; }
}
