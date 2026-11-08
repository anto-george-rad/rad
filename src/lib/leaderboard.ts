import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getSettings } from './settings';
import { toBase } from './settings-defaults';

export type Period = 'month' | 'last_month' | 'quarter' | 'year' | 'week';
/** Start and end of a period in the company time zone (as UTC instants), plus how many months it spans for targets. */
export function periodRange(p: Period, now = new Date()): { from: Date; to: Date; months: number; label: string } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const at = (yy: number, mm: number, dd = 1) => new Date(Date.UTC(yy, mm, dd, -4)); // 00:00 Gulf time
  if (p === 'week') return { from: new Date(+now - 7 * 864e5), to: now, months: 7 / 30, label: 'Last 7 days' };
  if (p === 'last_month') return { from: at(y, m - 1), to: at(y, m), months: 1, label: at(y, m - 1, 15).toLocaleString('en-GB', { month: 'long', year: 'numeric' }) };
  if (p === 'quarter') { const q = Math.floor(m / 3) * 3; return { from: at(y, q), to: at(y, q + 3), months: 3, label: `Q${q / 3 + 1} ${y}` }; }
  if (p === 'year') return { from: at(y, 0), to: at(y + 1, 0), months: 12, label: String(y) };
  return { from: at(y, m), to: at(y, m + 1), months: 1, label: at(y, m, 15).toLocaleString('en-GB', { month: 'long', year: 'numeric' }) };
}
export type SalesRow = { userId: string; name: string; won: number; wonCount: number; lost: number; winRate: number | null; pipelineAdded: number; activities: number; converted: number; target: number | null; attainment: number | null; points: number };
/** Sales leaderboard: won value (AED), win rate, new pipeline, activity and lead conversion per CRM user. */
export async function salesLeaderboard(p: Period): Promise<{ rows: SalesRow[]; label: string }> {
  const r = periodRange(p); const s = await getSettings();
  const q = (x: ReturnType<typeof sql>) => db.execute(x).then((v) => v as unknown as Record<string, unknown>[]);
  const [users, closed, added, acts, conv] = await Promise.all([
    q(sql`select id, name, monthly_target from users where active and (crm_access or role = 'admin')`),
    q(sql`select d.owner_id as id, s.type, d.amount, d.currency, d.amount_base from deals d join stages s on s.id = d.stage_id where s.type in ('won','lost') and d.closed_at >= ${r.from.toISOString()}::timestamptz and d.closed_at < ${r.to.toISOString()}::timestamptz and not d.is_sample`),
    q(sql`select owner_id as id, amount, currency from deals where created_at >= ${r.from.toISOString()}::timestamptz and created_at < ${r.to.toISOString()}::timestamptz and not is_sample`),
    q(sql`select owner_id as id, count(*) as c from activities where done and done_at >= ${r.from.toISOString()}::timestamptz and done_at < ${r.to.toISOString()}::timestamptz group by owner_id`),
    q(sql`select owner_id as id, count(*) as c from leads where converted_at >= ${r.from.toISOString()}::timestamptz and converted_at < ${r.to.toISOString()}::timestamptz group by owner_id`),
  ]);
  const rows: SalesRow[] = users.map((u) => {
    const id = u.id as string; const mine = closed.filter((c) => c.id === id);
    const won = mine.filter((c) => c.type === 'won').reduce((a, c) => a + Number(c.amount_base ?? toBase(Number(c.amount || 0), c.currency as string, s)), 0);
    const wonCount = mine.filter((c) => c.type === 'won').length; const lost = mine.filter((c) => c.type === 'lost').length;
    const pipelineAdded = added.filter((c) => c.id === id).reduce((a, c) => a + toBase(Number(c.amount || 0), c.currency as string, s), 0);
    const activities = Number(acts.find((a) => a.id === id)?.c || 0); const converted = Number(conv.find((a) => a.id === id)?.c || 0);
    const target = u.monthly_target ? Math.round(Number(u.monthly_target) * r.months) : null;
    return { userId: id, name: u.name as string, won: Math.round(won), wonCount, lost, winRate: wonCount + lost ? Math.round((wonCount / (wonCount + lost)) * 100) : null, pipelineAdded: Math.round(pipelineAdded),
      activities, converted, target, attainment: target ? Math.round((won / target) * 100) : null, points: wonCount * 50 + converted * 20 + activities * 2 + Math.round(won / 10_000) };
  });
  return { rows: rows.filter((x) => x.won || x.wonCount || x.lost || x.pipelineAdded || x.activities || x.converted || x.target).sort((a, b) => b.won - a.won || b.points - a.points), label: r.label };
}
export type AgentRow = { userId: string; name: string; resolved: number; frtMins: number | null; resolveHrs: number | null; csat: number | null; rated: number; slaMet: number | null; breaches: number; points: number };
/** Pure (unit-tested): agent points reward volume, speed and happy customers, and take off for breaches and bad ratings. */
export function agentPoints(x: { resolved: number; good: number; bad: number; breaches: number; frtMins: number | null }) {
  return Math.max(0, x.resolved * 10 + x.good * 5 - x.bad * 5 - x.breaches * 8 + (x.frtMins != null && x.frtMins <= 60 ? x.resolved * 2 : 0));
}
/** Helpdesk leaderboard: resolved tickets, response speed, CSAT and SLA per agent. */
export async function agentLeaderboard(p: Period): Promise<{ rows: AgentRow[]; label: string }> {
  const r = periodRange(p);
  const rows = await db.execute(sql`select u.id, u.name,
      count(t.id) filter (where t.resolved_at >= ${r.from.toISOString()}::timestamptz and t.resolved_at < ${r.to.toISOString()}::timestamptz) as resolved,
      avg(extract(epoch from (t.first_responded_at - t.created_at)) / 60) filter (where t.first_responded_at >= ${r.from.toISOString()}::timestamptz and t.first_responded_at < ${r.to.toISOString()}::timestamptz) as frt,
      avg(extract(epoch from (t.resolved_at - t.created_at)) / 3600) filter (where t.resolved_at >= ${r.from.toISOString()}::timestamptz and t.resolved_at < ${r.to.toISOString()}::timestamptz) as res,
      count(*) filter (where t.rating = 'good' and t.rated_at >= ${r.from.toISOString()}::timestamptz and t.rated_at < ${r.to.toISOString()}::timestamptz) as good,
      count(*) filter (where t.rating = 'bad' and t.rated_at >= ${r.from.toISOString()}::timestamptz and t.rated_at < ${r.to.toISOString()}::timestamptz) as bad,
      count(*) filter (where t.rating is not null and t.rated_at >= ${r.from.toISOString()}::timestamptz and t.rated_at < ${r.to.toISOString()}::timestamptz) as rated,
      count(*) filter (where t.resolved_at >= ${r.from.toISOString()}::timestamptz and t.resolved_at < ${r.to.toISOString()}::timestamptz and t.breached_at is null) as met,
      count(*) filter (where t.breached_at >= ${r.from.toISOString()}::timestamptz and t.breached_at < ${r.to.toISOString()}::timestamptz) as breaches
    from users u left join tickets t on t.assignee_id = u.id and not t.is_spam and not t.is_sample
    where u.active and (u.desk_role in ('agent','admin') or u.role = 'admin') group by u.id, u.name`) as unknown as Record<string, unknown>[];
  const out = rows.map((x) => {
    const resolved = Number(x.resolved), good = Number(x.good), bad = Number(x.bad), rated = Number(x.rated), breaches = Number(x.breaches);
    const frtMins = x.frt == null ? null : Math.round(Number(x.frt));
    return { userId: x.id as string, name: x.name as string, resolved, frtMins, resolveHrs: x.res == null ? null : Math.round(Number(x.res) * 10) / 10, csat: rated ? Math.round((good / rated) * 100) : null, rated,
      slaMet: resolved ? Math.round((Number(x.met) / resolved) * 100) : null, breaches, points: agentPoints({ resolved, good, bad, breaches, frtMins }) };
  }).filter((x) => x.resolved || x.rated || x.breaches).sort((a, b) => b.points - a.points);
  return { rows: out, label: r.label };
}
