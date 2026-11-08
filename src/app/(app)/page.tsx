import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCrmPage } from '@/lib/auth';
import { buildDataset } from '@/lib/insights-data';
import { getPipelineTree, getScoringRules } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { toBase } from '@/lib/settings-defaults';
import { scoreLead } from '@/lib/scoring';
import { DAY, todayISO } from '@/lib/utils';
import Home from '@/components/home';
import { taskScope } from '@/lib/visibility';
import { mailEnabled } from '@/lib/mailer';

export const metadata = { title: 'Home' };
export default async function HomePage() {
  const me = await requireCrmPage();
  const scope = await taskScope(me);
  const [data, pipes, s, rules, deals, leads, acts, openActs, people, counts] = await Promise.all([
    buildDataset(scope), getPipelineTree(), getSettings(), getScoringRules(),
    db.select().from(schema.deals), db.select().from(schema.leads),
    db.select().from(schema.activities).where(and(eq(schema.activities.done, false), lte(schema.activities.dueDate, todayISO()))).orderBy(asc(schema.activities.dueDate)),
    db.select({ relatedType: schema.activities.relatedType, relatedId: schema.activities.relatedId, ownerId: schema.activities.ownerId, dueDate: schema.activities.dueDate }).from(schema.activities).where(eq(schema.activities.done, false)),
    db.select({ id: schema.users.id, name: schema.users.name, active: schema.users.active, monthlyTarget: schema.users.monthlyTarget }).from(schema.users),
    me.role === 'admin' ? db.execute(sql`select (select count(*) from users where active) as users, (select count(*) from products where not is_sample) as products,
      (select count(*) from contacts where not is_sample) as contacts, (select count(*) from leads where is_sample) + (select count(*) from deals where is_sample) as samples`) : Promise.resolve(null),
  ]);
  const stage = new Map(pipes.flatMap((p) => p.subs.flatMap((sb) => sb.stages.map((st) => [st.id, st] as const))));
  const withNext = new Set(openActs.filter((a) => a.relatedType === 'deal').map((a) => a.relatedId));
  const open = deals.filter((d) => stage.get(d.stageId)?.type === 'open');
  const attention = open.map((d) => { const st = stage.get(d.stageId)!; const idle = Math.floor((Date.now() - +d.stageEnteredAt) / DAY); return { d, st, idle, stale: !!st.idleDays && idle > st.idleDays, noNext: !withNext.has(d.id) }; })
    .filter((x) => x.stale || x.noNext).sort((a, b) => Number(b.stale) - Number(a.stale) || b.idle - a.idle).slice(0, 7)
    .map((x) => ({ id: x.d.id, name: x.d.name, ownerId: x.d.ownerId, stage: x.st.name, amount: x.d.amount, currency: x.d.currency, idle: x.idle, stale: x.stale, noNext: x.noNext }));
  const hot = leads.filter((l) => !['Converted', 'Unqualified'].includes(l.status)).map((l) => ({ l, sc: scoreLead(l, rules).score })).filter((x) => x.sc >= s.hotScore).sort((a, b) => b.sc - a.sc).slice(0, 5)
    .map(({ l, sc }) => ({ id: l.id, name: `${l.firstName} ${l.lastName || ''}`.trim(), sub: [l.jobTitle, l.companyName].filter(Boolean).join(' · '), score: sc, ownerId: l.ownerId }));
  const relName = (type: string | null, id: string | null) => type === 'deal' ? deals.find((d) => d.id === id)?.name : type === 'lead' ? (() => { const l = leads.find((x) => x.id === id); return l ? `${l.firstName} ${l.lastName || ''}`.trim() : undefined; })() : undefined;
  const myDay = acts.filter((a) => a.ownerId === me.id || !a.ownerId).slice(0, 8).map((a) => ({ ...a, relLabel: relName(a.relatedType, a.relatedId) }));
  const month = todayISO().slice(0, 7);
  const isWon = (d: typeof deals[number]) => stage.get(d.stageId)?.type === 'won';
  const sales = pipes[0]?.id;
  // Revenue counts only sales-type pipelines (not Delivery projects or Service tickets).
  const nonRevenue = new Set(pipes.filter((p) => ['delivery', 'service'].includes(p.name.toLowerCase())).map((p) => p.id));
  const aed = (d: typeof deals[number]) => d.amountBase ?? toBase(d.amount, d.currency, s);
  const wonMonth = deals.filter((d) => isWon(d) && d.closedAt && todayISO(d.closedAt).slice(0, 7) === month && !nonRevenue.has(d.pipelineId));
  const closed90 = deals.filter((d) => stage.get(d.stageId)?.type !== 'open' && d.closedAt && Date.now() - +d.closedAt < 90 * DAY);
  const kpis = {
    open: open.reduce((x, d) => x + toBase(d.amount, d.currency, s), 0), openCount: open.length,
    weighted: open.reduce((x, d) => x + toBase(d.amount, d.currency, s) * ((stage.get(d.stageId)?.probability || 0) / 100), 0),
    commit: open.filter((d) => d.forecastCategory === 'Commit' && !nonRevenue.has(d.pipelineId)).reduce((x, d) => x + toBase(d.amount, d.currency, s), 0),
    bestCase: open.filter((d) => d.forecastCategory === 'Best case' && !nonRevenue.has(d.pipelineId)).reduce((x, d) => x + toBase(d.amount, d.currency, s), 0),
    wonMonth: wonMonth.reduce((x, d) => x + aed(d), 0), wonCount: wonMonth.length, target: s.monthlyTarget,
    winRate: closed90.length ? Math.round((closed90.filter(isWon).length / closed90.length) * 100) : null, closed90: closed90.length,
    newLeads: leads.filter((l) => Date.now() - +l.createdAt < 7 * DAY).length, uncontacted: leads.filter((l) => l.status === 'New').length,
    overdue: acts.filter((a) => a.dueDate! < todayISO() && (a.ownerId === me.id || !a.ownerId)).length, dueToday: acts.filter((a) => a.dueDate === todayISO() && (a.ownerId === me.id || !a.ownerId)).length,
  };
  // Team panel + leaderboard for managers (their reporting line) and admins (everyone).
  const t = todayISO();
  const teamIds = me.role === 'rep' ? [] : people.filter((u) => u.active && (!scope || scope.has(u.id))).map((u) => u.id);
  const team = teamIds.length > 1 || me.role === 'admin' ? people.filter((u) => teamIds.includes(u.id)).map((u) => ({
    id: u.id, name: u.name, target: u.monthlyTarget,
    open: open.filter((d) => d.ownerId === u.id && !nonRevenue.has(d.pipelineId)).reduce((x, d) => x + aed(d), 0),
    won: wonMonth.filter((d) => d.ownerId === u.id).reduce((x, d) => x + aed(d), 0),
    overdue: openActs.filter((a) => a.ownerId === u.id && a.dueDate && a.dueDate < t).length, today: openActs.filter((a) => a.ownerId === u.id && a.dueDate === t).length,
  })).sort((a, b) => b.won - a.won || b.open - a.open) : null;
  const c = counts ? (counts as unknown as Record<string, string>[])[0] : null;
  const setup = me.role === 'admin' && !s.setupDismissed && c ? [
    { key: 'org', label: 'Add your company details and TRN', href: '/settings?tab=company', done: !!s.vatTrn && !!s.phone },
    { key: 'brand', label: 'Upload your logo and pick a colour', href: '/settings?tab=branding', done: !!s.logoLight || !!s.logoDark || s.brandColor.toUpperCase() !== '#4C5BFF' },
    { key: 'users', label: 'Invite your team and set who reports to whom', href: '/settings?tab=users', done: Number(c.users) > 1 },
    { key: 'products', label: 'Add your products and services', href: '/settings?tab=products', done: Number(c.products) > 0 },
    { key: 'contacts', label: 'Import your contacts and companies', href: '/settings?tab=data', done: Number(c.contacts) > 0 },
    { key: 'mail', label: 'Set up email (SMTP) for password resets', href: '/settings?tab=company', done: mailEnabled() },
    { key: 'sample', label: 'Remove the sample records', href: '/settings?tab=data', done: Number(c.samples) === 0 },
  ] : null;
  return <Home team={team} setup={setup} data={data} kpis={kpis} attention={attention} hot={hot} myDay={myDay} pipelines={pipes.map((p) => ({ id: p.id, name: p.name }))} defaultPipe={sales} />;
}
