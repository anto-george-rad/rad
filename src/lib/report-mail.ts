import 'server-only';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { ReportSchedule } from '@/db/schema';
import { getSettings } from './settings';
import { toBase } from './settings-defaults';
import { sendMail, mailEnabled } from './mailer';
import { salesLeaderboard, agentLeaderboard } from './leaderboard';
import { localNow } from './routing';
import { APP_TZ, todayISO, addDaysISO } from './utils';
import { log } from './log';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (n: number) => `AED ${Math.round(n).toLocaleString('en-US')}`;
type Block = { title: string; head: string[]; rows: (string | number)[][]; note?: string };
type Report = { subject: string; intro: string; kpis: [string, string][]; blocks: Block[] };

/** Pure (unit-tested): renders a report as a plain, email-safe HTML page and a text fallback. */
export function renderReport(r: Report, orgName: string, appUrl: string) {
  const kpi = r.kpis.map(([k, v]) => `<td style="padding:12px 16px;border:1px solid #e3e5ee;border-radius:8px"><div style="font-size:12px;color:#5b6170">${esc(k)}</div><div style="font-size:20px;font-weight:700;color:#14172b">${esc(v)}</div></td>`).join('<td style="width:8px"></td>');
  const blocks = r.blocks.map((b) => `<h3 style="font:600 15px Inter,Arial,sans-serif;color:#14172b;margin:24px 0 8px">${esc(b.title)}</h3>${b.rows.length ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font:13px Inter,Arial,sans-serif"><tr>${b.head.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:6px 8px;border-bottom:2px solid #e3e5ee;color:#5b6170;font-weight:600">${esc(h)}</th>`).join('')}</tr>${b.rows.map((row) => `<tr>${row.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #eef0f5">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '<p style="font:13px Inter,Arial,sans-serif;color:#5b6170">Nothing in this period.</p>'}${b.note ? `<p style="font:12px Inter,Arial,sans-serif;color:#5b6170">${esc(b.note)}</p>` : ''}`).join('');
  const html = `<div style="max-width:720px;margin:0 auto;padding:24px;font:14px Inter,Arial,sans-serif;color:#14172b"><div style="font-size:12px;color:#5b6170;text-transform:uppercase;letter-spacing:.06em">${esc(orgName)} · RAD Workspace</div><h2 style="font:700 22px Manrope,Inter,Arial,sans-serif;margin:4px 0 6px">${esc(r.subject)}</h2><p style="color:#5b6170;margin:0 0 16px">${esc(r.intro)}</p><table cellpadding="0" cellspacing="0"><tr>${kpi}</tr></table>${blocks}${appUrl ? `<p style="margin-top:28px"><a href="${esc(appUrl)}" style="color:#4c5bff">Open RAD Workspace</a></p>` : ''}</div>`;
  const text = [r.subject, r.intro, '', ...r.kpis.map(([k, v]) => `${k}: ${v}`), ...r.blocks.flatMap((b) => ['', b.title.toUpperCase(), ...(b.rows.length ? b.rows.map((x) => x.join(' · ')) : ['Nothing in this period.'])])].join('\n');
  return { html, text };
}
const rowsOf = (q: ReturnType<typeof sql>) => db.execute(q).then((r) => r as unknown as Record<string, unknown>[]);

