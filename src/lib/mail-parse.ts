/** Helpers for turning emails into ticket conversations. Pure, unit-tested. */
export const ticketTag = (prefix: string, n: number) => `${prefix}-${1000 + n}`;
/** Finds "[#RD-1042]" (or "#RD-1042") in a subject and returns the ticket's sequence number. */
export function matchTicketRef(subject: string, prefix: string): number | null {
  const m = subject.match(new RegExp(`#${prefix.replace(/[^A-Za-z0-9]/g, '')}-(\\d{4,})`, 'i'));
  if (!m) return null; const n = +m[1] - 1000; return n > 0 ? n : null;
}
/** Auto-replies, bounces and bulk mail must never create tickets (prevents mail loops). */
export function isAutoReply(h: Record<string, string | undefined>, from: string) {
  const v = (k: string) => (h[k.toLowerCase()] || '').toLowerCase();
  if (v('auto-submitted') && v('auto-submitted') !== 'no') return true;
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(v('precedence'))) return true;
  if (v('x-autoreply') || v('x-autorespond') || v('x-auto-response-suppress').includes('all')) return true;
  if (v('list-id') || v('list-unsubscribe')) return true;
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i.test(from.split('@')[0] || '');
}
/** Keeps only the new part of a reply: cuts quoted history from common mail clients. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'); const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .{4,200} wrote:\s*$/.test(l) || (/^On .{4,200}$/.test(l) && /wrote:\s*$/.test(lines[i + 1] || ''))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{10,}$/.test(l)) break;
    if (/^From:\s.+/i.test(l) && lines.slice(i + 1, i + 5).some((x) => /^(Sent|Date):\s/i.test(x))) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  // Drop a trailing mobile signature such as "Sent from my iPhone" or "Get Outlook for Android".
  while (out.length && (!out[out.length - 1].trim() || /^(Sent from my \w[\w ]{0,30}|Get Outlook for (iOS|Android)|Sent from (Mail|Outlook) for \w+)\s*$/i.test(out[out.length - 1].trim()))) out.pop();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() || text.trim();
}
export const emailDomain = (email: string) => (email.split('@')[1] || '').toLowerCase().trim();
export const siteDomain = (site: string | null | undefined) => (site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const FREE = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'msn.com']);
export const isFreeMail = (domain: string) => FREE.has(domain);
