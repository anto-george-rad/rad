'use server';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { ReportSchedule, RolePermissions } from '@/db/schema';
import { adminOnly, clean, crmAct, done, fail, isUuid, managerOnly, type Result } from './action-kit';
import { audit } from './audit';
import { canEdit, requireUser, type SessionUser } from './auth';
import { seal, open as openSecret } from './crypto-box';
import { getIntegrations, getSettings, saveIntegrations, saveSettings } from './settings';
import { mailEnabled } from './mailer';

/* ---------------- licence register ---------------- */
export type LicenceInput = { id?: string; companyId: string; contactId?: string | null; productId?: string | null; productName?: string; vendor?: string; seats?: number | string; licenceKey?: string;
  startDate?: string; endDate?: string; value?: number | string | null; currency?: string; status?: 'active' | 'expired' | 'cancelled' | 'renewed'; notes?: string };
export async function saveLicence(input: LicenceInput) {
  return crmAct<{ id: string }>(async (me) => {
    if (!isUuid(input.companyId)) return fail('Choose the customer.');
    const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, input.companyId) }); if (!co) return fail('This company no longer exists.');
    if (!canEdit(me, co.ownerId)) return fail('You can only add licences to companies you own.');
    const prod = input.productId && isUuid(input.productId) ? await db.query.products.findFirst({ where: eq(schema.products.id, input.productId) }) : null;
    const productName = String(input.productName || prod?.name || '').trim(); if (!productName) return fail('Choose a product or type its name.');
    const seats = Math.round(+(input.seats ?? 1)); if (!(seats >= 1)) return fail('Seats must be 1 or more.');
    const startDate = clean(input.startDate) as string | null; const endDate = clean(input.endDate) as string | null;
    if (startDate && endDate && endDate < startDate) return fail('The end date is before the start date.');
    const prev = input.id ? await db.query.licences.findFirst({ where: eq(schema.licences.id, input.id) }) : null; if (input.id && !prev) return fail('This licence no longer exists.');
    const key = input.licenceKey === undefined ? prev?.licenceKey ?? null : (String(input.licenceKey).trim() ? seal(String(input.licenceKey).trim()) : null);
    const v = { companyId: co.id, contactId: isUuid(input.contactId) ? input.contactId : null, productId: prod?.id || null, productName, vendor: clean(input.vendor) as string | null, seats, licenceKey: key,
      startDate, endDate, value: input.value == null || input.value === '' ? null : +input.value, currency: input.currency || 'AED', status: input.status || 'active', notes: clean(input.notes) as string | null, updatedAt: new Date() };
    if (prev) { await db.update(schema.licences).set(v).where(eq(schema.licences.id, prev.id)); await audit(me.id, 'licence.updated', 'company', co.id, productName); return done({ id: prev.id }); }
    const [row] = await db.insert(schema.licences).values(v).returning(); await audit(me.id, 'licence.created', 'company', co.id, productName);
    return done({ id: row.id });
  });
}
export async function deleteLicence(id: string) {
  return crmAct(async (me) => {
    if (!me.perms.deleteRecords) return fail('Your role doesn’t allow deleting records. Ask an admin.');
    const l = await db.query.licences.findFirst({ where: eq(schema.licences.id, id) }); if (!l) return done();
    const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, l.companyId), columns: { ownerId: true } });
    if (!canEdit(me, co?.ownerId ?? null)) return fail('You can only change licences of companies you own.');
    await db.delete(schema.licences).where(eq(schema.licences.id, id)); await audit(me.id, 'licence.deleted', 'company', l.companyId, l.productName); return done();
  });
}
/** Licence keys are encrypted; showing one is logged. */
export async function revealLicenceKey(id: string) {
  return crmAct<{ key: string }>(async (me) => {
    const l = await db.query.licences.findFirst({ where: eq(schema.licences.id, id) }); if (!l?.licenceKey) return fail('No key is stored for this licence.');
    await audit(me.id, 'licence.key_viewed', 'company', l.companyId, l.productName);
    return { ok: true as const, key: openSecret(l.licenceKey) };
  });
}

