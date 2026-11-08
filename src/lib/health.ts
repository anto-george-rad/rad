import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { addDaysISO, todayISO } from './utils';
import { healthScore, type HealthInput } from './routing';

export type Health = ReturnType<typeof healthScore> & { input: HealthInput };
const uuidList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/** Health for many companies in a handful of grouped queries (used on lists and the customer page). */
export async function healthFor(companyIds: string[]): Promise<Map<string, Health>> {
  const out = new Map<string, Health>(); const ids = companyIds.filter((x) => /^[0-9a-f-]{36}$/.test(x)); if (!ids.length) return out;
  const L = uuidList(ids); const today = todayISO(); const in30 = addDaysISO(30, today);
  const rows = (q: ReturnType<typeof sql>) => db.execute(q).then((r) => r as unknown as Record<string, unknown>[]);
  const [tk, rt, touch, lic, con, won] = await Promise.all([
    rows(sql`select company_id as id, count(*) filter (where status_category <> 'closed' and not is_spam) as open, count(*) filter (where status_category <> 'closed' and priority = 'Urgent' and not is_spam) as urgent,
      count(*) filter (where breached_at > now() - interval '90 days') as breaches, count(*) filter (where sentiment = 'negative' and updated_at > now() - interval '90 days') as neg
      from tickets where company_id in (${L}) group by company_id`),
    rows(sql`select company_id as id, rating, count(*) as c from tickets where company_id in (${L}) and rated_at > now() - interval '90 days' and rating is not null group by company_id, rating`),
    rows(sql`select id, max(at) as at from (
        select related_id as id, coalesce(done_at, created_at) as at from activities where related_type = 'company' and done and related_id in (${L})
        union all select d.company_id, coalesce(a.done_at, a.created_at) from activities a join deals d on d.id = a.related_id where a.related_type = 'deal' and a.done and d.company_id in (${L})
        union all select c.company_id, coalesce(a.done_at, a.created_at) from activities a join contacts c on c.id = a.related_id where a.related_type = 'contact' and a.done and c.company_id in (${L})
        union all select company_id, at from email_logs where company_id in (${L})
      ) x group by id`),
    rows(sql`select company_id as id, count(*) as c from licences where company_id in (${L}) and status = 'active' and end_date <= ${in30} and end_date >= ${today} and renewal_deal_id is null group by company_id`),
    rows(sql`select company_id as id, bool_or(start_date <= ${today} and end_date >= ${today}) as active, count(*) as n from support_contracts where company_id in (${L}) group by company_id`),
    rows(sql`select d.company_id as id, count(*) as c from deals d join stages s on s.id = d.stage_id where s.type = 'won' and d.closed_at > now() - interval '365 days' and d.company_id in (${L}) group by d.company_id`),
  ]);
  const by = (list: Record<string, unknown>[], id: string) => list.find((r) => r.id === id);
  for (const id of ids) {
    const t = by(tk, id); const c = by(con, id); const at = by(touch, id)?.at as string | Date | undefined;
    const ratings = { good: 0, ok: 0, bad: 0 }; for (const r of rt.filter((x) => x.id === id)) ratings[(r.rating as 'good' | 'ok' | 'bad')] = Number(r.c);
    const input: HealthInput = { openTickets: Number(t?.open || 0), urgentOpen: Number(t?.urgent || 0), breaches90: Number(t?.breaches || 0), negativeSentiment90: Number(t?.neg || 0), ratings90: ratings,
      daysSinceContact: at ? Math.floor((Date.now() - +new Date(at)) / 864e5) : null, licencesExpiring30NoRenewal: Number(by(lic, id)?.c || 0),
      contractExpired: !!c && Number(c.n) > 0 && !c.active, wonLast365: Number(by(won, id)?.c || 0) };
    out.set(id, { ...healthScore(input), input });
  }
  return out;
}
