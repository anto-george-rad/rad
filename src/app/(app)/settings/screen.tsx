import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { SessionUser } from '@/lib/auth';
import { mailEnabled } from '@/lib/mailer';
import { getIntegrations, type Integrations } from '@/lib/settings';
import SettingsView from '@/components/settings';

/** Shared by CRM settings (/settings) and Helpdesk settings (/desk/settings): each loads and shows only its own module's tabs. */
export default async function SettingsScreen({ me, module, searchParams }: { me: SessionUser; module: 'crm' | 'desk'; searchParams: { tab?: string; audit?: string } }) {
  const admin = me.role === 'admin'; const deskAdmin = me.deskRole === 'admin' && module === 'desk'; const crmAdmin = admin && module === 'crm'; const tab = searchParams.tab || '';
  const isDesk = module === 'desk';
  const DESK_AUDIT = sql`(${schema.auditLog.entity} in ('ticket','department','team','status','sla','canned','kb','article') or ${schema.auditLog.action} like 'portal.%' or (${schema.auditLog.action} = 'settings.changed' and (${schema.auditLog.detail} ilike '%ticket%' or ${schema.auditLog.detail} ilike '%portal%' or ${schema.auditLog.detail} ilike '%businessHours%' or ${schema.auditLog.detail} ilike '%csat%' or ${schema.auditLog.detail} ilike '%webForm%' or ${schema.auditLog.detail} ilike '%autoClose%' or ${schema.auditLog.detail} ilike '%reopen%')))`;
  const none = Promise.resolve([] as never[]);
  const [rules, autos, scoring, products, runs, auditRows, userRows, sessions, meRow, depts, deptMembers, teams, teamMembers, statuses, slas, canned, trash] = await Promise.all([
    crmAdmin ? db.select().from(schema.stageRules) : none,
    crmAdmin || deskAdmin || (admin && isDesk) ? db.select().from(schema.automations).where(isDesk ? sql`${schema.automations.trigger}->>'event' like 'ticket.%'` : sql`${schema.automations.trigger}->>'event' not like 'ticket.%'`).orderBy(asc(schema.automations.createdAt)) : none,
    crmAdmin ? db.select().from(schema.scoringRules) : none,
    isDesk ? none : db.select().from(schema.products).orderBy(asc(schema.products.name)),
    (crmAdmin || deskAdmin || (admin && isDesk)) && tab === 'automations' ? db.select().from(schema.automationRuns).where(isDesk ? sql`${schema.automationRuns.recordType} = 'ticket'` : sql`${schema.automationRuns.recordType} <> 'ticket'`).orderBy(desc(schema.automationRuns.at)).limit(60) : none,
    (crmAdmin || deskAdmin || (admin && isDesk)) && tab === 'audit' ? db.select().from(schema.auditLog).where(and(searchParams.audit && /^[0-9a-f-]{36}$/.test(searchParams.audit) ? eq(schema.auditLog.userId, searchParams.audit) : undefined, isDesk ? DESK_AUDIT : sql`not ${DESK_AUDIT}`)).orderBy(desc(schema.auditLog.at)).limit(300) : none,
    admin || deskAdmin ? db.select({ id: schema.users.id, monthlyTarget: schema.users.monthlyTarget, crmAccess: schema.users.crmAccess, deskRole: schema.users.deskRole, ticketScope: schema.users.ticketScope, totpEnabled: schema.users.totpEnabled }).from(schema.users) : none,
    db.select().from(schema.sessions).where(and(eq(schema.sessions.userId, me.id), isNull(schema.sessions.revokedAt), sql`${schema.sessions.lastSeenAt} > now() - interval '14 days'`)).orderBy(desc(schema.sessions.lastSeenAt)),
    db.query.users.findFirst({ where: eq(schema.users.id, me.id), columns: { totpEnabled: true, calendarToken: true, signature: true } }),
    isDesk ? db.select().from(schema.departments).orderBy(asc(schema.departments.sortOrder)) : none, isDesk ? db.select().from(schema.departmentMembers) : none,
    isDesk ? db.select().from(schema.teams) : none, isDesk ? db.select().from(schema.teamMembers) : none,
    deskAdmin ? db.select().from(schema.ticketStatuses).orderBy(asc(schema.ticketStatuses.sortOrder)) : none, deskAdmin ? db.select().from(schema.slaPolicies).orderBy(asc(schema.slaPolicies.sortOrder)) : none,
    isDesk && (me.deskRole === 'admin' || me.deskRole === 'agent') ? db.select().from(schema.cannedResponses).where(or(isNull(schema.cannedResponses.ownerId), eq(schema.cannedResponses.ownerId, me.id))).orderBy(asc(schema.cannedResponses.name)) : none,
    tab === 'trash' ? db.select({ id: schema.trash.id, entity: schema.trash.entity, label: schema.trash.label, deletedBy: schema.trash.deletedBy, deletedAt: schema.trash.deletedAt }).from(schema.trash)
      .where(isDesk ? eq(schema.trash.entity, 'ticket') : and(sql`${schema.trash.entity} <> 'ticket'`, admin || me.role === 'manager' ? undefined : eq(schema.trash.deletedBy, me.id))).orderBy(desc(schema.trash.deletedAt)).limit(200) : none,
  ]);
  const T = (k: string) => tab === k;
  const meMail = T('account') ? await db.query.users.findFirst({ where: eq(schema.users.id, me.id), columns: { mailSync: true, mailSyncedAt: true } }) : null;
  const [schedules, roles, roleUsers, escalations, integ, mailPeople, leaves, routing] = await Promise.all([
    T('reports') ? db.select().from(schema.reportSchedules).orderBy(asc(schema.reportSchedules.createdAt)) : none,
    T('roles') && admin ? db.select().from(schema.customRoles).orderBy(asc(schema.customRoles.name)) : none,
    T('roles') && admin ? db.select({ id: schema.users.id, r: schema.users.customRoleId }).from(schema.users) : none,
    T('escalations') && deskAdmin ? db.select().from(schema.escalationRules).orderBy(asc(schema.escalationRules.level)) : none,
    (T('emailsync') && admin) || (T('whatsapp') && deskAdmin) ? getIntegrations() : Promise.resolve({} as Integrations),
    T('emailsync') && admin ? db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, mailSync: schema.users.mailSync, mailSyncedAt: schema.users.mailSyncedAt }).from(schema.users).where(and(eq(schema.users.active, true), or(eq(schema.users.crmAccess, true), eq(schema.users.role, 'admin')))).orderBy(asc(schema.users.name)) : none,
    T('agents') && deskAdmin ? db.select().from(schema.agentLeave).where(sql`${schema.agentLeave.endDate} >= current_date - 30`).orderBy(asc(schema.agentLeave.startDate)) : none,
    T('agents') && deskAdmin ? db.select({ id: schema.users.id, skills: schema.users.skills, shift: schema.users.shift }).from(schema.users) : none,
  ]);
  const crmUsersRows = crmAdmin && tab === 'data' ? await db.select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName, email: schema.contacts.email, createdAt: schema.contacts.createdAt }).from(schema.contacts) : [];
  const companies = crmAdmin && tab === 'data' ? await db.select({ id: schema.companies.id, name: schema.companies.name, createdAt: schema.companies.createdAt }).from(schema.companies) : [];
  const samples = crmAdmin && tab === 'data' ? (await Promise.all([schema.deals, schema.leads, schema.contacts, schema.companies, schema.products, schema.tickets].map(async (t) => Number((await db.select({ c: sql<number>`count(*)` }).from(t).where(eq(t.isSample, true)))[0].c)))).reduce((a, b) => a + b, 0) : 0;
  const defaultTab = isDesk ? (me.deskRole === 'admin' ? 'departments' : me.deskRole === 'agent' ? 'canned' : 'account') : admin ? 'company' : me.role === 'manager' && me.crmAccess ? 'products' : 'account';
  return <SettingsView module={module} tab={tab || defaultTab} rules={rules} automations={autos} scoring={scoring} products={me.perms.viewCost ? products : products.map((x) => ({ ...x, costPrice: null }))} contacts={crmUsersRows} companies={companies} samples={samples}
    runs={runs} audit={auditRows} mailOn={mailEnabled()} access={Object.fromEntries(userRows.map((u) => [u.id, { monthlyTarget: u.monthlyTarget, crmAccess: u.crmAccess, deskRole: u.deskRole, ticketScope: u.ticketScope, totpEnabled: u.totpEnabled, deptIds: deptMembers.filter((m) => m.userId === u.id).map((m) => m.departmentId) }]))}
    sessions={sessions.map((x) => ({ id: x.id, userAgent: x.userAgent, ip: x.ip, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, current: x.id === me.sid }))}
    account={{ totpEnabled: !!meRow?.totpEnabled, hasCalendar: !!meRow?.calendarToken, signature: meRow?.signature || '' }}
    desk={{ departments: depts.map((d) => ({ ...d, imap: d.imap ? { host: d.imap.host, port: d.imap.port, secure: d.imap.secure, user: d.imap.user, folder: d.imap.folder } : null, memberIds: deptMembers.filter((m) => m.departmentId === d.id).map((m) => m.userId) })),
      teams: teams.map((t) => ({ ...t, memberIds: teamMembers.filter((m) => m.teamId === t.id).map((m) => m.userId) })), statuses, slas, canned }}
    trash={trash} ext={{ schedules, roles, roleOf: Object.fromEntries(roleUsers.map((x) => [x.id, x.r])), escalations, leaves, routing: Object.fromEntries(routing.map((x) => [x.id, { skills: x.skills, shift: x.shift }])),
      outlook: { configured: !!integ.outlook?.clientSecret, tenantId: integ.outlook?.tenantId || '', clientId: integ.outlook?.clientId || '', lastRunAt: integ.outlook?.lastRunAt || null, lastError: integ.outlook?.lastError || null }, mailPeople,
      whatsapp: { configured: !!integ.whatsapp?.accessToken, phoneNumberId: integ.whatsapp?.phoneNumberId || '', verifyToken: integ.whatsapp?.verifyToken || '', lastInboundAt: integ.whatsapp?.lastInboundAt || null }, aiConfigured: !!process.env.ANTHROPIC_API_KEY,
      myMail: { on: !!meMail?.mailSync, at: meMail?.mailSyncedAt || null } }} />;
}