/* ---------------- scheduled reports ---------------- */
/** CRM managers schedule any report; helpdesk admins schedule the helpdesk report. */
async function reportAct<T extends object>(fn: (me: SessionUser) => Promise<Result<T>>) {
  const me = await requireUser(); if (!((me.crmAccess && me.role !== 'rep') || me.deskRole === 'admin')) return fail('Only managers and helpdesk admins can schedule reports.');
  return fn(me).catch((e) => fail((e as Error).message || 'Something went wrong.'));
}
const canReport = (me: SessionUser, kind: string) => (me.crmAccess && me.role !== 'rep') || (me.deskRole === 'admin' && kind === 'helpdesk');
export async function saveReportSchedule(input: { id?: string; name: string; kind: ReportSchedule['kind']; frequency: ReportSchedule['frequency']; day: number; hour: number; recipientIds: string[]; active?: boolean }) {
  return reportAct<{ id: string }>(async (me) => {
    if (!canReport(me, input.kind)) return fail('Helpdesk admins can schedule the helpdesk report only.');
    if (!input.name?.trim()) return fail('Name the report.');
    if (!['pipeline', 'winloss', 'activities', 'leaderboard', 'helpdesk'].includes(input.kind)) return fail('Choose a report.');
    const day = Math.round(+input.day); const hour = Math.round(+input.hour);
    if (input.frequency === 'weekly' ? !(day >= 0 && day <= 6) : !(day >= 1 && day <= 28)) return fail(input.frequency === 'weekly' ? 'Pick a weekday.' : 'Pick a day of the month between 1 and 28.');
    if (!(hour >= 0 && hour <= 23)) return fail('Pick an hour between 0 and 23.');
    const ids = (input.recipientIds || []).filter(isUuid); if (!ids.length) return fail('Add at least one recipient.');
    const v = { name: input.name.trim().slice(0, 120), kind: input.kind, frequency: input.frequency, day, hour, recipientIds: ids, active: input.active !== false };
    if (input.id) {
      const prev = await db.query.reportSchedules.findFirst({ where: eq(schema.reportSchedules.id, input.id) }); if (!prev) return fail('This report no longer exists.');
      if (!canReport(me, prev.kind)) return fail('You can’t change this report.');
      if (me.role !== 'admin' && prev.ownerId !== me.id) return fail('Only the person who set up this report (or an admin) can change it.');
      await db.update(schema.reportSchedules).set(v).where(eq(schema.reportSchedules.id, input.id)); return done({ id: input.id });
    }
    const [row] = await db.insert(schema.reportSchedules).values({ ...v, ownerId: me.id }).returning(); await audit(me.id, 'report.scheduled', 'report', row.id, v.name);
    return done({ id: row.id });
  });
}
export async function deleteReportSchedule(id: string) {
  return reportAct(async (me) => {
    const prev = await db.query.reportSchedules.findFirst({ where: eq(schema.reportSchedules.id, id) }); if (!prev) return done();
    if (!canReport(me, prev.kind)) return fail('You can’t change this report.');
    if (me.role !== 'admin' && prev.ownerId !== me.id) return fail('Only the person who set up this report (or an admin) can delete it.');
    await db.delete(schema.reportSchedules).where(eq(schema.reportSchedules.id, id)); return done();
  });
}
/** Sends now (or, without email set up, returns the preview so you can see it). */
export async function sendReportNow(id: string) {
  return reportAct<{ sent: number; of: number; subject: string; html: string; mail: boolean }>(async (me) => {
    const r = await db.query.reportSchedules.findFirst({ where: eq(schema.reportSchedules.id, id) }); if (!r) return fail('This report no longer exists.');
    if (!canReport(me, r.kind)) return fail('You can’t send this report.');
    const { sendReport, buildReport, renderReport } = await import('./report-mail');
    if (!mailEnabled()) { const s = await getSettings(); const rep = await buildReport(r.kind, r.frequency); return { ok: true as const, sent: 0, of: r.recipientIds.length, subject: rep.subject, html: renderReport(rep, s.orgName, '').html, mail: false }; }
    const x = await sendReport(r); return { ok: true as const, ...x, mail: true };
  });
}

/* ---------------- custom roles ---------------- */
const PERM_KEYS: (keyof RolePermissions)[] = ['exportData', 'importData', 'deleteRecords', 'viewCost', 'bulkEdit', 'viewInsights', 'deleteTickets', 'mergeTickets'];
export async function saveRole(input: { id?: string; name: string; description?: string; permissions: Partial<RolePermissions> }) {
  return crmAct<{ id: string }>(async (me) => {
    adminOnly(me); const name = input.name?.trim(); if (!name) return fail('Name the role.');
    const permissions = Object.fromEntries(PERM_KEYS.map((k) => [k, input.permissions?.[k] !== false])) as RolePermissions;
    if (input.id) { await db.update(schema.customRoles).set({ name, description: clean(input.description) as string | null, permissions }).where(eq(schema.customRoles.id, input.id)); await audit(me.id, 'role.updated', 'role', input.id, name); return done({ id: input.id }); }
    const [row] = await db.insert(schema.customRoles).values({ name, description: clean(input.description) as string | null, permissions }).returning(); await audit(me.id, 'role.created', 'role', row.id, name);
    return done({ id: row.id });
  });
}
export async function deleteRole(id: string) {
  return crmAct(async (me) => {
    adminOnly(me); await db.update(schema.users).set({ customRoleId: null }).where(eq(schema.users.customRoleId, id));
    await db.delete(schema.customRoles).where(eq(schema.customRoles.id, id)); await audit(me.id, 'role.deleted', 'role', id); return done();
  });
}
export async function setUserRole(userId: string, roleId: string | null) {
  return crmAct(async (me) => {
    adminOnly(me); if (!isUuid(userId)) return fail('Choose a person.');
    if (roleId && !(await db.query.customRoles.findFirst({ where: eq(schema.customRoles.id, roleId) }))) return fail('That role no longer exists.');
    await db.update(schema.users).set({ customRoleId: roleId || null }).where(eq(schema.users.id, userId)); await audit(me.id, 'user.role_changed', 'user', userId, roleId || 'none'); return done();
  });
}

