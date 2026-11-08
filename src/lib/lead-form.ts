import 'server-only';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getSettings } from './settings';
import { rateLimit } from './rate-limit';
import { notify } from './notify';
import { runAutomations } from './automation';
import { normalizePhone } from './utils';

export type LeadFormInput = { firstName?: string; lastName?: string; name?: string; email?: string; phone?: string; company?: string; jobTitle?: string; message?: string; product?: string; consent?: string | boolean; website?: string; t?: string | number; campaign?: string; page?: string };
/** Pure (unit-tested): validates a web-to-lead submission. Returns an error message or the cleaned values. */
export function checkLeadForm(f: LeadFormInput, now = Date.now()): { error: string } | { values: { firstName: string; lastName: string | null; email: string | null; phone: string | null; company: string | null; jobTitle: string | null; message: string | null; consent: boolean; campaign: string | null }; bot?: boolean } {
  if (f.website) return { bot: true, values: null as never };
  if (f.t && now - Number(f.t) < 3000) return { error: 'That was quick! Please check the form and send again.' };
  const full = (f.name || '').trim(); const first = (f.firstName || full.split(/\s+/)[0] || '').trim(); const last = (f.lastName || full.split(/\s+/).slice(1).join(' ')).trim();
  const email = (f.email || '').trim().toLowerCase(); const phone = (f.phone || '').trim();
  if (!first) return { error: 'Please enter your name.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Please enter a valid email address.' };
  if (!email && !phone) return { error: 'Please enter an email address or a phone number.' };
  return { values: { firstName: first.slice(0, 80), lastName: last.slice(0, 80) || null, email: email || null, phone: phone ? normalizePhone(phone) || phone.slice(0, 30) : null, company: (f.company || '').trim().slice(0, 160) || null,
    jobTitle: (f.jobTitle || '').trim().slice(0, 120) || null, message: (f.message || '').trim().slice(0, 4000) || null, consent: f.consent === true || f.consent === 'on' || f.consent === 'true' || f.consent === 'yes', campaign: (f.campaign || '').trim().slice(0, 120) || null } };
}
/** Creates the lead (or adds to a lead from the same email in the last 24 h). */
export async function submitLead(f: LeadFormInput, ip: string): Promise<{ ok: boolean; message: string; status: number }> {
  const s = await getSettings(); if (!s.leadFormEnabled) return { ok: false, message: 'This form is closed.', status: 403 };
  if (!rateLimit(`leadform:${ip}`, 8, 10 * 60_000)) return { ok: false, message: 'Too many submissions from your network. Please try again later.', status: 429 };
  const c = checkLeadForm(f); if ('error' in c) return { ok: false, message: c.error, status: 400 };
  if (c.bot) return { ok: true, message: s.leadFormThanks, status: 200 };
  const v = c.values;
  const product = f.product ? await db.query.products.findFirst({ where: sql`lower(${schema.products.name}) = ${String(f.product).trim().toLowerCase()}` }) : null;
  const notes = [v.message, f.page ? `Page: ${String(f.page).slice(0, 300)}` : null].filter(Boolean).join('\n\n') || null;
  const recent = v.email ? await db.query.leads.findFirst({ where: and(sql`lower(${schema.leads.email}) = ${v.email}`, gt(schema.leads.createdAt, new Date(Date.now() - 864e5))) }) : null;
  if (recent) {
    await db.update(schema.leads).set({ notes: [recent.notes, `Sent the form again (${new Date().toISOString().slice(0, 16).replace('T', ' ')}):`, notes].filter(Boolean).join('\n\n'), updatedAt: new Date() }).where(eq(schema.leads.id, recent.id));
    return { ok: true, message: s.leadFormThanks, status: 200 };
  }
  const ownerId = s.leadFormOwnerId || null;
  const [row] = await db.insert(schema.leads).values({ firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone, companyName: v.company, jobTitle: v.jobTitle, notes, source: s.leadFormSource || 'Website',
    campaign: v.campaign, productInterestId: product?.id || null, consent: v.consent, consentAt: v.consent ? new Date() : null, ownerId, tags: ['web-form'] }).returning();
  const admins = ownerId ? [] : (await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, 'admin'), eq(schema.users.active, true)))).map((x) => x.id);
  await notify(ownerId ? [ownerId] : admins, `New website lead: ${v.firstName}${v.company ? ` (${v.company})` : ''}`, v.message?.slice(0, 120) || v.email || v.phone || '', `/leads/${row.id}`);
  await runAutomations('lead.created', { type: 'lead', row }, null).catch(() => undefined);
  return { ok: true, message: s.leadFormThanks, status: 200 };
}
/** CORS: only the websites listed in settings may post from the browser. */
export async function corsHeaders(origin: string | null) {
  const s = await getSettings(); const allowed = origin && s.leadFormOrigins.some((o) => o.toLowerCase() === origin.toLowerCase());
  return allowed ? { 'Access-Control-Allow-Origin': origin!, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' } : ({} as Record<string, string>);
}
