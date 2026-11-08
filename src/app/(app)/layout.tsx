import { asc, and, desc, eq, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser } from '@/lib/auth';
import { getCustomFields, getPipelineTree, getUsers } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { todayISO } from '@/lib/utils';
import { AppProvider } from '@/components/app-context';
import Shell from '@/components/shell';
import { taskScope } from '@/lib/visibility';
import { agents, deskCtx, ticketWhere } from '@/lib/desk-access';

export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const crm = me.crmAccess; const deskOn = me.deskRole !== 'none';
  const scope = await taskScope(me);
  const none = Promise.resolve([] as never[]);
  const [users, pipelines, products, customFields, templates, settings, newLeads, overdue, favorites, meRow] = await Promise.all([
    getUsers(), crm ? getPipelineTree() : none, db.select().from(schema.products).orderBy(asc(schema.products.name)),
    getCustomFields(), crm ? db.select().from(schema.emailTemplates).orderBy(asc(schema.emailTemplates.name)) : none, getSettings(),
    crm ? db.select({ c: sql<number>`count(*)` }).from(schema.leads).where(eq(schema.leads.status, 'New')) : Promise.resolve([{ c: 0 }]),
    crm ? db.select({ c: sql<number>`count(*)` }).from(schema.activities).where(and(eq(schema.activities.done, false), lt(schema.activities.dueDate, todayISO()), eq(schema.activities.ownerId, me.id))) : Promise.resolve([{ c: 0 }]),
    db.select({ recordType: schema.favorites.recordType, recordId: schema.favorites.recordId, label: schema.favorites.label }).from(schema.favorites).where(eq(schema.favorites.userId, me.id)).orderBy(desc(schema.favorites.createdAt)).limit(8),
    db.query.users.findFirst({ where: eq(schema.users.id, me.id), columns: { deskAvailable: true } }),
  ]);
  let desk = null; let myTickets = 0;
  if (deskOn) {
    const c = await deskCtx(me);
    const [departments, teams, statuses, ag, mine] = await Promise.all([
      db.select({ id: schema.departments.id, name: schema.departments.name, active: schema.departments.active }).from(schema.departments).orderBy(asc(schema.departments.sortOrder)),
      db.select().from(schema.teams), db.select().from(schema.ticketStatuses).orderBy(asc(schema.ticketStatuses.sortOrder)), agents(),
      db.select({ c: sql<number>`count(*)` }).from(schema.tickets).where(and(ticketWhere(c), eq(schema.tickets.assigneeId, me.id), sql`${schema.tickets.statusCategory} = 'open'`)),
    ]);
    desk = { departments, teams, statuses, agents: ag.map(({ email: _e, ...a }) => { void _e; return a; }), myDeptIds: c.deptIds, myTeamIds: c.teamIds };
    myTickets = Number(mine[0].c);
  }
  // Logos are served from /api/brand so the large data URLs don't ride along with every page.
  const v = (s: string) => s ? s.length.toString(36) + s.slice(-12).replace(/[^a-z0-9]/gi, '') : '';
  const lean = { ...settings, logoLight: settings.logoLight ? `/api/brand/light?v=${v(settings.logoLight)}` : '', logoDark: settings.logoDark ? `/api/brand/dark?v=${v(settings.logoDark)}` : '' };
  const { sid: _sid, ...meLite } = me; void _sid;
  return (
    <AppProvider value={{ me: { ...meLite, deskAvailable: meRow?.deskAvailable ?? true }, users, pipelines, products: me.perms.viewCost ? products : products.map((x) => ({ ...x, costPrice: null })), customFields, templates, settings: lean, favorites, aiEnabled: !!process.env.ANTHROPIC_API_KEY, team: scope ? [...scope] : null, desk }}>
      <Shell badges={{ leads: Number(newLeads[0].c), activities: Number(overdue[0].c), tickets: myTickets }}>{children}</Shell>
    </AppProvider>
  );
}