/* ---------------- web-to-lead form ---------------- */
export async function saveLeadForm(input: { leadFormEnabled: boolean; leadFormOwnerId: string; leadFormSource: string; leadFormThanks: string; leadFormOrigins: string[] }) {
  return crmAct(async (me) => {
    adminOnly(me);
    const origins = (input.leadFormOrigins || []).map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
    for (const o of origins) if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) return fail(`“${o}” isn’t a website address like https://raidefend.com`);
    await saveSettings({ leadFormEnabled: !!input.leadFormEnabled, leadFormOwnerId: isUuid(input.leadFormOwnerId) ? input.leadFormOwnerId : '', leadFormSource: input.leadFormSource?.trim() || 'Website', leadFormThanks: input.leadFormThanks?.trim().slice(0, 300) || 'Thank you.', leadFormOrigins: origins });
    await audit(me.id, 'settings.changed', 'settings', null, 'lead form'); return done();
  });
}

/* ---------------- Outlook email sync ---------------- */
export async function saveOutlook(input: { enabled: boolean; tenantId: string; clientId: string; clientSecret?: string }) {
  return crmAct(async (me) => {
    adminOnly(me); const prev = (await getIntegrations()).outlook;
    const tenantId = input.tenantId?.trim(); const clientId = input.clientId?.trim();
    if (input.enabled && (!tenantId || !clientId || (!input.clientSecret && !prev?.clientSecret))) return fail('Enter the tenant ID, the application (client) ID and the client secret.');
    await saveIntegrations({ outlook: { tenantId: tenantId || '', clientId: clientId || '', clientSecret: input.clientSecret?.trim() ? seal(input.clientSecret.trim()) : prev?.clientSecret || '', lastError: null, lastRunAt: prev?.lastRunAt || null } });
    await saveSettings({ outlookEnabled: !!input.enabled }); await audit(me.id, 'settings.changed', 'settings', null, 'outlook sync'); return done();
  });
}
export async function testOutlook() {
  return crmAct<{ result: string }>(async (me) => {
    adminOnly(me); const cfg = (await getIntegrations()).outlook; if (!cfg?.clientSecret) return fail('Save the Microsoft 365 details first.');
    const { graphToken } = await import('./outlook'); await graphToken(cfg); return { ok: true as const, result: 'Connected to Microsoft 365.' };
  });
}
export async function syncOutlookNow() {
  return crmAct<{ result: string }>(async (me) => {
    managerOnly(me); const { syncMailboxes } = await import('./outlook'); const r = await syncMailboxes(fetch, { force: true });
    if ('skipped' in r) return fail(r.skipped === 'not set up' ? 'Microsoft 365 email sync isn’t set up yet.' : 'It ran a moment ago.');
    return done({ result: `${r.logged} email${r.logged === 1 ? '' : 's'} logged from ${r.users} mailbox${r.users === 1 ? '' : 'es'}${r.errors.length ? ` · ${r.errors.length} problem(s): ${r.errors[0]}` : ''}` });
  });
}
/** Each person decides whether their mailbox is synced; admins can switch it for anyone. */
export async function setMailSync(userId: string, on: boolean) {
  return crmAct(async (me) => {
    if (userId !== me.id) adminOnly(me);
    await db.update(schema.users).set({ mailSync: on, ...(on ? {} : { mailSyncedAt: null }) }).where(eq(schema.users.id, userId)); await audit(me.id, 'user.mail_sync', 'user', userId, on ? 'on' : 'off'); return done();
  });
}
/** Remove a synced email from the CRM (e.g. private mail matched by mistake). */
export async function deleteEmailLog(id: string) {
  return crmAct(async (me) => {
    const e = await db.query.emailLogs.findFirst({ where: eq(schema.emailLogs.id, id) }); if (!e) return done();
    if (e.userId !== me.id && me.role !== 'admin') return fail('Only the mailbox owner or an admin can remove a synced email.');
    await db.delete(schema.emailLogs).where(and(eq(schema.emailLogs.id, id))); return done();
  });
}

