'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { rateLimit } from './rate-limit';
import { canUseFilesOf } from './file-access';
import bcrypt from 'bcryptjs';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { AutomationActions, AutomationTrigger, CustomFieldType, Deal, DeskRole, Lead, TicketScope } from '@/db/schema';
import { createHash, randomBytes } from 'crypto';
import { canEdit, createSession, destroySession, homeFor, pendingTwoFactor, readPendingTwoFactor, requireAdmin, requireManager, requireUser, type SessionUser } from './auth';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { open as openSecret, seal } from './crypto-box';
import { runAutomations } from './automation';
import { getSettings, saveSettings, type OrgSettings } from './settings';
import { addDaysISO, contractEndFrom, fullName, isValidTrn, normalizePhone, passwordProblem, tagsOf, todayISO } from './utils';
import type { Tile } from './insights-defaults';
import { canSeeTask, taskScope, visibleTasks } from './visibility';
import { audit } from './audit';
import { log } from './log';
import { mailEnabled, sendMail } from './mailer';
import { notify } from './notify';
import { toBase } from './settings-defaults';
import { PRODUCT_HANDLING_TYPES } from './options';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const done = <T extends object>(x?: T) => { revalidatePath('/', 'layout'); return { ok: true as const, ...(x || ({} as T)) }; };
class UserError extends Error {}
/** Messages we wrote ourselves are safe to show; anything else (DB errors etc.) is logged and replaced. */
const USER_ERR = /^(Only |You |This |That |Choose |Give |Enter |Add |Use |Set |Pick |Name |Keep |Move |Remove |A |An |The |Type |Write |Too |\S+ is required)/;
/** Workspace admins manage everyone; helpdesk admins manage the helpdesk side of people who aren't workspace admins. */
async function requireUserManager(me: SessionUser, targetId?: string | null) {
  if (me.role === 'admin') return;
  if (me.deskRole !== 'admin') throw new UserError('Only admins can manage users.');
  if (targetId) { const t = await db.query.users.findFirst({ where: eq(schema.users.id, targetId), columns: { role: true, crmAccess: true } }); if (t?.role === 'admin') throw new UserError('Only workspace admins can change an admin.'); if (t?.crmAccess) throw new UserError('This person also uses the CRM — a workspace admin manages their sign-in.'); }
}
/** Ticket automations and ticket fields belong to helpdesk admins; everything else to workspace admins. */
async function requireAdminFor(me: SessionUser, ticketSide: boolean) { if (me.role === 'admin' || (ticketSide && me.deskRole === 'admin')) return; throw new UserError(ticketSide ? 'Only helpdesk admins can change this.' : 'Only admins can change this.'); }
async function guard<T extends object>(fn: (u: SessionUser) => Promise<Result<T>>): Promise<Result<T>> {
  let uid: string | undefined;
  try { const u = await requireUser(); uid = u.id; return await fn(u); }
  catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    const msg = (e as Error)?.message || '';
    if (e instanceof UserError || USER_ERR.test(msg)) return fail(msg);
    log.error('action_failed', { user: uid, error: msg, stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
    return fail('Something went wrong. The error has been logged; try again or tell your admin.');
  }
}
/** CRM actions: refused for people whose CRM access is switched off. */
function crmGuard<T extends object>(fn: (u: SessionUser) => Promise<Result<T>>): Promise<Result<T>> {
  return guard<T>(async (u) => u.crmAccess ? fn(u) : fail('You don’t have access to the CRM.'));
}
const phone = (v: unknown) => normalizePhone(clean(v) as string | null);
const clean = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : v; return s === '' || s === undefined ? null : s; };
const emailOk = (e?: string | null) => !e || /^\S+@\S+\.\S+$/.test(e);

/* ============ auth ============ */
const MAX_FAILS = 5, LOCK_MIN = 15;
export async function login(email: string, password: string, next?: string): Promise<Result<{ twoFactor?: string }>> {
  const addr = email.trim().toLowerCase();
  const ip = (headers().get('x-forwarded-for') || headers().get('x-real-ip') || 'local').split(',')[0].trim();
  if (!rateLimit(`login:${ip}`, 30, 10 * 60_000)) return fail('Too many sign-in attempts from this network. Wait a few minutes and try again.');
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, addr) });
  if (u?.lockedUntil && +u.lockedUntil > Date.now()) {
    const mins = Math.ceil((+u.lockedUntil - Date.now()) / 60000);
    return fail(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`);
  }
  if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
    if (u) await countFailure(u);
    return fail('That email and password do not match an active account.');
  }
  // Two-step sign-in: password was right, now ask for the authenticator code.
  if (u.totpEnabled) return { ok: true, twoFactor: await pendingTwoFactor(u.id) };
  return finishLogin(u, next);
}
async function countFailure(u: typeof schema.users.$inferSelect) {
  const fails = u.failedLogins + 1; const lock = fails >= MAX_FAILS;
  await db.update(schema.users).set({ failedLogins: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MIN * 60000) : null }).where(eq(schema.users.id, u.id));
  await audit(u.id, lock ? 'login.locked' : 'login.failed', 'user', u.id);
}
async function finishLogin(u: typeof schema.users.$inferSelect, next?: string): Promise<never> {
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await createSession({ id: u.id, sessionVersion: u.sessionVersion });
  themeCookie(u.theme);
  await audit(u.id, 'login', 'user', u.id);
  const home = homeFor(u);
  // Only follow ?next= into a module this person can use.
  const ok = next && next.startsWith('/') && !next.startsWith('//') && (u.crmAccess || /^\/(desk|settings)/.test(next)) && (u.deskRole !== 'none' || !next.startsWith('/desk'));
  redirect(ok ? next! : home);
}
export async function loginTwoFactor(token: string, code: string, next?: string): Promise<Result> {
  const id = await readPendingTwoFactor(token); if (!id) return fail('That took too long. Sign in again.');
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, id) }); if (!u || !u.active || !u.totpEnabled || !u.totpSecret) return fail('Sign in again.');
  if (u.lockedUntil && +u.lockedUntil > Date.now()) return fail('Too many failed attempts. Try again later.');
  const c = code.trim().replace(/\s/g, '');
  let ok = verifyTotp(openSecret(u.totpSecret), c);
  if (!ok && /^[a-z0-9]{10}$/i.test(c)) { // one-time recovery code
    const h = createHash('sha256').update(c.toLowerCase()).digest('hex');
    if (u.recoveryCodes.includes(h)) { ok = true; await db.update(schema.users).set({ recoveryCodes: u.recoveryCodes.filter((x) => x !== h) }).where(eq(schema.users.id, u.id)); await audit(u.id, '2fa.recovery_used', 'user', u.id); }
  }
  if (!ok) { await countFailure(u); return fail('That code is not right. Check the time on your phone and try again.'); }
  return finishLogin(u, next);
}
/** Step 1 of turning on two-step sign-in: a new secret and QR code (not active until confirmed). */
export async function startTwoFactor() {
  return guard<{ secret: string; qr: string }>(async (me) => {
    const secret = newTotpSecret();
    await db.update(schema.users).set({ totpSecret: seal(secret), totpEnabled: false }).where(eq(schema.users.id, me.id));
    const QR = await import('qrcode');
    return { ok: true, secret, qr: await QR.toDataURL(otpauthUrl(secret, me.email), { margin: 1, width: 220 }) };
  });
}
export async function confirmTwoFactor(code: string) {
  return guard<{ recovery: string[] }>(async (me) => {
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, me.id) }); if (!u?.totpSecret) return fail('Start again.');
    if (!verifyTotp(openSecret(u.totpSecret), code)) return fail('That code is not right. Enter the 6 digits shown in your app now.');
    const recovery = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    await db.update(schema.users).set({ totpEnabled: true, recoveryCodes: recovery.map((r) => createHash('sha256').update(r).digest('hex')) }).where(eq(schema.users.id, me.id));
    await audit(me.id, '2fa.enabled', 'user', me.id);
    return done({ recovery });
  });
}
export async function disableTwoFactor(password: string) {
  return guard(async (me) => {
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, me.id) });
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) return fail('Your password is not correct.');
    await db.update(schema.users).set({ totpEnabled: false, totpSecret: null, recoveryCodes: [] }).where(eq(schema.users.id, me.id));
    await audit(me.id, '2fa.disabled', 'user', me.id); return done();
  });
}
/** Admin: turn off someone's two-step sign-in when they lose their phone. */
export async function adminResetTwoFactor(userId: string) {
  return guard(async (me) => {
    await requireUserManager(me, userId);
    await db.update(schema.users).set({ totpEnabled: false, totpSecret: null, recoveryCodes: [], sessionVersion: sql`${schema.users.sessionVersion} + 1` }).where(eq(schema.users.id, userId));
    await audit(me.id, '2fa.reset_by_admin', 'user', userId); return done();
  });
}
/** End one signed-in device. */
export async function revokeSession(id: string) {
  return guard(async (me) => {
    await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, me.id)));
    await audit(me.id, 'session.revoked', 'user', me.id); return done();
  });
}
export async function logout() { await destroySession(); redirect('/login'); }
export async function changePassword(current: string, next: string) {
  return guard(async (me) => {
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, me.id) });
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) return fail('Your current password is not correct.');
    const p = passwordProblem(next, u.email); if (p) return fail(p);
    const [row] = await db.update(schema.users).set({ passwordHash: await bcrypt.hash(next, 10), sessionVersion: u.sessionVersion + 1 }).where(eq(schema.users.id, me.id)).returning();
    await createSession({ id: row.id, sessionVersion: row.sessionVersion }); // keep this browser signed in, sign out the rest
    await audit(me.id, 'password.changed', 'user', me.id);
    return done();
  });
}
/** Signs this user out on every device, including this one. */
export async function signOutEverywhere() {
  const me = await requireUser();
  await db.update(schema.users).set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` }).where(eq(schema.users.id, me.id));
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, me.id), sql`${schema.sessions.revokedAt} is null`));
  await audit(me.id, 'sessions.revoked', 'user', me.id);
  cookies().delete('rd_session'); redirect('/login');
}
function themeCookie(theme: string) { cookies().set('rd-theme', theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' }); }
/** Saved per user, so the theme follows them to every device they sign in on. */
export async function setMyTheme(theme: 'system' | 'light' | 'dark') {
  return guard(async (me) => {
    if (!['system', 'light', 'dark'].includes(theme)) return fail('Choose system, light or dark.');
    await db.update(schema.users).set({ theme }).where(eq(schema.users.id, me.id)); themeCookie(theme); return { ok: true };
  });
}
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
async function makeResetLink(userId: string, hours: number) {
  const token = randomBytes(32).toString('base64url');
  await db.insert(schema.passwordResets).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + hours * 3600_000) });
  return `${(process.env.APP_URL || '').replace(/\/$/, '')}/reset?token=${token}`;
}
/** "Forgot password". Always answers the same way so it can't be used to discover accounts. */
export async function requestPasswordReset(email: string): Promise<Result<{ message: string }>> {
  const ip = (headers().get('x-forwarded-for') || 'local').split(',')[0].trim();
  if (!rateLimit(`reset:${ip}`, 5, 15 * 60_000)) return fail('Too many requests. Wait a few minutes and try again.');
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email.trim().toLowerCase()) });
  const generic = mailEnabled() ? 'If that email belongs to an active account, a reset link is on its way.' : 'Email is not set up on this server. Ask your admin for a reset link (Settings → Users).';
  if (u?.active && mailEnabled()) {
    const link = await makeResetLink(u.id, 1);
    try { await sendMail(u.email, 'Reset your Raidefend CRM password', `Hi ${u.name},\n\nUse this link within 1 hour to choose a new password:\n${link}\n\nIf you didn't ask for this, ignore this email.`); }
    catch (e) { log.error('reset_mail_failed', { error: String(e) }); }
    await audit(u.id, 'password.reset_requested', 'user', u.id);
  }
  return { ok: true, message: generic };
}
export async function resetPassword(token: string, password: string): Promise<Result> {
  const row = await db.query.passwordResets.findFirst({ where: eq(schema.passwordResets.tokenHash, hashToken(token || '')) });
  if (!row || row.usedAt || +row.expiresAt < Date.now()) return fail('This reset link has expired or was already used. Ask for a new one.');
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) }); if (!u?.active) return fail('This account is not active.');
  const p = passwordProblem(password, u.email); if (p) return fail(p);
  await db.update(schema.users).set({ passwordHash: await bcrypt.hash(password, 10), sessionVersion: u.sessionVersion + 1, failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await db.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.id, row.id));
  await audit(u.id, 'password.reset', 'user', u.id);
  return { ok: true };
}
/** Admin: a one-time link (valid 24 hours) to hand to someone who can't sign in. */
export async function adminResetLink(userId: string) {
  return guard<{ link: string }>(async (me) => {
    await requireUserManager(me, userId);
    const link = await makeResetLink(userId, 24);
    await audit(me.id, 'password.reset_link', 'user', userId);
    return { ok: true, link };
  });
}

/* ============ custom fields ============ */
async function readCustom(module: string, input: Record<string, unknown> | undefined, pipelineId?: string | null) {
  const fields = (await db.select().from(schema.customFields).where(eq(schema.customFields.module, module))).filter((f) => !f.pipelineId || f.pipelineId === pipelineId);
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v = input?.[f.id];
    if (typeof v === 'string') v = v.trim();
    if (f.type === 'number' && v !== '' && v != null) v = Number(v);
    if (f.required && (v === '' || v == null || v === false)) throw new UserError(`${f.label} is required.`);
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}