/** Builds the numbers for one scheduled report. */
export async function buildReport(kind: ReportSchedule['kind'], frequency: ReportSchedule['frequency']): Promise<Report> {
  const s = await getSettings(); const days = frequency === 'monthly' ? 30 : 7; const from = new Date(Date.now() - days * 864e5); const fromIso = from.toISOString(); const span = frequency === 'monthly' ? 'last 30 days' : 'last 7 days';
  const stages = await db.select().from(schema.stages); const pipes = await db.select().from(schema.pipelines); const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
  const uname = (id: unknown) => users.find((u) => u.id === id)?.name || 'Unassigned';
  if (kind === 'pipeline') {
    const open = await db.select().from(schema.deals).where(and(inArray(schema.deals.stageId, stages.filter((x) => x.type === 'open').map((x) => x.id)), eq(schema.deals.isSample, false)));
    const by = new Map<string, { n: number; v: number }>();
    for (const d of open) { const st = stages.find((x) => x.id === d.stageId)!; const p = pipes.find((x) => x.id === d.pipelineId); const k = `${p?.name || ''} · ${st.name}`; const cur = by.get(k) || { n: 0, v: 0 }; cur.n++; cur.v += toBase(d.amount, d.currency, s); by.set(k, cur); }
    const soon = open.filter((d) => d.closingDate && d.closingDate >= todayISO() && d.closingDate <= addDaysISO(30)).sort((a, b) => toBase(b.amount, b.currency, s) - toBase(a.amount, a.currency, s)).slice(0, 10);
    const overdue = open.filter((d) => d.closingDate && d.closingDate < todayISO());
    const fresh = open.filter((d) => +d.createdAt >= +from);
    return { subject: `Pipeline report — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, intro: `Open pipeline today, and what changed in the ${span}.`,
      kpis: [['Open deals', String(open.length)], ['Open value', money(open.reduce((a, d) => a + toBase(d.amount, d.currency, s), 0))], [`New (${span})`, String(fresh.length)], ['Past closing date', String(overdue.length)]],
      blocks: [{ title: 'By stage', head: ['Pipeline · stage', 'Deals', 'Value'], rows: [...by.entries()].map(([k, v]) => [k, v.n, money(v.v)]) },
        { title: 'Closing in the next 30 days', head: ['Deal', 'Owner', 'Close date', 'Value'], rows: soon.map((d) => [d.name, uname(d.ownerId), d.closingDate!, money(toBase(d.amount, d.currency, s))]) },
        { title: 'Past their closing date', head: ['Deal', 'Owner', 'Close date', 'Value'], rows: overdue.slice(0, 15).map((d) => [d.name, uname(d.ownerId), d.closingDate!, money(toBase(d.amount, d.currency, s))]), note: overdue.length > 15 ? `+${overdue.length - 15} more` : undefined }] };
  }
  if (kind === 'winloss') {
    const closed = await db.select().from(schema.deals).where(and(gte(schema.deals.closedAt, from), eq(schema.deals.isSample, false)));
    const typed = closed.map((d) => ({ d, t: stages.find((x) => x.id === d.stageId)?.type })).filter((x) => x.t === 'won' || x.t === 'lost');
    const won = typed.filter((x) => x.t === 'won'), lost = typed.filter((x) => x.t === 'lost'); const val = (l: typeof typed) => l.reduce((a, x) => a + (x.d.amountBase ?? toBase(x.d.amount, x.d.currency, s)), 0);
    const count = (vals: (string | null)[]) => [...vals.reduce((m, v) => m.set(v || 'Not recorded', (m.get(v || 'Not recorded') || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
    const owners = Array.from(new Set(typed.map((x) => x.d.ownerId)));
    return { subject: `Win/loss report — ${span}`, intro: `Deals closed in the ${span}.`,
      kpis: [['Won', `${won.length} · ${money(val(won))}`], ['Lost', `${lost.length} · ${money(val(lost))}`], ['Win rate', typed.length ? `${Math.round((won.length / typed.length) * 100)}%` : '—']],
      blocks: [{ title: 'By owner', head: ['Owner', 'Won', 'Lost', 'Won value'], rows: owners.map((o) => [uname(o), won.filter((x) => x.d.ownerId === o).length, lost.filter((x) => x.d.ownerId === o).length, money(val(won.filter((x) => x.d.ownerId === o)))]) },
        { title: 'Why we lost', head: ['Reason', 'Deals'], rows: count(lost.map((x) => x.d.lossReason)) }, { title: 'Lost to', head: ['Competitor', 'Deals'], rows: count(lost.map((x) => x.d.competitor)).filter(([k]) => k !== 'Not recorded') },
        { title: 'Why we won', head: ['Reason', 'Deals'], rows: count(won.map((x) => x.d.winReason)) }] };
  }
  if (kind === 'activities') {
    const done = await rowsOf(sql`select owner_id as id, type, count(*) as c from activities where done and done_at >= ${fromIso}::timestamptz group by owner_id, type`);
    const overdue = await rowsOf(sql`select owner_id as id, count(*) as c from activities where not done and due_date < ${todayISO()} group by owner_id`);
    const ids = Array.from(new Set([...done.map((x) => x.id), ...overdue.map((x) => x.id)]));
    const n = (id: unknown, t?: string) => done.filter((x) => x.id === id && (!t || x.type === t)).reduce((a, x) => a + Number(x.c), 0);
    return { subject: `Activity report — ${span}`, intro: `Calls, meetings and tasks completed in the ${span}, and what's overdue now.`,
      kpis: [['Completed', String(done.reduce((a, x) => a + Number(x.c), 0))], ['Overdue now', String(overdue.reduce((a, x) => a + Number(x.c), 0))]],
      blocks: [{ title: 'By person', head: ['Person', 'Calls', 'Meetings', 'Emails', 'Tasks', 'Overdue'], rows: ids.map((id) => [uname(id), n(id, 'call'), n(id, 'meeting'), n(id, 'email') + n(id, 'whatsapp'), n(id, 'task'), Number(overdue.find((x) => x.id === id)?.c || 0)]).sort((a, b) => Number(b[1]) + Number(b[2]) - Number(a[1]) - Number(a[2])) }] };
  }
  if (kind === 'leaderboard') {
    const lb = await salesLeaderboard(frequency === 'monthly' ? 'last_month' : 'week');
    return { subject: `Sales leaderboard — ${lb.label}`, intro: 'Ranked by won value.', kpis: [['Won', money(lb.rows.reduce((a, r) => a + r.won, 0))], ['Deals won', String(lb.rows.reduce((a, r) => a + r.wonCount, 0))]],
      blocks: [{ title: 'Ranking', head: ['Rep', 'Won', 'Deals', 'Win rate', 'Of target'], rows: lb.rows.map((r, i) => [`${i + 1}. ${r.name}`, money(r.won), r.wonCount, r.winRate != null ? `${r.winRate}%` : '—', r.attainment != null ? `${r.attainment}%` : '—']) }] };
  }
  // helpdesk
  const t = (await rowsOf(sql`select count(*) filter (where created_at >= ${fromIso}::timestamptz) as created, count(*) filter (where resolved_at >= ${fromIso}::timestamptz) as resolved, count(*) filter (where status_category <> 'closed') as backlog,
      count(*) filter (where resolved_at >= ${fromIso}::timestamptz and breached_at is null) as met, count(*) filter (where rated_at >= ${fromIso}::timestamptz and rating = 'good') as good, count(*) filter (where rated_at >= ${fromIso}::timestamptz and rating is not null) as rated
    from tickets where not is_spam and not is_sample`))[0];
  const ag = await agentLeaderboard(frequency === 'monthly' ? 'last_month' : 'week');
  const depts = await rowsOf(sql`select d.name, count(t.id) filter (where t.status_category <> 'closed') as open, count(t.id) filter (where t.status_category <> 'closed' and t.due_at < now()) as overdue from departments d left join tickets t on t.department_id = d.id and not t.is_spam group by d.name order by d.name`);
  const pct = (a: unknown, b: unknown) => Number(b) ? `${Math.round((Number(a) / Number(b)) * 100)}%` : '—';
  return { subject: `Helpdesk report — ${span}`, intro: `Tickets in the ${span}.`,
    kpis: [['Created', String(t.created)], ['Resolved', String(t.resolved)], ['Backlog now', String(t.backlog)], ['SLA met', pct(t.met, t.resolved)], ['Satisfaction', pct(t.good, t.rated)]],
    blocks: [{ title: 'By department', head: ['Department', 'Open', 'Overdue'], rows: depts.map((d) => [String(d.name), Number(d.open), Number(d.overdue)]) },
      { title: 'Agents', head: ['Agent', 'Resolved', 'First reply (min)', 'CSAT', 'SLA met'], rows: ag.rows.map((r) => [r.name, r.resolved, r.frtMins ?? '—', r.csat != null ? `${r.csat}%` : '—', r.slaMet != null ? `${r.slaMet}%` : '—']) }] };
}
/** Emails one schedule to its recipients now. */
export async function sendReport(r: ReportSchedule) {
  const s = await getSettings(); const rep = await buildReport(r.kind, r.frequency);
  const { html, text } = renderReport(rep, s.orgName, (process.env.APP_URL || '').replace(/\/$/, ''));
  const to = await db.select({ email: schema.users.email }).from(schema.users).where(and(inArray(schema.users.id, r.recipientIds.length ? r.recipientIds : ['00000000-0000-0000-0000-000000000000']), eq(schema.users.active, true)));
  let sent = 0; for (const u of to) if (await sendMail(u.email, rep.subject, text, html)) sent++;
  await db.update(schema.reportSchedules).set({ lastSentAt: new Date() }).where(eq(schema.reportSchedules.id, r.id));
  return { sent, of: to.length, subject: rep.subject, html };
}
/** Pure (unit-tested): is a schedule due at this local time? */
export function scheduleDue(r: Pick<ReportSchedule, 'frequency' | 'day' | 'hour' | 'lastSentAt' | 'active'>, now: Date, tz: string) {
  if (!r.active) return false;
  const l = localNow(now, tz); const hour = Number(l.hm.slice(0, 2)); const dom = Number(l.date.slice(8, 10));
  if (hour !== r.hour) return false;
  if (r.frequency === 'weekly' ? l.dow !== r.day : dom !== r.day) return false;
  return !r.lastSentAt || +now - +r.lastSentAt > 20 * 3600_000;
}
/** Hourly: send whatever is due. */
export async function reportJob(now = new Date()) {
  if (!mailEnabled()) return 0;
  const list = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.active, true)); let n = 0;
  for (const r of list) if (scheduleDue(r, now, APP_TZ || 'Asia/Dubai')) { try { await sendReport(r); n++; } catch (e) { log.error('report_failed', { id: r.id, error: String(e) }); } }
  return n;
}