/* ============ leads ============ */
type LeadInput = Partial<Lead> & { custom?: Record<string, unknown> };
/** Is this email or phone already a contact? Leads should not duplicate existing customers. */
async function contactMatch(email: string | null, ph: string | null) {
  if (email) { const c = await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${email.toLowerCase()}` }); if (c) return c; }
  if (ph) { const c = await db.query.contacts.findFirst({ where: sql`${schema.contacts.phone} = ${ph} or ${schema.contacts.mobile} = ${ph}` }); if (c) return c; }
  return null;
}
export async function saveLead(input: LeadInput & { allowContactDuplicate?: boolean }) {
  return crmGuard<{ id: string; ran: string[] }>(async (me) => {
    const firstName = String(input.firstName || '').trim(); if (!firstName) return fail('First name is required.');
    const email = clean(input.email) as string | null; if (!emailOk(email)) return fail('That email address looks incomplete.');
    const ph = phone(input.phone);
    if (email) {
      const dup = await db.query.leads.findFirst({ where: sql`lower(${schema.leads.email}) = ${email.toLowerCase()}` });
      if (dup && dup.id !== input.id) return fail(`${fullName(dup)} is already a lead with this email.`);
    }
    if (!input.id && !input.allowContactDuplicate) {
      const c = await contactMatch(email, ph);
      if (c) return fail(`DUP_CONTACT:${c.id}:${fullName(c)} is already a contact with this ${email && c.email?.toLowerCase() === email.toLowerCase() ? 'email' : 'phone number'}.`);
    }
    const status = (input.status || 'New') as Lead['status'];
    if (status === 'Unqualified' && !clean(input.disqualReason)) return fail('Choose why this lead is unqualified.');
    const custom = await readCustom('lead', input.custom);
    const consent = !!input.consent;
    const values = { firstName, lastName: clean(input.lastName) as string | null, companyName: clean(input.companyName) as string | null, jobTitle: clean(input.jobTitle) as string | null,
      email, phone: ph, source: clean(input.source) as string | null, status, notes: clean(input.notes) as string | null,
      industry: clean(input.industry) as string | null, emirate: clean(input.emirate) as string | null, website: clean(input.website) as string | null, companySize: clean(input.companySize) as string | null,
      budget: input.budget == null || (input.budget as unknown) === '' ? null : +input.budget, timeline: clean(input.timeline) as string | null, productInterestId: clean(input.productInterestId) as string | null,
      campaign: clean(input.campaign) as string | null, disqualReason: status === 'Unqualified' ? clean(input.disqualReason) as string | null : null,
      consent, doNotContact: !!input.doNotContact,
      tags: tagsOf(input.tags), ownerId: (input.ownerId || me.id) as string, custom, updatedAt: new Date() };
    if (input.id) {
      const prev = await db.query.leads.findFirst({ where: eq(schema.leads.id, input.id) }); if (!prev) return fail('This lead no longer exists.');
      if (!canEdit(me, prev.ownerId)) return fail('You can only edit leads you own.');
      const [row] = await db.update(schema.leads).set({ ...values, consentAt: consent ? prev.consentAt ?? new Date() : null,
        firstContactedAt: prev.firstContactedAt ?? (prev.status === 'New' && status !== 'New' ? new Date() : null) }).where(eq(schema.leads.id, input.id)).returning();
      await history('lead', row.id, me.id, prev, row, LEAD_LABELS);
      if (prev.ownerId !== row.ownerId && row.ownerId !== me.id) await notify([row.ownerId], 'Lead assigned to you', fullName(row), `/leads/${row.id}`);
      const ran = prev.status !== row.status ? await runAutomations('lead.status', { type: 'lead', row }, me.id) : [];
      return done({ id: row.id, ran });
    }
    const [row] = await db.insert(schema.leads).values({ ...values, consentAt: consent ? new Date() : null }).returning();
    await history('lead', row.id, me.id, null, row, LEAD_LABELS);
    if (row.ownerId !== me.id) await notify([row.ownerId], 'New lead assigned to you', fullName(row), `/leads/${row.id}`);
    return done({ id: row.id, ran: await runAutomations('lead.created', { type: 'lead', row }, me.id) });
  });
}
export async function setLeadStatus(ids: string[], status: Lead['status'], disqualReason?: string) {
  return crmGuard<{ ran: string[] }>(async (me) => {
    if (status === 'Unqualified' && !disqualReason) return fail('Choose why these leads are unqualified.');
    const ran: string[] = [];
    for (const id of ids) {
      const prev = await db.query.leads.findFirst({ where: eq(schema.leads.id, id) });
      if (!prev || prev.status === status || !canEdit(me, prev.ownerId)) continue;
      const [row] = await db.update(schema.leads).set({ status, disqualReason: status === 'Unqualified' ? disqualReason : null, updatedAt: new Date(),
        firstContactedAt: prev.firstContactedAt ?? (status !== 'New' ? new Date() : null) }).where(eq(schema.leads.id, id)).returning();
      ran.push(...await runAutomations('lead.status', { type: 'lead', row }, me.id));
    }
    return done({ ran });
  });
}
export async function convertLead(id: string, opts: { createDeal: boolean; dealName?: string; pipelineId?: string; subPipelineId?: string; stageId?: string; amount?: number | null; currency?: string; closingDate?: string }) {
  return crmGuard<{ contactId: string; dealId: string | null }>(async (me) => {
    const l = await db.query.leads.findFirst({ where: eq(schema.leads.id, id) }); if (!l) return fail('This lead no longer exists.');
    if (l.status === 'Converted') return fail('This lead is already converted.');
    let companyId: string | null = null;
    if (l.companyName) {
      const co = await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${l.companyName.toLowerCase()}` });
      companyId = co?.id ?? (await db.insert(schema.companies).values({ name: l.companyName, website: l.website, emirate: l.emirate, industry: l.industry, employees: l.companySize, ownerId: l.ownerId || me.id }).returning())[0].id;
    }
    let contactId: string | null = null;
    if (l.email) contactId = (await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${l.email.toLowerCase()}` }))?.id ?? null;
    if (!contactId) contactId = (await db.insert(schema.contacts).values({ firstName: l.firstName, lastName: l.lastName, jobTitle: l.jobTitle, email: l.email, phone: l.phone, source: l.source, companyId, tags: l.tags, ownerId: l.ownerId || me.id,
      consent: l.consent, consentAt: l.consentAt, doNotContact: l.doNotContact }).returning())[0].id;
    let dealId: string | null = null;
    if (opts.createDeal) {
      if (!opts.dealName?.trim() || !opts.pipelineId || !opts.subPipelineId || !opts.stageId) return fail('Choose a name, pipeline and stage for the deal.');
      const [d] = await db.insert(schema.deals).values({ name: opts.dealName.trim(), pipelineId: opts.pipelineId, subPipelineId: opts.subPipelineId, stageId: opts.stageId, amount: opts.amount ?? null, currency: opts.currency || 'AED',
        companyId, contactId, closingDate: opts.closingDate || null, ownerId: l.ownerId || me.id, tags: l.tags, leadId: l.id, leadSource: l.source, dealType: 'New business' }).returning();
      dealId = d.id;
      if (l.productInterestId) {
        const p = await db.query.products.findFirst({ where: eq(schema.products.id, l.productInterestId) });
        if (p) await db.insert(schema.dealItems).values({ dealId: d.id, productId: p.id, name: p.name, qty: 1, unitPrice: p.unitPrice });
      }
      await db.insert(schema.dealEvents).values([{ dealId: d.id, kind: 'created', text: `Converted from lead ${fullName(l)}${l.source ? ` (source: ${l.source})` : ''}`, userId: me.id }, { dealId: d.id, kind: 'stage', stageId: d.stageId, userId: me.id }]);
      await runAutomations('deal.created', { type: 'deal', row: d }, me.id);
    }
    await db.update(schema.activities).set({ relatedType: dealId ? 'deal' : 'contact', relatedId: dealId || contactId }).where(and(eq(schema.activities.relatedType, 'lead'), eq(schema.activities.relatedId, id)));
    await db.update(schema.notes).set({ relatedType: 'contact', relatedId: contactId }).where(and(eq(schema.notes.relatedType, 'lead'), eq(schema.notes.relatedId, id)));
    await db.update(schema.attachments).set({ relatedType: 'contact', relatedId: contactId }).where(and(eq(schema.attachments.relatedType, 'lead'), eq(schema.attachments.relatedId, id)));
    await db.update(schema.leads).set({ status: 'Converted', convertedAt: new Date(), convertedContactId: contactId, convertedDealId: dealId, firstContactedAt: l.firstContactedAt ?? new Date() }).where(eq(schema.leads.id, id));
    return done({ contactId, dealId });
  });
}

/* ============ contacts & companies ============ */
export async function saveContact(input: Record<string, unknown> & { id?: string; custom?: Record<string, unknown> }) {
  return crmGuard<{ id: string }>(async (me) => {
    const firstName = String(input.firstName || '').trim(); if (!firstName) return fail('First name is required.');
    const email = clean(input.email) as string | null; if (!emailOk(email)) return fail('That email address looks incomplete.');
    if (email) { const dup = await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${email.toLowerCase()}` }); if (dup && dup.id !== input.id) return fail(`${fullName(dup)} already uses this email.`); }
    for (const ph of [phone(input.mobile), phone(input.phone)].filter(Boolean) as string[]) {
      const dup = await db.query.contacts.findFirst({ where: sql`(${schema.contacts.phone} = ${ph} or ${schema.contacts.mobile} = ${ph}) and ${schema.contacts.id} <> ${input.id || '00000000-0000-0000-0000-000000000000'}` });
      if (dup && !input.allowPhoneDuplicate) return fail(`DUP_PHONE:${dup.id}:${fullName(dup)} already has the number ${ph}.`);
    }
    const companyId = clean(input.companyId) as string | null;
    // Product coverage is only kept for people at distributor-type companies.
    let productIds: string[] = [];
    if (companyId && Array.isArray(input.productIds) && input.productIds.length) {
      const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, companyId) });
      if (co && PRODUCT_HANDLING_TYPES.includes(co.accountType)) {
        const valid = new Set((await db.select({ id: schema.products.id }).from(schema.products)).map((p) => p.id));
        productIds = Array.from(new Set((input.productIds as string[]).filter((x) => valid.has(x))));
      }
    }
    const consent = !!input.consent;
    const values = { firstName, lastName: clean(input.lastName) as string | null, jobTitle: clean(input.jobTitle) as string | null, companyId, email,
      phone: phone(input.phone), mobile: phone(input.mobile), whatsapp: phone(input.whatsapp), department: clean(input.department) as string | null, buyingRole: clean(input.buyingRole) as string | null,
      linkedin: clean(input.linkedin) as string | null, language: clean(input.language) as string | null, birthday: clean(input.birthday) as string | null,
      consent, doNotContact: !!input.doNotContact, productIds,
      source: clean(input.source) as string | null, tags: tagsOf(input.tags), ownerId: (clean(input.ownerId) as string) || me.id, custom: await readCustom('contact', input.custom), updatedAt: new Date() };
    if (input.id) {
      const prev = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, input.id) }); if (!prev) return fail('This contact no longer exists.');
      if (!canEdit(me, prev.ownerId)) return fail('You can only edit contacts you own.');
      await db.update(schema.contacts).set({ ...values, consentAt: consent ? prev.consentAt ?? new Date() : null }).where(eq(schema.contacts.id, input.id));
      await history('contact', input.id, me.id, prev, values, CONTACT_LABELS); return done({ id: input.id });
    }
    const id = (await db.insert(schema.contacts).values({ ...values, consentAt: consent ? new Date() : null }).returning())[0].id;
    await history('contact', id, me.id, null, values, CONTACT_LABELS);
    return done({ id });
  });
}
/** Distributor coverage: set the products one contact handles. */
export async function setContactProducts(contactId: string, productIds: string[]) {
  return crmGuard(async (me) => {
    const c = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) }); if (!c) return fail('This contact no longer exists.');
    if (!canEdit(me, c.ownerId)) return fail('You can only edit contacts you own.');
    const co = c.companyId ? await db.query.companies.findFirst({ where: eq(schema.companies.id, c.companyId) }) : null;
    if (!co || !PRODUCT_HANDLING_TYPES.includes(co.accountType)) return fail('Products handled can only be set for contacts at a distributor.');
    await db.update(schema.contacts).set({ productIds: Array.from(new Set(productIds)), updatedAt: new Date() }).where(eq(schema.contacts.id, contactId));
    return done();
  });
}
export async function saveCompany(input: Record<string, unknown> & { id?: string; custom?: Record<string, unknown> }) {
  return crmGuard<{ id: string }>(async (me) => {
    const name = String(input.name || '').trim(); if (!name) return fail('Company name is required.');
    const dup = await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${name.toLowerCase()}` });
    if (dup && dup.id !== input.id) return fail('A company with this name already exists.');
    const trn = (clean(input.vatTrn) as string | null)?.replace(/\s/g, '') || null;
    if (!isValidTrn(trn)) return fail('A UAE TRN has exactly 15 digits.');
    const num = (v: unknown) => v == null || v === '' ? null : +(v as number);
    const values = { name, industry: clean(input.industry) as string | null, website: clean(input.website) as string | null, phone: phone(input.phone), city: clean(input.city) as string | null,
      country: clean(input.country) as string | null, vatTrn: trn, accountType: (clean(input.accountType) as string) || 'Prospect', sector: clean(input.sector) as string | null,
      emirate: clean(input.emirate) as string | null, zone: clean(input.zone) as string | null, tradeLicenceNo: clean(input.tradeLicenceNo) as string | null,
      tradeLicenceExpiry: clean(input.tradeLicenceExpiry) as string | null, employees: clean(input.employees) as string | null, annualRevenue: num(input.annualRevenue),
      linkedin: clean(input.linkedin) as string | null, customerSince: clean(input.customerSince) as string | null, tier: clean(input.tier) as string | null,
      parentId: clean(input.parentId) as string | null,
      ownerId: (clean(input.ownerId) as string) || me.id, custom: await readCustom('company', input.custom), updatedAt: new Date() };
    if (values.parentId && input.id) {
      const all = await db.select({ id: schema.companies.id, parentId: schema.companies.parentId }).from(schema.companies);
      for (let cur: string | null = values.parentId, i = 0; cur && i < 50; i++) { if (cur === input.id) return fail('That would make the company its own parent.'); cur = all.find((c) => c.id === cur)?.parentId ?? null; }
    }
    if (input.id) {
      const prev = await db.query.companies.findFirst({ where: eq(schema.companies.id, input.id) }); if (!prev) return fail('This company no longer exists.');
      if (!canEdit(me, prev.ownerId)) return fail('You can only edit companies you own.');
      await db.update(schema.companies).set({ ...values, licenceReminderFor: prev.tradeLicenceExpiry === values.tradeLicenceExpiry ? prev.licenceReminderFor : null }).where(eq(schema.companies.id, input.id));
      // Leaving distributor type clears product coverage on its contacts.
      if (PRODUCT_HANDLING_TYPES.includes(prev.accountType) && !PRODUCT_HANDLING_TYPES.includes(values.accountType)) await db.update(schema.contacts).set({ productIds: [] }).where(eq(schema.contacts.companyId, input.id));
      await history('company', input.id, me.id, prev, values, COMPANY_LABELS);
      return done({ id: input.id });
    }
    const id = (await db.insert(schema.companies).values(values).returning())[0].id;
    await history('company', id, me.id, null, values, COMPANY_LABELS);
    return done({ id });
  });
}

/* ============ deals ============ */
export type MissingItem = { key: string; label: string; field?: { id: string; label: string; type: CustomFieldType; options: string[] } };
const REQ_LABEL: Record<string, string> = { amount: 'Amount', closingDate: 'Closing date', contact: 'Contact', company: 'Company', products: 'Products', note: 'A note', nextActivity: 'A next activity' };
async function missingFor(d: Deal, toStageId: string): Promise<MissingItem[]> {
  const rules = (await db.select().from(schema.stageRules).where(eq(schema.stageRules.pipelineId, d.pipelineId))).filter((r) => r.toStageId === toStageId && (!r.fromStageId || r.fromStageId === d.stageId));
  const req = Array.from(new Set(rules.flatMap((r) => r.requiredItems)));
  const out: MissingItem[] = [];
  for (const k of req) {
    if (k === 'amount' && d.amount == null) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k === 'closingDate' && !d.closingDate) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k === 'contact' && !d.contactId) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k === 'company' && !d.companyId) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k === 'products' && !(await db.select({ c: sql<number>`count(*)` }).from(schema.dealItems).where(eq(schema.dealItems.dealId, d.id)))[0].c) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k === 'note' && !(await db.select({ c: sql<number>`count(*)` }).from(schema.notes).where(and(eq(schema.notes.relatedType, 'deal'), eq(schema.notes.relatedId, d.id))))[0].c) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k === 'nextActivity' && !(await db.select({ c: sql<number>`count(*)` }).from(schema.activities).where(and(eq(schema.activities.relatedType, 'deal'), eq(schema.activities.relatedId, d.id), eq(schema.activities.done, false))))[0].c) out.push({ key: k, label: REQ_LABEL[k] });
    else if (k.startsWith('cf:')) {
      const f = await db.query.customFields.findFirst({ where: eq(schema.customFields.id, k.slice(3)) });
      const v = (d.custom as Record<string, unknown>)[k.slice(3)];
      if (f && (v == null || v === '' || v === false)) out.push({ key: k, label: f.label, field: { id: f.id, label: f.label, type: f.type, options: f.options } });
    }
  }
  return out;
}
export async function checkMove(dealId: string, toStageId: string) {
  return crmGuard<{ missing: MissingItem[]; stageType: string; stageName: string }>(async () => {
    const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, dealId) }); if (!d) return fail('This deal no longer exists.');
    const st = await db.query.stages.findFirst({ where: eq(schema.stages.id, toStageId) }); if (!st) return fail('That stage no longer exists.');
    return { ok: true, missing: await missingFor(d, toStageId), stageType: st.type, stageName: st.name };
  });
}
type MoveExtra = { amount?: number; closingDate?: string; contactId?: string; companyId?: string; note?: string; nextActivity?: { title: string; dueDate: string }; custom?: Record<string, unknown>; lossReason?: string; competitor?: string; winReason?: string };
/** When a deal is won: fix its AED value, and make its company a customer. */
async function onWon(row: Deal) {
  const s = await getSettings();
  await db.update(schema.deals).set({ amountBase: Math.round(toBase(row.amount, row.currency, s) * 100) / 100 }).where(eq(schema.deals.id, row.id));
  if (row.companyId) {
    const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, row.companyId) });
    if (co) await db.update(schema.companies).set({ customerSince: co.customerSince ?? todayISO(), accountType: co.accountType === 'Prospect' ? 'Customer' : co.accountType }).where(eq(schema.companies.id, co.id));
  }
  // Licences go into the customer's register; a new customer gets an onboarding ticket in the helpdesk.
  try { const { licencesFromDeal } = await import('./licences'); await licencesFromDeal(row); } catch (e) { log.error('licences_from_deal_failed', { deal: row.id, error: String(e) }); }
  try { const { wonDealHandoff } = await import('./handoff'); await wonDealHandoff(row, null); } catch (e) { log.error('won_handoff_failed', { deal: row.id, error: String(e) }); }
}
export async function moveDeal(dealId: string, toStageId: string, extra: MoveExtra = {}) {
  return crmGuard<{ ran: string[] }>(async (me) => {
    let d = await db.query.deals.findFirst({ where: eq(schema.deals.id, dealId) }); if (!d) return fail('This deal no longer exists.');
    if (!canEdit(me, d.ownerId)) return fail('You can only move deals you own.');
    const st = await db.query.stages.findFirst({ where: eq(schema.stages.id, toStageId) }); if (!st) return fail('That stage no longer exists.');
    if (st.subPipelineId !== d.subPipelineId) return fail('That stage belongs to another pipeline.');
    // apply provided details first, then re-check the rules
    const patch: Partial<Deal> = {};
    if (extra.amount != null) patch.amount = +extra.amount;
    if (extra.closingDate) patch.closingDate = extra.closingDate;
    if (extra.contactId) patch.contactId = extra.contactId;
    if (extra.companyId) patch.companyId = extra.companyId;
    if (extra.custom) patch.custom = { ...(d.custom as object), ...extra.custom };
    if (Object.keys(patch).length) d = (await db.update(schema.deals).set(patch).where(eq(schema.deals.id, dealId)).returning())[0];
    if (extra.note?.trim()) await db.insert(schema.notes).values({ relatedType: 'deal', relatedId: dealId, body: extra.note.trim(), authorId: me.id });
    if (extra.nextActivity?.title?.trim()) await db.insert(schema.activities).values({ type: 'task', title: extra.nextActivity.title.trim(), dueDate: extra.nextActivity.dueDate || todayISO(), relatedType: 'deal', relatedId: dealId, ownerId: d.ownerId || me.id });
    const miss = await missingFor(d, toStageId);
    if (miss.length) return fail(`This stage needs: ${miss.map((m) => m.label.toLowerCase()).join(', ')}.`);
    if (st.type === 'lost' && !extra.lossReason) return fail('Choose a loss reason.');
    if (st.type === 'won' && !extra.winReason) return fail('Choose why this deal was won.');
    const [row] = await db.update(schema.deals).set({ stageId: toStageId, stageEnteredAt: new Date(), closedAt: st.type === 'open' ? null : new Date(),
      lossReason: st.type === 'lost' ? extra.lossReason : null, competitor: st.type === 'lost' ? extra.competitor || null : null,
      winReason: st.type === 'won' ? extra.winReason : null, amountBase: st.type === 'open' ? null : d.amountBase, updatedAt: new Date() }).where(eq(schema.deals.id, dealId)).returning();
    if (st.type === 'won') await onWon(row);
    if (st.type === 'lost') { const s = await getSettings(); await db.update(schema.deals).set({ amountBase: Math.round(toBase(row.amount, row.currency, s) * 100) / 100 }).where(eq(schema.deals.id, row.id)); }
    await db.insert(schema.dealEvents).values({ dealId, kind: 'stage', stageId: toStageId, userId: me.id, text: st.type === 'won' ? `Won: ${extra.winReason}` : st.type === 'lost' ? `Lost: ${extra.lossReason}` : null });
    const ran = await runAutomations('deal.stage', { type: 'deal', row }, me.id);
    if (st.type === 'won') ran.push(...await runAutomations('deal.won', { type: 'deal', row }, me.id));
    if (st.type === 'lost') ran.push(...await runAutomations('deal.lost', { type: 'deal', row }, me.id));
    return done({ ran });
  });
}
const CHANGE_LABELS: [keyof Deal, string][] = [['name', 'Name'], ['amount', 'Amount'], ['currency', 'Currency'], ['closingDate', 'Closing date'], ['priority', 'Priority'], ['ownerId', 'Owner'], ['companyId', 'Company'], ['contactId', 'Contact'],
  ['dealType', 'Deal type'], ['nextStep', 'Next step'], ['contractStart', 'Contract start'], ['contractEnd', 'Contract end'], ['recurringValue', 'Recurring value'], ['tenderNumber', 'Tender number'], ['submissionDeadline', 'Submission deadline'], ['poNumber', 'PO number'], ['paymentTerms', 'Payment terms'], ['distributorId', 'Distributor'], ['resellerId', 'Reseller'], ['dealRegNumber', 'Deal registration'], ['dealRegExpiry', 'Registration expiry'], ['forecastCategory', 'Forecast category']];
export async function saveDeal(input: Partial<Deal> & { custom?: Record<string, unknown> }) {
  return crmGuard<{ id: string; ran: string[] }>(async (me) => {
    const name = String(input.name || '').trim(); if (!name) return fail('Give the deal a name.');
    if (!input.pipelineId || !input.subPipelineId || !input.stageId) return fail('Choose a pipeline and stage.');
    const num = (v: unknown) => v == null || v === '' ? null : +(v as number);
    const contractStart = clean(input.contractStart) as string | null; const termMonths = num(input.termMonths);
    const contractEnd = (clean(input.contractEnd) as string | null) || contractEndFrom(contractStart, termMonths);
    if (contractStart && contractEnd && contractEnd < contractStart) return fail('The contract end is before its start.');
    const values = { name, pipelineId: input.pipelineId, subPipelineId: input.subPipelineId, amount: num(input.amount), currency: input.currency || 'AED',
      companyId: clean(input.companyId) as string | null, contactId: clean(input.contactId) as string | null, closingDate: clean(input.closingDate) as string | null, priority: (input.priority || 'Medium') as Deal['priority'],
      description: clean(input.description) as string | null, tags: tagsOf(input.tags), ownerId: (clean(input.ownerId) as string) || me.id, custom: await readCustom('deal', input.custom, input.pipelineId),
      dealType: (clean(input.dealType) as string) || 'New business', leadSource: clean(input.leadSource) as string | null, nextStep: clean(input.nextStep) as string | null,
      contractStart, contractEnd, termMonths, recurringValue: num(input.recurringValue), tenderNumber: clean(input.tenderNumber) as string | null, submissionDeadline: clean(input.submissionDeadline) as string | null,
      poNumber: clean(input.poNumber) as string | null, paymentTerms: clean(input.paymentTerms) as string | null,
      distributorId: clean(input.distributorId) as string | null, resellerId: clean(input.resellerId) as string | null, dealRegNumber: clean(input.dealRegNumber) as string | null,
      dealRegExpiry: clean(input.dealRegExpiry) as string | null, forecastCategory: ['Pipeline', 'Best case', 'Commit'].includes(String(input.forecastCategory)) ? String(input.forecastCategory) : 'Pipeline', updatedAt: new Date() };
    if (input.id) {
      const prev = await db.query.deals.findFirst({ where: eq(schema.deals.id, input.id) }); if (!prev) return fail('This deal no longer exists.');
      if (!canEdit(me, prev.ownerId)) return fail('You can only edit deals you own.');
      const [row] = await db.update(schema.deals).set({ ...values, stageId: prev.subPipelineId === values.subPipelineId ? prev.stageId : input.stageId }).where(eq(schema.deals.id, input.id)).returning();
      const changes = CHANGE_LABELS.filter(([k]) => String(prev[k] ?? '') !== String(row[k] ?? '')).map(([, l]) => l);
      if (changes.length) await db.insert(schema.dealEvents).values({ dealId: row.id, kind: 'change', text: `Updated ${changes.join(', ').toLowerCase()}`, userId: me.id });
      if (prev.stageId !== row.stageId) await db.insert(schema.dealEvents).values({ dealId: row.id, kind: 'stage', stageId: row.stageId, userId: me.id });
      if (prev.ownerId !== row.ownerId && row.ownerId !== me.id) await notify([row.ownerId], 'Deal assigned to you', row.name, `/deals/${row.id}`);
      return done({ id: row.id, ran: [] });
    }
    const st = await db.query.stages.findFirst({ where: eq(schema.stages.id, input.stageId) });
    const [row] = await db.insert(schema.deals).values({ ...values, stageId: input.stageId, closedAt: st && st.type !== 'open' ? new Date() : null }).returning();
    await db.insert(schema.dealEvents).values([{ dealId: row.id, kind: 'created', text: 'Created', userId: me.id }, { dealId: row.id, kind: 'stage', stageId: row.stageId, userId: me.id }]);
    if (st?.type === 'won') await onWon(row);
    if (row.ownerId !== me.id) await notify([row.ownerId], 'New deal assigned to you', row.name, `/deals/${row.id}`);
    return done({ id: row.id, ran: await runAutomations('deal.created', { type: 'deal', row }, me.id) });
  });
}
/** Copy a deal (details and products) into the first open stage as a new record. */
export async function cloneDeal(id: string) {
  return crmGuard<{ id: string }>(async (me) => {
    const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, id) }); if (!d) return fail('This deal no longer exists.');
    const st = (await db.select().from(schema.stages).where(eq(schema.stages.subPipelineId, d.subPipelineId)).orderBy(asc(schema.stages.sortOrder))).find((s) => s.type === 'open');
    if (!st) return fail('This pipeline has no open stage.');
    const { id: _i, createdAt: _c, updatedAt: _u, closedAt: _cl, stageEnteredAt: _s, lossReason: _l, winReason: _w, competitor: _co, amountBase: _a, renewalDealId: _r, isSample: _is, ...rest } = d;
    void _i; void _c; void _u; void _cl; void _s; void _l; void _w; void _co; void _a; void _r; void _is;
    const [nd] = await db.insert(schema.deals).values({ ...rest, name: `${d.name} (copy)`, stageId: st.id, ownerId: me.role === 'rep' ? me.id : d.ownerId, poNumber: null, sourceDealId: null }).returning();
    const items = await db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, id));
    if (items.length) await db.insert(schema.dealItems).values(items.map(({ id: _x, dealId: _d, ...i }) => { void _x; void _d; return { ...i, dealId: nd.id }; }));
    await db.insert(schema.dealEvents).values([{ dealId: nd.id, kind: 'created', text: `Copied from ${d.name}`, userId: me.id }, { dealId: nd.id, kind: 'stage', stageId: st.id, userId: me.id }]);
    return done({ id: nd.id });
  });
}
export async function setDealClosing(id: string, closingDate: string) {
  return crmGuard(async (me) => {
    const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, id) }); if (!d || !canEdit(me, d.ownerId)) return fail('You can only edit deals you own.');
    await db.update(schema.deals).set({ closingDate, updatedAt: new Date() }).where(eq(schema.deals.id, id));
    await db.insert(schema.dealEvents).values({ dealId: id, kind: 'change', text: `Closing date moved to ${closingDate}`, userId: me.id });
    return done();
  });
}
async function editableDeal(me: SessionUser, dealId: string) {
  const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, dealId) });
  if (!d) throw new UserError('This deal no longer exists.');
  if (!canEdit(me, d.ownerId)) throw new UserError('You can only change products on deals you own.');
  return d;
}
export async function addDealItem(dealId: string, productId: string, qty: number, unitPrice: number | null, discountPct: number) {
  return crmGuard(async (me) => {
    const p = await db.query.products.findFirst({ where: eq(schema.products.id, productId) }); if (!p) return fail('Choose a product.');
    const d = await editableDeal(me, dealId);
    const s = await getSettings(); const rate = s.currencies[d.currency] || 1;
    await db.insert(schema.dealItems).values({ dealId, productId, name: p.name, qty: qty || 1, unitPrice: unitPrice ?? Math.round((p.unitPrice / rate) * 100) / 100, discountPct: discountPct || 0 });
    return done();
  });
}
export async function removeDealItem(id: string) {
  return crmGuard(async (me) => {
    const it = await db.query.dealItems.findFirst({ where: eq(schema.dealItems.id, id) }); if (!it) return done();
    await editableDeal(me, it.dealId);
    await db.delete(schema.dealItems).where(eq(schema.dealItems.id, id)); return done();
  });
}
export async function setAmountFromItems(dealId: string) {
  return crmGuard(async (me) => {
    await editableDeal(me, dealId);
    const items = await db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, dealId));
    const total = Math.round(items.reduce((s, i) => s + i.qty * i.unitPrice * (1 - i.discountPct / 100), 0) * 100) / 100;
    await db.update(schema.deals).set({ amount: total, updatedAt: new Date() }).where(eq(schema.deals.id, dealId));
    await db.insert(schema.dealEvents).values({ dealId, kind: 'change', text: 'Amount set from products', userId: me.id });
    return done();
  });
}

/* ============ activities & notes ============ */
const CONTACT_TYPES = ['call', 'meeting', 'email', 'whatsapp'];
/** A completed call/meeting/email/WhatsApp updates "last contacted" on the person and "first contacted" on a lead. */
async function touchContacted(relatedType: string | null, relatedId: string | null, type: string) {
  if (!relatedType || !relatedId || !CONTACT_TYPES.includes(type)) return;
  const now = new Date();
  if (relatedType === 'contact') await db.update(schema.contacts).set({ lastContactedAt: now }).where(eq(schema.contacts.id, relatedId));
  if (relatedType === 'deal') { const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, relatedId) }); if (d?.contactId) await db.update(schema.contacts).set({ lastContactedAt: now }).where(eq(schema.contacts.id, d.contactId)); }
  if (relatedType === 'lead') await db.update(schema.leads).set({ firstContactedAt: sql`coalesce(${schema.leads.firstContactedAt}, now())` }).where(eq(schema.leads.id, relatedId));
}
/** A repeating activity creates its next occurrence when it is completed. */
async function scheduleNext(a: typeof schema.activities.$inferSelect) {
  if (!a.repeat || !['weekly', 'monthly', 'quarterly'].includes(a.repeat)) return;
  const base = a.dueDate || todayISO(); const [y, m, d] = base.split('-').map(Number);
  const next = a.repeat === 'weekly' ? addDaysISO(7, base) : new Date(Date.UTC(y, m - 1 + (a.repeat === 'monthly' ? 1 : 3), d)).toISOString().slice(0, 10);
  const { id: _i, createdAt: _c, done: _d, doneAt: _da, outcome: _o, managerAlertedAt: _m, ...rest } = a; void _i; void _c; void _d; void _da; void _o; void _m;
  await db.insert(schema.activities).values({ ...rest, dueDate: next, done: false });
}
type ActInput = { id?: string; type?: string; title?: string; details?: string; dueDate?: string; dueTime?: string; relatedType?: string; relatedId?: string; ownerId?: string; done?: boolean; durationMin?: number | string | null; location?: string; attendees?: string; outcome?: string; repeat?: string };
export async function saveActivity(input: ActInput) {
  return crmGuard<{ id: string }>(async (me) => {
    const title = String(input.title || '').trim(); if (!title) return fail('Give the activity a title.');
    const scope = await taskScope(me);
    const owner = (clean(input.ownerId) as string) || me.id;
    if (!canSeeTask(scope, owner)) return fail('You can only assign tasks to yourself or people who report to you.');
    let prev: typeof schema.activities.$inferSelect | undefined;
    if (input.id) { prev = await db.query.activities.findFirst({ where: eq(schema.activities.id, input.id) }); if (!prev || !canSeeTask(scope, prev.ownerId)) return fail('You can only edit your own tasks or your team’s.'); }
    const values = { type: (input.type || 'task') as 'task', title, details: clean(input.details) as string | null, dueDate: clean(input.dueDate) as string | null, dueTime: clean(input.dueTime) as string | null,
      relatedType: clean(input.relatedType) as string | null, relatedId: clean(input.relatedId) as string | null, ownerId: owner, done: !!input.done, doneAt: input.done ? prev?.doneAt ?? new Date() : null,
      durationMin: input.durationMin == null || input.durationMin === '' ? null : Math.max(0, Math.round(+input.durationMin)), location: clean(input.location) as string | null,
      attendees: clean(input.attendees) as string | null, outcome: clean(input.outcome) as string | null, repeat: ['weekly', 'monthly', 'quarterly'].includes(String(input.repeat)) ? String(input.repeat) : null };
    if (values.done && !prev?.done) { await touchContacted(values.relatedType, values.relatedId, values.type); if (prev) await scheduleNext({ ...prev, ...values }); }
    if (input.id) { await db.update(schema.activities).set(values).where(eq(schema.activities.id, input.id)); return done({ id: input.id }); }
    const [row] = await db.insert(schema.activities).values(values).returning();
    if (owner !== me.id) await notify([owner], `${me.name} gave you a ${values.type}`, title, `/activities?user=${owner}`);
    return done({ id: row.id });
  });
}
export async function toggleActivity(id: string, outcome?: string) {
  return crmGuard(async (me) => {
    const a = await db.query.activities.findFirst({ where: eq(schema.activities.id, id) }); if (!a) return fail('This activity no longer exists.');
    if (!canSeeTask(await taskScope(me), a.ownerId)) return fail('You can only update your own tasks or your team’s.');
    await db.update(schema.activities).set({ done: !a.done, doneAt: a.done ? null : new Date(), ...(outcome ? { outcome } : {}) }).where(eq(schema.activities.id, id));
    if (!a.done) { await touchContacted(a.relatedType, a.relatedId, a.type); await scheduleNext(a); }
    return done();
  });
}
export async function addNote(relatedType: string, relatedId: string, body: string) {
  return crmGuard(async (me) => {
    if (!body.trim()) return fail('Write something first.');
    if (!['lead', 'deal', 'contact', 'company'].includes(relatedType)) return fail('Unknown record.');
    await db.insert(schema.notes).values({ relatedType, relatedId, body: body.trim(), authorId: me.id });
    // @Name mentions notify colleagues who have CRM access.
    if (body.includes('@')) {
      const us = await db.select({ id: schema.users.id, name: schema.users.name, active: schema.users.active, crm: schema.users.crmAccess, role: schema.users.role }).from(schema.users);
      const hit = us.filter((u) => u.id !== me.id && u.active && (u.crm || u.role === 'admin') && body.toLowerCase().includes('@' + u.name.toLowerCase()));
      const path = `/${relatedType === 'company' ? 'companies' : relatedType + 's'}/${relatedId}`;
      if (hit.length) await notify(hit.map((u) => u.id), `${me.name} mentioned you in a note`, body.trim().slice(0, 140), path);
    }
    return done();
  });
}
export async function deleteNote(id: string) {
  return crmGuard(async (me) => {
    const n = await db.query.notes.findFirst({ where: eq(schema.notes.id, id) });
    if (n && me.role === 'rep' && n.authorId !== me.id) return fail('You can only delete your own notes.');
    await db.delete(schema.notes).where(eq(schema.notes.id, id)); return done();
  });
}
export async function logEmail(relatedType: string, relatedId: string, subject: string, body: string) {
  return crmGuard(async (me) => {
    if (!subject.trim()) return fail('Add a subject before logging.');
    await db.insert(schema.activities).values({ type: 'email', title: `Email: ${subject.trim()}`, details: body, dueDate: todayISO(), done: true, doneAt: new Date(), relatedType, relatedId, ownerId: me.id });
    await touchContacted(relatedType, relatedId, 'email');
    return done();
  });
}

/* ============ products ============ */
export async function saveProduct(input: { id?: string; name?: string; sku?: string; category?: string; unitPrice?: number; costPrice?: number | string | null; billingType?: string; unit?: string; description?: string; active?: boolean }) {
  return crmGuard<{ id: string }>(async (me) => {
    await requireManager();
    const name = String(input.name || '').trim(); if (!name) return fail('Product name is required.');
    const values = { name, sku: clean(input.sku) as string | null, category: clean(input.category) as string | null, unitPrice: +(input.unitPrice || 0),
      costPrice: input.costPrice == null || input.costPrice === '' ? null : +input.costPrice, billingType: (clean(input.billingType) as string) || 'One-time', unit: clean(input.unit) as string | null,
      description: clean(input.description) as string | null, active: input.active !== false };
    if (!me.perms.viewCost) delete (values as { costPrice?: number | null }).costPrice; // can't see cost, so can't change it
    if (input.id) { await db.update(schema.products).set(values).where(eq(schema.products.id, input.id)); await audit(me.id, 'product.updated', 'product', input.id, name); return done({ id: input.id }); }
    const id = (await db.insert(schema.products).values(values).returning())[0].id;
    await audit(me.id, 'product.created', 'product', id, name);
    return done({ id });
  });
}

/* ============ generic bulk ============ */
type Entity = 'lead' | 'deal' | 'contact' | 'company' | 'activity' | 'product';
const TABLE = { lead: schema.leads, deal: schema.deals, contact: schema.contacts, company: schema.companies, activity: schema.activities, product: schema.products } as const;
export async function deleteRecords(entity: Entity, ids: string[]) {
  return crmGuard(async (me) => {
    if (!ids.length) return done();
    if (!me.perms.deleteRecords) return fail('Your role doesn’t allow deleting records. Ask an admin.');
    const t = TABLE[entity];
    if (entity === 'product') await requireManager();
    if (entity === 'activity') {
      const scope = await taskScope(me);
      const rows = await db.select({ ownerId: schema.activities.ownerId }).from(schema.activities).where(inArray(schema.activities.id, ids));
      if (rows.some((r) => !canSeeTask(scope, r.ownerId))) return fail('You can only delete your own tasks or your team’s.');
    } else if (me.role === 'rep' && 'ownerId' in t) {
      const rows = await db.select({ id: t.id, ownerId: (t as typeof schema.deals).ownerId }).from(t).where(inArray(t.id, ids));
      if (rows.some((r) => !canEdit(me, r.ownerId))) return fail('You can only delete records you own.');
    }
    if (['lead', 'deal', 'contact', 'company', 'product'].includes(entity)) await toTrash(entity, ids, me.id);
    await db.delete(t).where(inArray(t.id, ids));
    if (['lead', 'deal', 'contact', 'company'].includes(entity)) {
      await db.delete(schema.activities).where(and(eq(schema.activities.relatedType, entity), inArray(schema.activities.relatedId, ids)));
      await db.delete(schema.notes).where(and(eq(schema.notes.relatedType, entity), inArray(schema.notes.relatedId, ids)));
      await db.delete(schema.favorites).where(and(eq(schema.favorites.recordType, entity), inArray(schema.favorites.recordId, ids)));
    }
    if (entity !== 'activity') await audit(me.id, `${entity}.deleted`, entity, ids.length === 1 ? ids[0] : null, `${ids.length} record${ids.length === 1 ? '' : 's'}`);
    return done();
  });
}
/* ============ recycle bin ============ */
const LABEL: Record<string, (r: Record<string, unknown>) => string> = { lead: (r) => fullName(r as never), contact: (r) => fullName(r as never), deal: (r) => String(r.name), company: (r) => String(r.name), product: (r) => String(r.name) };
/** Saves everything needed to restore a record (and its activities, notes, files, links) for 30 days. */
async function toTrash(entity: string, ids: string[], by: string) {
  const t = TABLE[entity as Entity];
  for (const row of await db.select().from(t).where(inArray(t.id, ids)) as Record<string, unknown>[]) {
    const id = row.id as string; const data: Record<string, unknown> = { row };
    if (entity !== 'product') {
      data.activities = await db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, entity), eq(schema.activities.relatedId, id)));
      data.notes = await db.select().from(schema.notes).where(and(eq(schema.notes.relatedType, entity), eq(schema.notes.relatedId, id)));
      data.files = await db.select().from(schema.attachments).where(and(eq(schema.attachments.relatedType, entity), eq(schema.attachments.relatedId, id)));
    }
    if (entity === 'deal') { data.items = await db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, id)); data.events = await db.select().from(schema.dealEvents).where(eq(schema.dealEvents.dealId, id)); data.dealContacts = await db.select().from(schema.dealContacts).where(eq(schema.dealContacts.dealId, id)); }
    if (entity === 'contact') { data.dealIds = (await db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.contactId, id))).map((x) => x.id); data.dealContacts = await db.select().from(schema.dealContacts).where(eq(schema.dealContacts.contactId, id)); data.ticketIds = (await db.select({ id: schema.tickets.id }).from(schema.tickets).where(eq(schema.tickets.contactId, id))).map((x) => x.id); }
    if (entity === 'company') { data.dealIds = (await db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.companyId, id))).map((x) => x.id); data.contactIds = (await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.companyId, id))).map((x) => x.id); data.ticketIds = (await db.select({ id: schema.tickets.id }).from(schema.tickets).where(eq(schema.tickets.companyId, id))).map((x) => x.id); }
    await db.insert(schema.trash).values({ entity, recordId: id, label: LABEL[entity]?.(row) || id, data, deletedBy: by });
    await db.update(schema.attachments).set({ relatedType: `trash:${entity}` }).where(and(eq(schema.attachments.relatedType, entity), eq(schema.attachments.relatedId, id)));
  }
}
const revive = (r: Record<string, unknown>) => { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? new Date(v) : v; return o; };
/** Restore from the recycle bin. Managers restore anything; reps only what they deleted. */
export async function restoreFromTrash(trashId: string) {
  return guard(async (me) => {
    const item = await db.query.trash.findFirst({ where: eq(schema.trash.id, trashId) }); if (!item) return fail('That item is no longer in the recycle bin.');
    if (item.entity === 'ticket' ? me.deskRole !== 'admin' : !me.crmAccess || (me.role === 'rep' && item.deletedBy !== me.id)) return fail('You can’t restore this item.');
    const d = item.data as Record<string, Record<string, unknown>[] | Record<string, unknown> | string[]>;
    const row = revive(d.row as Record<string, unknown>);
    if (item.entity === 'ticket') {
      const sts = await db.select().from(schema.ticketStatuses); const deps = await db.select().from(schema.departments);
      if (!sts.some((x) => x.id === row.statusId)) row.statusId = sts[0].id; if (!deps.some((x) => x.id === row.departmentId)) row.departmentId = deps[0].id;
      await db.insert(schema.tickets).values(row as never);
      for (const [k, tbl] of [['threads', schema.ticketThreads], ['events', schema.ticketEvents], ['time', schema.ticketTime]] as const) { const rows = (d[k] as Record<string, unknown>[] | undefined) || []; if (rows.length) await db.insert(tbl).values(rows.map(revive) as never); }
      const files = (d.files as Record<string, unknown>[] | undefined) || []; if (files.length) await db.insert(schema.attachments).values(files.map(revive) as never).onConflictDoNothing();
    } else {
      const t = TABLE[item.entity as Entity];
      for (const fk of ['ownerId', 'companyId', 'contactId']) if (row[fk] && fk === 'ownerId' && !(await db.query.users.findFirst({ where: eq(schema.users.id, row[fk] as string) }))) row[fk] = null;
      if (row.companyId && !(await db.query.companies.findFirst({ where: eq(schema.companies.id, row.companyId as string) }))) row.companyId = null;
      if (row.contactId && !(await db.query.contacts.findFirst({ where: eq(schema.contacts.id, row.contactId as string) }))) row.contactId = null;
      if (item.entity === 'deal' && !(await db.query.stages.findFirst({ where: eq(schema.stages.id, row.stageId as string) }))) return fail('The deal’s pipeline stage was deleted, so it can’t be restored.');
      await db.insert(t).values(row as never);
      for (const [k, tbl] of [['activities', schema.activities], ['notes', schema.notes], ['items', schema.dealItems], ['events', schema.dealEvents]] as const) { const rows = (d[k] as Record<string, unknown>[] | undefined) || []; if (rows.length) await db.insert(tbl).values(rows.map(revive) as never).onConflictDoNothing(); }
      const dc = (d.dealContacts as Record<string, unknown>[] | undefined) || []; for (const x of dc) await db.insert(schema.dealContacts).values(revive(x) as never).onConflictDoNothing().catch(() => {});
      await db.update(schema.attachments).set({ relatedType: item.entity }).where(and(eq(schema.attachments.relatedType, `trash:${item.entity}`), eq(schema.attachments.relatedId, item.recordId)));
      const relink = async (ids: unknown, tbl: typeof schema.deals | typeof schema.contacts | typeof schema.tickets, col: string) => { const list = (ids as string[] | undefined) || []; if (list.length) await db.update(tbl).set({ [col]: item.recordId } as never).where(inArray(tbl.id, list)); };
      if (item.entity === 'contact') { await relink(d.dealIds, schema.deals, 'contactId'); await relink(d.ticketIds, schema.tickets, 'contactId'); }
      if (item.entity === 'company') { await relink(d.dealIds, schema.deals, 'companyId'); await relink(d.contactIds, schema.contacts, 'companyId'); await relink(d.ticketIds, schema.tickets, 'companyId'); }
    }
    await db.delete(schema.trash).where(eq(schema.trash.id, item.id));
    await audit(me.id, `${item.entity}.restored`, item.entity, item.recordId, item.label);
    return done();
  });
}
export async function purgeTrashItem(trashId: string) {
  return guard(async (me) => {
    await requireAdmin(); const item = await db.query.trash.findFirst({ where: eq(schema.trash.id, trashId) }); if (!item) return done();
    const { removeStored } = await import('./files');
    for (const f of await db.select().from(schema.attachments).where(and(eq(schema.attachments.relatedType, `trash:${item.entity}`), eq(schema.attachments.relatedId, item.recordId)))) await removeStored(f.storageKey);
    for (const f of ((item.data as { files?: { storageKey: string }[] }).files || [])) if (item.entity === 'ticket') await removeStored(f.storageKey);
    await db.delete(schema.attachments).where(and(eq(schema.attachments.relatedType, `trash:${item.entity}`), eq(schema.attachments.relatedId, item.recordId)));
    await db.delete(schema.trash).where(eq(schema.trash.id, item.id)); await audit(me.id, 'trash.purged', item.entity, item.recordId, item.label); return done();
  });
}

/* ============ history (leads, contacts, companies) ============ */
async function history(recordType: string, recordId: string, userId: string | null, prev: Record<string, unknown> | null, next: Record<string, unknown>, labels: Record<string, string>) {
  if (!prev) { await db.insert(schema.recordHistory).values({ recordType, recordId, userId, text: 'Created' }); return; }
  const norm = (v: unknown) => Array.isArray(v) ? v.join(',') : v instanceof Date ? v.toISOString() : String(v ?? '');
  const changed = Object.entries(labels).filter(([k]) => k in next && norm(prev[k]) !== norm(next[k])).map(([k, l]) => {
    const from = norm(prev[k]); const to = norm(next[k]);
    return from && to && from.length < 40 && to.length < 40 && !k.endsWith('Id') && k !== 'productIds' ? `${l}: ${from} → ${to}` : `${l} ${to ? (from ? 'changed' : 'added') : 'removed'}`;
  });
  if (changed.length) await db.insert(schema.recordHistory).values({ recordType, recordId, userId, text: changed.join(' · ') });
}
const LEAD_LABELS = { firstName: 'First name', lastName: 'Last name', companyName: 'Company', jobTitle: 'Job title', email: 'Email', phone: 'Phone', source: 'Source', status: 'Status', ownerId: 'Owner', industry: 'Industry', emirate: 'Emirate', budget: 'Budget', timeline: 'Timeline', campaign: 'Campaign', consent: 'Consent', doNotContact: 'Do not contact' };
const CONTACT_LABELS = { firstName: 'First name', lastName: 'Last name', jobTitle: 'Job title', companyId: 'Company', email: 'Email', phone: 'Office phone', mobile: 'Mobile', whatsapp: 'WhatsApp', department: 'Department', buyingRole: 'Buying role', ownerId: 'Owner', consent: 'Consent', doNotContact: 'Do not contact', productIds: 'Products handled' };
const COMPANY_LABELS = { name: 'Name', accountType: 'Account type', tier: 'Tier', industry: 'Industry', emirate: 'Emirate', phone: 'Phone', website: 'Website', vatTrn: 'TRN', tradeLicenceNo: 'Trade licence', tradeLicenceExpiry: 'Licence expiry', ownerId: 'Owner', parentId: 'Parent company' };

export async function bulkAssign(entity: 'lead' | 'deal' | 'contact', ids: string[], ownerId: string) {
  return crmGuard(async (me) => {
    if (me.role === 'rep') return fail('Only managers and admins can reassign records.');
    if (!me.perms.bulkEdit) return fail('Your role doesn’t allow bulk changes. Ask an admin.');
    const t = TABLE[entity]; await db.update(t).set({ ownerId } as never).where(inArray(t.id, ids));
    if (ownerId !== me.id) await notify([ownerId], `${ids.length} ${entity}${ids.length === 1 ? '' : 's'} assigned to you`, `By ${me.name}`, `/${entity === 'contact' ? 'contacts' : entity + 's'}`);
    await audit(me.id, `${entity}.reassigned`, entity, null, `${ids.length} to ${ownerId}`);
    return done();
  });
}
export async function bulkTag(entity: 'lead' | 'deal' | 'contact', ids: string[], tag: string) {
  return crmGuard(async (me) => {
    if (!me.perms.bulkEdit) return fail('Your role doesn’t allow bulk changes. Ask an admin.');
    const add = tagsOf(tag); if (!add.length) return fail('Type a tag.');
    const t = TABLE[entity] as typeof schema.deals;
    for (const r of await db.select({ id: t.id, tags: t.tags, ownerId: t.ownerId }).from(t).where(inArray(t.id, ids))) if (canEdit(me, r.ownerId)) await db.update(t).set({ tags: Array.from(new Set([...r.tags, ...add])) }).where(eq(t.id, r.id));
    return done();
  });
}

/* ============ inline edit ============ */
const INLINE: Record<string, Record<string, 'text' | 'number' | 'date' | 'phone' | 'select'>> = {
  lead: { status: 'select', source: 'text', phone: 'phone', companyName: 'text', jobTitle: 'text', emirate: 'text', ownerId: 'select' },
  contact: { jobTitle: 'text', phone: 'phone', mobile: 'phone', buyingRole: 'text', department: 'text', ownerId: 'select' },
  company: { accountType: 'text', industry: 'text', emirate: 'text', phone: 'phone', tier: 'text', ownerId: 'select' },
  deal: { amount: 'number', closingDate: 'date', nextStep: 'text', priority: 'select', ownerId: 'select' },
};
/** Saves one field from a list cell. Only the fields above can be edited this way. */
export async function updateField(entity: 'lead' | 'contact' | 'company' | 'deal', id: string, field: string, value: string | number | null) {
  return crmGuard(async (me) => {
    const kind = INLINE[entity]?.[field]; if (!kind) return fail('That field can’t be edited from the list.');
    const t = TABLE[entity] as typeof schema.deals;
    const [row] = await db.select().from(t).where(eq(t.id, id)); if (!row) return fail('This record no longer exists.');
    if (!canEdit(me, row.ownerId)) return fail('You can only edit records you own.');
    if (field === 'ownerId' && me.role === 'rep') return fail('Only managers and admins can reassign records.');
    if (entity === 'lead' && field === 'status') {
      if (value === 'Converted') return fail('Use Convert on the lead page.');
      if (value === 'Unqualified') return fail('Open the lead to choose why it is unqualified.');
      const r = await setLeadStatus([id], value as Lead['status']); return r.ok ? done() : r;
    }
    let v: unknown = value === '' ? null : value;
    if (kind === 'number' && v != null) { v = +v; if (Number.isNaN(v)) return fail('Enter a number.'); }
    if (kind === 'phone') v = normalizePhone(v as string | null);
    if (entity === 'deal' && field === 'priority' && !['Low', 'Medium', 'High'].includes(String(v))) return fail('Choose Low, Medium or High.');
    await db.update(t).set({ [field]: v, updatedAt: new Date() } as never).where(eq(t.id, id));
    if (entity !== 'deal') await history(entity, id, me.id, row as never, { [field]: v }, (entity === 'lead' ? LEAD_LABELS : entity === 'contact' ? CONTACT_LABELS : COMPANY_LABELS) as Record<string, string>);
    if (entity === 'deal' && ['amount', 'closingDate', 'nextStep', 'ownerId', 'priority'].includes(field)) await db.insert(schema.dealEvents).values({ dealId: id, kind: 'change', text: `Updated ${CHANGE_LABELS.find(([k]) => k === field)?.[1].toLowerCase() || field}`, userId: me.id });
    return done();
  });
}

/* ============ views, favourites, notifications ============ */
export async function saveView(page: string, name: string, query: string) {
  return guard(async (me) => { if (!name.trim()) return fail('Name the view.'); await db.insert(schema.savedViews).values({ userId: me.id, page, name: name.trim().slice(0, 60), query: query.slice(0, 1000) }); return done(); });
}
export async function deleteView(id: string) { return guard(async (me) => { await db.delete(schema.savedViews).where(and(eq(schema.savedViews.id, id), eq(schema.savedViews.userId, me.id))); return done(); }); }
export async function toggleFavorite(recordType: string, recordId: string, label: string) {
  return guard<{ on: boolean }>(async (me) => {
    const w = and(eq(schema.favorites.userId, me.id), eq(schema.favorites.recordType, recordType), eq(schema.favorites.recordId, recordId));
    const ex = await db.select({ id: schema.favorites.id }).from(schema.favorites).where(w);
    if (ex.length) { await db.delete(schema.favorites).where(w); return done({ on: false }); }
    await db.insert(schema.favorites).values({ userId: me.id, recordType, recordId, label: label.slice(0, 120) }).onConflictDoNothing();
    return done({ on: true });
  });
}
export async function markNotificationsRead(ids?: string[]) {
  return guard(async (me) => {
    const w = ids?.length ? and(eq(schema.notifications.userId, me.id), inArray(schema.notifications.id, ids)) : eq(schema.notifications.userId, me.id);
    await db.update(schema.notifications).set({ readAt: new Date() }).where(and(w, sql`${schema.notifications.readAt} is null`));
    return { ok: true };
  });
}
export async function deleteAttachment(id: string) {
  return guard(async (me) => {
    const a = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, id) }); if (!a) return done();
    if (!(await canUseFilesOf(me, a.relatedType, a.relatedId))) return fail('You can’t change files on this record.');
    if (me.role === 'rep' && me.deskRole !== 'admin' && a.uploadedBy !== me.id) return fail('You can only delete files you uploaded.');
    const { removeStored } = await import('./files');
    await removeStored(a.storageKey);
    await db.delete(schema.attachments).where(eq(schema.attachments.id, id));
    await audit(me.id, 'file.deleted', a.relatedType, a.relatedId, a.fileName);
    return done();
  });
}

/* ============ import & merge ============ */
export async function importRows(entity: 'lead' | 'contact' | 'company' | 'deal' | 'activity', rows: Record<string, string>[], mode: 'skip' | 'update') {
  return crmGuard<{ created: number; updated: number; skipped: number }>(async (me) => {
    await requireManager(); if (!me.perms.importData) return fail('Your role doesn’t allow importing. Ask an admin.');
    let created = 0, updated = 0, skipped = 0;
    const s = await getSettings();
    if (entity === 'deal' || entity === 'activity') {
      const users = await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users);
      const owner = (v?: string) => { const x = (v || '').toLowerCase(); return users.find((u) => u.email === x || u.name.toLowerCase() === x)?.id || me.id; };
      const pipes = await (await import('./data')).getPipelineTree();
      const companyId = async (name?: string) => { if (!name) return null; const co = await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${name.toLowerCase()}` }); return co?.id ?? (await db.insert(schema.companies).values({ name, ownerId: me.id }).returning())[0].id; };
      const contactId = async (email?: string) => email ? (await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${email.toLowerCase()}` }))?.id ?? null : null;
      for (const raw of rows.slice(0, 5000)) {
        const r: Record<string, string> = {}; for (const [k, v] of Object.entries(raw)) r[k] = String(v ?? '').trim();
        const date = (v?: string) => { if (!v) return null; const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null; };
        if (entity === 'deal') {
          if (!r.name) { skipped++; continue; }
          const pipe = pipes.find((p) => p.name.toLowerCase() === (r.pipeline || '').toLowerCase()) || pipes[0]; if (!pipe) return fail('Create a pipeline before importing deals.');
          const sub = pipe.subs[0]; const st = sub.stages.find((x) => x.name.toLowerCase() === (r.stage || '').toLowerCase()) || sub.stages[0];
          const dup = await db.query.deals.findFirst({ where: and(sql`lower(${schema.deals.name}) = ${r.name.toLowerCase()}`, eq(schema.deals.pipelineId, pipe.id)) });
          const amount = r.amount ? Number(r.amount.replace(/[^\d.-]/g, '')) : null;
          const vals = { name: r.name, amount: Number.isFinite(amount) ? amount : null, currency: /^[A-Z]{3}$/.test(r.currency || '') ? r.currency : 'AED', companyId: await companyId(r.company), contactId: await contactId(r.contactEmail), closingDate: date(r.closingDate), leadSource: r.source || null, ownerId: owner(r.owner) };
          if (dup) { if (mode === 'skip') { skipped++; continue; } await db.update(schema.deals).set(Object.fromEntries(Object.entries(vals).filter(([, v]) => v != null && v !== ''))).where(eq(schema.deals.id, dup.id)); updated++; continue; }
          const [d] = await db.insert(schema.deals).values({ ...vals, pipelineId: pipe.id, subPipelineId: sub.id, stageId: st.id, closedAt: st.type === 'open' ? null : new Date() }).returning();
          await db.insert(schema.dealEvents).values([{ dealId: d.id, kind: 'created', text: 'Imported', userId: me.id }, { dealId: d.id, kind: 'stage', stageId: st.id, userId: me.id }]); created++;
        } else {
          if (!r.title) { skipped++; continue; }
          const type = ['task', 'call', 'meeting', 'email', 'whatsapp'].includes((r.type || '').toLowerCase()) ? r.type.toLowerCase() : 'task';
          let relatedType: string | null = null, relatedId: string | null = null;
          const ct = await contactId(r.contactEmail); if (ct) { relatedType = 'contact'; relatedId = ct; }
          else if (r.company) { const co = await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${r.company.toLowerCase()}` }); if (co) { relatedType = 'company'; relatedId = co.id; } }
          const doneFlag = /^(yes|true|1|done|completed)$/i.test(r.done || '');
          await db.insert(schema.activities).values({ type: type as 'task', title: r.title, details: r.details || null, dueDate: date(r.dueDate), ownerId: owner(r.owner), relatedType, relatedId, done: doneFlag, doneAt: doneFlag ? new Date() : null }); created++;
        }
      }
      await audit(me.id, `${entity}.imported`, entity, null, `${created} created, ${updated} updated, ${skipped} skipped`);
      return done({ created, updated, skipped });
    }
    for (const raw of rows.slice(0, 5000)) {
      const r: Record<string, string> = {}; for (const [k, v] of Object.entries(raw)) r[k] = String(v ?? '').trim();
      if (entity !== 'company' && r.firstName && !r.lastName && r.firstName.includes(' ')) { const [f, ...rest] = r.firstName.split(/\s+/); r.firstName = f; r.lastName = rest.join(' '); }
      if (entity === 'company') {
        if (!r.name) { skipped++; continue; }
        const dup = await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${r.name.toLowerCase()}` });
        const vals = { name: r.name, industry: r.industry || null, website: r.website || null, phone: normalizePhone(r.phone), city: r.city || null, country: r.country || 'United Arab Emirates', vatTrn: r.vatTrn && isValidTrn(r.vatTrn) ? r.vatTrn.replace(/\s/g, '') : null, emirate: r.emirate || null, accountType: r.accountType || 'Prospect' };
        if (dup) { if (mode === 'skip') { skipped++; continue; } await db.update(schema.companies).set(Object.fromEntries(Object.entries(vals).filter(([, v]) => v))).where(eq(schema.companies.id, dup.id)); updated++; }
        else { await db.insert(schema.companies).values({ ...vals, ownerId: me.id }); created++; }
        continue;
      }
      if (!r.firstName) { skipped++; continue; }
      const table = entity === 'lead' ? schema.leads : schema.contacts;
      const dup = r.email ? (await db.select().from(table).where(sql`lower(${table.email}) = ${r.email.toLowerCase()}`).limit(1))[0] : undefined;
      if (dup && mode === 'skip') { skipped++; continue; }
      const common = { firstName: r.firstName, lastName: r.lastName || null, jobTitle: r.jobTitle || null, email: r.email || null, phone: normalizePhone(r.phone), source: r.source && s.leadSources.includes(r.source) ? r.source : r.source || null, tags: tagsOf(r.tags) };
      if (entity === 'lead') {
        const vals = { ...common, companyName: r.company || null, notes: r.notes || null };
        if (dup) { await db.update(schema.leads).set(Object.fromEntries(Object.entries(vals).filter(([, v]) => v && (!Array.isArray(v) || v.length)))).where(eq(schema.leads.id, dup.id)); updated++; }
        else { const [row] = await db.insert(schema.leads).values({ ...vals, ownerId: me.id }).returning(); await runAutomations('lead.created', { type: 'lead', row }, me.id); created++; }
      } else {
        let companyId: string | null = null;
        if (r.company) { const co = await db.query.companies.findFirst({ where: sql`lower(${schema.companies.name}) = ${r.company.toLowerCase()}` }); companyId = co?.id ?? (await db.insert(schema.companies).values({ name: r.company, ownerId: me.id }).returning())[0].id; }
        const vals = { ...common, companyId };
        if (dup) { await db.update(schema.contacts).set(Object.fromEntries(Object.entries(vals).filter(([, v]) => v && (!Array.isArray(v) || v.length)))).where(eq(schema.contacts.id, dup.id)); updated++; }
        else { await db.insert(schema.contacts).values({ ...vals, ownerId: me.id }); created++; }
      }
    }
    await audit(me.id, `${entity}.imported`, entity, null, `${created} created, ${updated} updated, ${skipped} skipped`);
    return done({ created, updated, skipped });
  });
}
export async function mergeRecords(entity: 'contact' | 'company', ids: string[]) {
  return crmGuard(async (me) => {
    if (me.role === 'rep') return fail('Only managers and admins can merge records.');
    const t = entity === 'contact' ? schema.contacts : schema.companies;
    const rows = (await db.select().from(t).where(inArray(t.id, ids))).sort((a, b) => +a.createdAt - +b.createdAt);
    if (rows.length < 2) return fail('Pick at least two records.');
    const [keep, ...rest] = rows as Record<string, unknown>[];
    const merged: Record<string, unknown> = { ...keep };
    for (const o of rest) for (const [k, v] of Object.entries(o)) if ((merged[k] == null || merged[k] === '') && v != null && v !== '') merged[k] = v;
    if ('tags' in keep) merged.tags = Array.from(new Set(rows.flatMap((r) => (r as { tags?: string[] }).tags || [])));
    merged.custom = Object.assign({}, ...rest.map((r) => r.custom || {}).reverse(), keep.custom || {});
    const { id, createdAt, ...upd } = merged; void createdAt;
    await db.update(t).set(upd as never).where(eq(t.id, id as string));
    const otherIds = rest.map((r) => r.id as string);
    const fk = entity === 'contact' ? schema.deals.contactId : schema.deals.companyId;
    await db.update(schema.deals).set(entity === 'contact' ? { contactId: id as string } : { companyId: id as string }).where(inArray(fk, otherIds));
    if (entity === 'company') await db.update(schema.contacts).set({ companyId: id as string }).where(inArray(schema.contacts.companyId, otherIds));
    await db.update(schema.activities).set({ relatedId: id as string }).where(and(eq(schema.activities.relatedType, entity), inArray(schema.activities.relatedId, otherIds)));
    await db.update(schema.notes).set({ relatedId: id as string }).where(and(eq(schema.notes.relatedType, entity), inArray(schema.notes.relatedId, otherIds)));
    await db.update(schema.attachments).set({ relatedId: id as string }).where(and(eq(schema.attachments.relatedType, entity), inArray(schema.attachments.relatedId, otherIds)));
    await db.delete(schema.favorites).where(and(eq(schema.favorites.recordType, entity), inArray(schema.favorites.recordId, otherIds)));
    await db.delete(t).where(inArray(t.id, otherIds));
    await audit(me.id, `${entity}.merged`, entity, id as string, `${rows.length} records merged`);
    return done();
  });
}

/* ============ settings (admin) ============ */
export async function saveOrg(patch: Partial<OrgSettings>) {
  return guard(async () => {
    const me = await requireAdmin();
    if (patch.vatTrn && !isValidTrn(patch.vatTrn)) return fail('A UAE TRN has exactly 15 digits.');
    for (const k of ['logoLight', 'logoDark'] as const) {
      const v = patch[k]; if (v == null || v === '') continue;
      if (!/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(v)) return fail('Upload the logo as PNG, JPG, SVG or WebP.');
      if (v.length > 400_000) return fail('Keep the logo under about 300 KB.');
    }
    if (patch.brandColor && !/^#[0-9a-f]{6}$/i.test(patch.brandColor)) return fail('Use a colour like #4C5BFF.');
    await saveSettings(patch);
    const keys = Object.keys(patch).filter((k) => k !== 'setupDismissed');
    if (keys.length) await audit(me.id, 'settings.changed', 'settings', null, keys.join(', '));
    return done();
  });
}
export async function savePipeline(input: { id?: string; name: string; recordName: string }) {
  return guard<{ id: string }>(async () => {
    await requireAdmin(); if (!input.name.trim()) return fail('Name the pipeline.');
    if (input.id) { await db.update(schema.pipelines).set({ name: input.name.trim(), recordName: input.recordName.trim() || 'Deal' }).where(eq(schema.pipelines.id, input.id)); return done({ id: input.id }); }
    const n = (await db.select({ c: sql<number>`count(*)` }).from(schema.pipelines))[0].c;
    const [p] = await db.insert(schema.pipelines).values({ name: input.name.trim(), recordName: input.recordName.trim() || 'Deal', sortOrder: Number(n) }).returning();
    const [sp] = await db.insert(schema.subPipelines).values({ pipelineId: p.id, name: 'Standard' }).returning();
    await db.insert(schema.stages).values([['New', 'open', 10, 14], ['In progress', 'open', 50, 14], ['Won', 'won', 100, null], ['Lost', 'lost', 0, null]].map(([name, type, probability, idleDays], i) => ({ subPipelineId: sp.id, name: name as string, type: type as 'open', probability: probability as number, idleDays: idleDays as number | null, sortOrder: i })));
    return done({ id: p.id });
  });
}
export async function deletePipeline(id: string) {
  return guard(async () => {
    await requireAdmin();
    const n = (await db.select({ c: sql<number>`count(*)` }).from(schema.deals).where(eq(schema.deals.pipelineId, id)))[0].c;
    if (Number(n)) return fail(`Move or delete the ${n} records in this pipeline first.`);
    await db.delete(schema.pipelines).where(eq(schema.pipelines.id, id)); return done();
  });
}
export async function saveSubPipeline(input: { id?: string; pipelineId: string; name: string }) {
  return guard(async () => {
    await requireAdmin(); if (!input.name.trim()) return fail('Name it.');
    if (input.id) { await db.update(schema.subPipelines).set({ name: input.name.trim() }).where(eq(schema.subPipelines.id, input.id)); return done(); }
    const subs = await db.select().from(schema.subPipelines).where(eq(schema.subPipelines.pipelineId, input.pipelineId)).orderBy(asc(schema.subPipelines.sortOrder));
    const [sp] = await db.insert(schema.subPipelines).values({ pipelineId: input.pipelineId, name: input.name.trim(), sortOrder: subs.length }).returning();
    const base = subs[0] ? await db.select().from(schema.stages).where(eq(schema.stages.subPipelineId, subs[0].id)).orderBy(asc(schema.stages.sortOrder)) : [];
    if (base.length) await db.insert(schema.stages).values(base.map((s) => ({ subPipelineId: sp.id, name: s.name, type: s.type, probability: s.probability, idleDays: s.idleDays, sortOrder: s.sortOrder })));
    return done();
  });
}
export async function saveStage(input: { id?: string; subPipelineId: string; name?: string; type?: 'open' | 'won' | 'lost'; probability?: number | null; idleDays?: number | null }) {
  return guard(async () => {
    await requireAdmin();
    if (input.id) {
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'type', 'probability', 'idleDays'] as const) if (k in input) patch[k] = input[k];
      if ('name' in patch && !String(patch.name).trim()) return fail('Stage needs a name.');
      await db.update(schema.stages).set(patch).where(eq(schema.stages.id, input.id)); return done();
    }
    const sts = await db.select().from(schema.stages).where(eq(schema.stages.subPipelineId, input.subPipelineId)).orderBy(asc(schema.stages.sortOrder));
    const pos = sts.findIndex((s) => s.type !== 'open'); const at = pos < 0 ? sts.length : pos;
    for (const s of sts.slice(at)) await db.update(schema.stages).set({ sortOrder: s.sortOrder + 1 }).where(eq(schema.stages.id, s.id));
    await db.insert(schema.stages).values({ subPipelineId: input.subPipelineId, name: input.name || 'New stage', type: 'open', probability: 50, idleDays: 14, sortOrder: at });
    return done();
  });
}
export async function reorderStages(ids: string[]) { return guard(async () => { await requireAdmin(); for (const [i, id] of ids.entries()) await db.update(schema.stages).set({ sortOrder: i }).where(eq(schema.stages.id, id)); return done(); }); }
export async function deleteStage(id: string) {
  return guard(async () => {
    await requireAdmin();
    const n = (await db.select({ c: sql<number>`count(*)` }).from(schema.deals).where(eq(schema.deals.stageId, id)))[0].c;
    if (Number(n)) return fail(`Move the ${n} records out of this stage first.`);
    const rules = await db.select().from(schema.stageRules).where(sql`${schema.stageRules.toStageId} = ${id} or ${schema.stageRules.fromStageId} = ${id}`);
    if (rules.length) return fail('Remove the stage rules that use this stage first.');
    const autos = (await db.select().from(schema.automations)).filter((a) => a.trigger.stageId === id || a.actions.createDeal?.stageId === id);
    if (autos.length) return fail(`The automation “${autos[0].name}” uses this stage. Edit it first.`);
    await db.delete(schema.stages).where(eq(schema.stages.id, id)); return done();
  });
}
export async function saveStageRule(input: { pipelineId: string; fromStageId: string | null; toStageId: string; requiredItems: string[] }) {
  return guard(async () => {
    await requireAdmin(); if (!input.toStageId) return fail('Choose the target stage.'); if (!input.requiredItems.length) return fail('Tick at least one required item.');
    if (input.fromStageId === input.toStageId) return fail('From and To must differ.');
    await db.insert(schema.stageRules).values({ ...input, fromStageId: input.fromStageId || null }); return done();
  });
}
export async function deleteStageRule(id: string) { return guard(async () => { await requireAdmin(); await db.delete(schema.stageRules).where(eq(schema.stageRules.id, id)); return done(); }); }
export async function saveCustomField(input: { id?: string; module: string; label: string; type: CustomFieldType; options: string[]; required: boolean; pipelineId?: string | null }) {
  return guard(async (me) => {
    await requireAdminFor(me, input.module === 'ticket');
    if (input.id) { const f = await db.query.customFields.findFirst({ where: eq(schema.customFields.id, input.id) }); if (f && (f.module === 'ticket') !== (input.module === 'ticket')) return fail('A field can’t move between the CRM and the helpdesk.'); }
    if (!input.label.trim()) return fail('Give the field a label.'); if (input.type === 'select' && !input.options.length) return fail('Add at least one option.');
    const v = { module: input.module, label: input.label.trim(), type: input.type, options: input.type === 'select' ? input.options : [], required: input.required, pipelineId: input.pipelineId || null };
    if (input.id) await db.update(schema.customFields).set(v).where(eq(schema.customFields.id, input.id));
    else await db.insert(schema.customFields).values({ ...v, sortOrder: Date.now() % 1e9 });
    return done();
  });
}
export async function deleteCustomField(id: string) {
  return guard(async (me) => {
    const f = await db.query.customFields.findFirst({ where: eq(schema.customFields.id, id) }); if (!f) return done();
    await requireAdminFor(me, f.module === 'ticket');
    const rules = (await db.select().from(schema.stageRules)).filter((r) => r.requiredItems.includes('cf:' + id));
    if (rules.length) return fail('A stage rule requires this field. Remove the rule first.');
    await db.delete(schema.customFields).where(eq(schema.customFields.id, id)); return done();
  });
}
export async function saveAutomation(input: { id?: string; name: string; active: boolean; trigger: AutomationTrigger; actions: AutomationActions }) {
  return guard(async (me) => {
    const ticketSide = input.trigger.event.startsWith('ticket'); await requireAdminFor(me, ticketSide);
    if (input.id) { const a = await db.query.automations.findFirst({ where: eq(schema.automations.id, input.id) }); if (a && a.trigger.event.startsWith('ticket') !== ticketSide) return fail('An automation can’t move between the CRM and the helpdesk. Create a new one instead.'); }
    if (!input.name.trim()) return fail('Name the automation.'); if (!Object.keys(input.actions).length) return fail('Choose at least one action.');
    if (input.trigger.event === 'deal.created' && input.actions.createDeal && (!input.trigger.pipelineId || input.trigger.pipelineId === input.actions.createDeal.pipelineId)) return fail('Creating a deal in the same pipeline when a deal is created would loop.');
    if (input.id) await db.update(schema.automations).set({ name: input.name.trim(), active: input.active, trigger: input.trigger, actions: input.actions }).where(eq(schema.automations.id, input.id));
    else await db.insert(schema.automations).values({ name: input.name.trim(), active: input.active, trigger: input.trigger, actions: input.actions });
    await audit((await requireUser()).id, input.id ? 'automation.updated' : 'automation.created', 'automation', input.id ?? null, input.name.trim());
    return done();
  });
}
const automationSide = async (id: string) => !!(await db.query.automations.findFirst({ where: eq(schema.automations.id, id) }))?.trigger.event.startsWith('ticket');
export async function toggleAutomation(id: string, active: boolean) { return guard(async (me) => { await requireAdminFor(me, await automationSide(id)); await db.update(schema.automations).set({ active }).where(eq(schema.automations.id, id)); return done(); }); }
export async function deleteAutomation(id: string) { return guard(async (me) => { await requireAdminFor(me, await automationSide(id)); await db.delete(schema.automations).where(eq(schema.automations.id, id)); return done(); }); }
export async function saveScoringRule(input: { field: string; operator: 'is' | 'contains' | 'filled'; value?: string; points: number }) {
  return guard(async () => { await requireAdmin(); if (input.operator !== 'filled' && !input.value?.trim()) return fail('Enter a value to match.'); await db.insert(schema.scoringRules).values({ ...input, value: input.value?.trim() || null }); return done(); });
}
export async function deleteScoringRule(id: string) { return guard(async () => { await requireAdmin(); await db.delete(schema.scoringRules).where(eq(schema.scoringRules.id, id)); return done(); }); }
export async function saveTemplate(input: { id?: string; name: string; subject: string; body: string }) {
  return crmGuard(async () => {
    await requireManager();
    if (!input.name.trim() || !input.subject.trim()) return fail('Name and subject are required.');
    if (input.id) await db.update(schema.emailTemplates).set({ name: input.name.trim(), subject: input.subject.trim(), body: input.body }).where(eq(schema.emailTemplates.id, input.id));
    else await db.insert(schema.emailTemplates).values({ name: input.name.trim(), subject: input.subject.trim(), body: input.body });
    return done();
  });
}
export async function deleteTemplate(id: string) { return crmGuard(async () => { await requireManager(); await db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.id, id)); return done(); }); }
export async function saveUser(input: { id?: string; name: string; email: string; role: 'admin' | 'manager' | 'rep'; password?: string; active?: boolean; managerId?: string | null; monthlyTarget?: number | string | null; reassignTo?: string | null; crmAccess?: boolean; deskRole?: DeskRole; ticketScope?: TicketScope; departmentIds?: string[] }) {
  return guard(async (me) => {
    if (me.role !== 'admin') {
      // Helpdesk admin (Helpdesk settings → Agents): full control of helpdesk-only people; only the helpdesk side of anyone else.
      if (me.deskRole !== 'admin') return fail('Only admins can manage users.');
      const prev = input.id ? await db.query.users.findFirst({ where: eq(schema.users.id, input.id) }) : null;
      if (input.id && !prev) return fail('This user no longer exists.');
      if (prev?.role === 'admin') return fail('Only workspace admins can change an admin.');
      const deskOnly = !prev || !prev.crmAccess;
      input = { ...input, role: prev ? (prev.role as 'rep') : 'rep', crmAccess: prev ? prev.crmAccess : false, monthlyTarget: prev ? prev.monthlyTarget : null,
        ...(deskOnly ? {} : { name: prev!.name, email: prev!.email, password: undefined, active: prev!.active, managerId: prev!.managerId, reassignTo: null }) };
      if (deskOnly && input.reassignTo) { const to = await db.query.users.findFirst({ where: eq(schema.users.id, input.reassignTo), columns: { deskRole: true } }); if (!to || to.deskRole === 'none') input.reassignTo = null; }
    }
    if (!input.name.trim() || !emailOk(input.email) || !input.email) return fail('Enter a name and a valid email.');
    const email = input.email.trim().toLowerCase();
    const managerId = input.managerId || null;
    const monthlyTarget = input.monthlyTarget == null || input.monthlyTarget === '' ? null : +input.monthlyTarget;
    if (managerId && input.id) {
      if (managerId === input.id) return fail('Someone cannot report to themselves.');
      const all = await db.select({ id: schema.users.id, managerId: schema.users.managerId }).from(schema.users);
      for (let cur: string | null = managerId, i = 0; cur && i < 100; i++) { if (cur === input.id) return fail('That would create a loop: the chosen manager already reports to this person.'); cur = all.find((u) => u.id === cur)?.managerId ?? null; }
    }
    if (input.password) { const p = passwordProblem(input.password, email); if (p) return fail(p); }
    const deskRole: DeskRole = input.role === 'admin' ? 'admin' : (['none', 'admin', 'agent', 'light'].includes(input.deskRole || '') ? input.deskRole! : 'none');
    const ticketScope: TicketScope = ['all', 'department', 'team', 'own'].includes(input.ticketScope || '') ? input.ticketScope! : 'own';
    const crmAccess = input.role === 'admin' || input.crmAccess !== false;
    if (!crmAccess && deskRole === 'none') return fail('Give this person access to at least one module (CRM or Desk).');
    const access = { crmAccess, deskRole, ticketScope };
    if (input.id) {
      const prev = await db.query.users.findFirst({ where: eq(schema.users.id, input.id) }); if (!prev) return fail('This user no longer exists.');
      if (input.id === me.id && input.role !== 'admin') return fail('You cannot remove your own admin role.');
      if (input.id === me.id && input.active === false) return fail('You cannot deactivate yourself.');
      const deactivating = prev.active && input.active === false;
      if (deactivating && input.reassignTo === input.id) return fail('Choose someone else to take over their records.');
      const patch: Record<string, unknown> = { name: input.name.trim(), email, role: input.role, active: input.active !== false, managerId, monthlyTarget, ...access };
      if (input.password) { patch.passwordHash = await bcrypt.hash(input.password, 10); patch.failedLogins = 0; patch.lockedUntil = null; }
      if (input.password || deactivating) patch.sessionVersion = prev.sessionVersion + 1;
      await db.update(schema.users).set(patch).where(eq(schema.users.id, input.id));
      if (input.departmentIds) await setDepartments(input.id, deskRole === 'none' ? [] : input.departmentIds);
      if (prev.deskRole !== deskRole || prev.crmAccess !== crmAccess || prev.ticketScope !== ticketScope) await audit(me.id, 'user.access_changed', 'user', input.id, `CRM ${crmAccess ? 'on' : 'off'}, Desk ${deskRole}${deskRole === 'agent' ? ` (${ticketScope})` : ''}`);
      // Removing helpdesk access un-assigns their open tickets so nothing is stranded.
      if (deskRole === 'none' || deskRole === 'light' || deactivating) await db.update(schema.tickets).set({ assigneeId: deactivating && input.reassignTo ? input.reassignTo : null }).where(and(eq(schema.tickets.assigneeId, input.id), sql`${schema.tickets.statusCategory} <> 'closed'`));
      if (deactivating) {
        const to = input.reassignTo || null;
        if (to) {
          for (const t of [schema.leads, schema.deals, schema.contacts, schema.companies] as const) await db.update(t).set({ ownerId: to } as never).where(eq(t.ownerId, input.id));
          await db.update(schema.activities).set({ ownerId: to }).where(and(eq(schema.activities.ownerId, input.id), eq(schema.activities.done, false)));
          await notify([to], `You took over ${prev.name}’s records`, 'Their open leads, deals, contacts, companies and tasks are now yours.', '/');
        }
        // People who reported to them now report to their manager.
        await db.update(schema.users).set({ managerId: prev.managerId }).where(eq(schema.users.managerId, input.id));
        await audit(me.id, 'user.deactivated', 'user', input.id, to ? `records moved to ${to}` : 'records kept');
      } else await audit(me.id, 'user.updated', 'user', input.id, [prev.role !== input.role && `role ${input.role}`, input.password && 'password set'].filter(Boolean).join(', ') || undefined);
      return done();
    }
    if (!input.password) return fail('Set a temporary password.');
    const dup = await db.query.users.findFirst({ where: eq(schema.users.email, email) }); if (dup) return fail('A user with this email already exists.');
    const [u] = await db.insert(schema.users).values({ name: input.name.trim(), email, role: input.role, managerId, monthlyTarget, ...access, passwordHash: await bcrypt.hash(input.password, 10) }).returning();
    if (input.departmentIds?.length && deskRole !== 'none') await setDepartments(u.id, input.departmentIds);
    await audit(me.id, 'user.created', 'user', u.id, `${email} (${input.role})`);
    return done();
  });
}
async function setDepartments(userId: string, ids: string[]) {
  await db.delete(schema.departmentMembers).where(eq(schema.departmentMembers.userId, userId));
  if (ids.length) await db.insert(schema.departmentMembers).values(Array.from(new Set(ids)).map((departmentId) => ({ departmentId, userId }))).onConflictDoNothing();
  // Team memberships outside their departments no longer apply.
  const teams = await db.select().from(schema.teams);
  const drop = teams.filter((t) => !ids.includes(t.departmentId)).map((t) => t.id);
  if (drop.length) await db.delete(schema.teamMembers).where(and(eq(schema.teamMembers.userId, userId), inArray(schema.teamMembers.teamId, drop)));
}
export async function removeSampleData() {
  return guard(async () => {
    await requireAdmin();
    const sampleDeals = (await db.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.isSample, true))).map((d) => d.id);
    if (sampleDeals.length) await db.delete(schema.deals).where(inArray(schema.deals.sourceDealId, sampleDeals));
    for (const t of [schema.tickets, schema.licences, schema.supportContracts]) await db.delete(t).where(eq(t.isSample, true));
    await db.delete(schema.forumTopics).where(sql`${schema.forumTopics.title} like 'Sample:%'`); await db.delete(schema.statusIncidents).where(sql`${schema.statusIncidents.title} like 'Sample:%'`);
    await db.delete(schema.emailLogs).where(sql`${schema.emailLogs.subject} like '%Sample:%'`);
    for (const t of [schema.activities, schema.notes, schema.deals, schema.leads, schema.contacts, schema.companies, schema.products]) await db.delete(t).where(eq(t.isSample, true));
    return done();
  });
}

/* ============ insights ============ */
export async function saveReportPage(input: { id?: string; name: string; tiles: Tile[]; sortOrder?: number }) {
  return crmGuard<{ id: string }>(async () => {
    if (!input.name.trim()) return fail('Name the page.');
    if (input.id) { await db.update(schema.reportPages).set({ name: input.name.trim(), tiles: input.tiles, ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}), updatedAt: new Date() }).where(eq(schema.reportPages.id, input.id)); return done({ id: input.id }); }
    const n = (await db.select({ c: sql<number>`count(*)` }).from(schema.reportPages))[0].c;
    return done({ id: (await db.insert(schema.reportPages).values({ name: input.name.trim(), tiles: input.tiles, sortOrder: Number(n) }).returning())[0].id });
  });
}
export async function deleteReportPage(id: string) {
  return crmGuard(async () => {
    const n = (await db.select({ c: sql<number>`count(*)` }).from(schema.reportPages))[0].c; if (Number(n) < 2) return fail('Keep at least one page.');
    await db.delete(schema.reportPages).where(eq(schema.reportPages.id, id)); return done();
  });
}

/* ============ AI assistant ============ */
async function callClaude(prompt: string) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('The AI assistant is not set up. Add ANTHROPIC_API_KEY to the server environment.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`The AI service returned an error (${res.status}).`);
  const j = await res.json() as { content?: { type: string; text?: string }[] };
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}
export async function aiDeal(dealId: string, kind: 'brief' | 'risk') {
  return crmGuard<{ text: string }>(async (me) => {
    const scope = await taskScope(me);
    const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, dealId) }); if (!d) return fail('This deal no longer exists.');
    const [st, co, ct, acts, ns, items, evs] = await Promise.all([
      db.query.stages.findFirst({ where: eq(schema.stages.id, d.stageId) }), d.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, d.companyId) }) : null,
      d.contactId ? db.query.contacts.findFirst({ where: eq(schema.contacts.id, d.contactId) }) : null,
      db.select().from(schema.activities).where(and(eq(schema.activities.relatedType, 'deal'), eq(schema.activities.relatedId, dealId))),
      db.select().from(schema.notes).where(and(eq(schema.notes.relatedType, 'deal'), eq(schema.notes.relatedId, dealId))),
      db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, dealId)), db.select().from(schema.dealEvents).where(eq(schema.dealEvents.dealId, dealId)),
    ]);
    const ctx = { name: d.name, stage: st?.name, daysInStage: Math.floor((Date.now() - +d.stageEnteredAt) / 86400000), idleLimit: st?.idleDays, amount: `${d.currency} ${d.amount ?? '?'}`, closingDate: d.closingDate, priority: d.priority, today: todayISO(),
      company: co ? { name: co.name, industry: co.industry } : null, contact: ct ? { name: fullName(ct), title: ct.jobTitle } : null, products: items.map((i) => ({ name: i.name, qty: i.qty })),
      activities: visibleTasks(acts, scope).map((a) => ({ title: a.title, type: a.type, due: a.dueDate, done: a.done })), notes: ns.slice(-12).map((n) => n.body), history: evs.map((e) => ({ kind: e.kind, text: e.text, at: e.at })) };
    const ask = kind === 'risk'
      ? 'You are a B2B sales coach. From this CRM deal, list the 3 biggest risks to closing it, each with one concrete mitigation. Be specific to the data; where data is missing, say what to find out. Plain text, numbered, under 140 words.'
      : 'You are a B2B sales assistant. From this CRM deal write: a two-sentence status summary, then the next 3 actions with suggested dates relative to today. Be specific to the data. Plain text, under 140 words.';
    return { ok: true, text: await callClaude(`${ask}\n\nDeal (JSON):\n${JSON.stringify(ctx)}`) };
  });
}
export async function aiEmail(goal: string, context: Record<string, unknown>) {
  return crmGuard<{ subject: string; body: string }>(async (me) => {
    if (!goal.trim()) return fail('Describe the email first.');
    const s = await getSettings();
    const text = await callClaude(`Write a short, professional B2B email. Goal: ${goal}\nContext (JSON): ${JSON.stringify({ ...context, sender: me.name, senderCompany: s.orgName })}\nReply exactly as:\nSubject: <subject>\n\n<body>\nNo placeholders in brackets; sign off with the sender name.`);
    const m = text.match(/^Subject:\s*(.*)\n+([\s\S]*)$/);
    return { ok: true, subject: m ? m[1].trim() : '', body: m ? m[2].trim() : text };
  });
}

/* ============ people on a deal ============ */
export async function addDealContact(dealId: string, contactId: string, role: string) {
  return crmGuard(async (me) => {
    const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, dealId) }); if (!d) return fail('This deal no longer exists.');
    if (!canEdit(me, d.ownerId)) return fail('You can only edit deals you own.');
    if (!(await db.query.contacts.findFirst({ where: eq(schema.contacts.id, contactId) }))) return fail('Choose a contact.');
    await db.insert(schema.dealContacts).values({ dealId, contactId, role: clean(role) as string | null }).onConflictDoUpdate({ target: [schema.dealContacts.dealId, schema.dealContacts.contactId], set: { role: clean(role) as string | null } });
    if (!d.contactId) await db.update(schema.deals).set({ contactId }).where(eq(schema.deals.id, dealId));
    await db.insert(schema.dealEvents).values({ dealId, kind: 'change', text: `Added a contact${role ? ` (${role})` : ''}`, userId: me.id });
    return done();
  });
}
export async function removeDealContact(id: string) {
  return crmGuard(async (me) => {
    const r = await db.query.dealContacts.findFirst({ where: eq(schema.dealContacts.id, id) }); if (!r) return done();
    const d = await db.query.deals.findFirst({ where: eq(schema.deals.id, r.dealId) }); if (d && !canEdit(me, d.ownerId)) return fail('You can only edit deals you own.');
    await db.delete(schema.dealContacts).where(eq(schema.dealContacts.id, id)); return done();
  });
}
/** Private calendar link (ICS) for a person's CRM activities. Creating a new one disables the old link. */
export async function newCalendarLink() {
  return crmGuard<{ url: string }>(async (me) => {
    const token = randomBytes(24).toString('base64url');
    await db.update(schema.users).set({ calendarToken: token }).where(eq(schema.users.id, me.id));
    await audit(me.id, 'calendar.link_created', 'user', me.id);
    return done({ url: `/api/calendar/${token}.ics` });
  });
}
export async function removeCalendarLink() {
  return guard(async (me) => { await db.update(schema.users).set({ calendarToken: null }).where(eq(schema.users.id, me.id)); return done(); });
}
