import type { AgentSkills } from '@/db/schema';

/** Pure routing rules (unit-tested): who may get a ticket right now. */
export type RoutingAgent = { id: string; skills: AgentSkills; shift: { days: number[]; start: string; end: string } | null; leave: { startDate: string; endDate: string }[] };
export type RoutingTicket = { productId: string | null; vendor: string | null; language: string | null };

/** Local weekday, date and HH:MM in the company time zone. */
export function localNow(now: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dow, date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
export function onShift(a: Pick<RoutingAgent, 'shift'>, now: Date, tz: string) {
  if (!a.shift) return true;
  const l = localNow(now, tz);
  if (!a.shift.days.includes(l.dow)) return false;
  return a.shift.start <= a.shift.end ? l.hm >= a.shift.start && l.hm < a.shift.end : l.hm >= a.shift.start || l.hm < a.shift.end; // overnight shifts
}
export function onLeave(a: Pick<RoutingAgent, 'leave'>, now: Date, tz: string) {
  const d = localNow(now, tz).date; return a.leave.some((x) => x.startDate <= d && d <= x.endDate);
}
/** 2 = matches every requirement the ticket has, 1 = agent has no preferences (generalist), 0 = mismatch. */
export function skillScore(a: Pick<RoutingAgent, 'skills'>, t: RoutingTicket) {
  const s = a.skills || { products: [], vendors: [], languages: [] };
  const generalist = !s.products.length && !s.vendors.length && !s.languages.length;
  const ok = (have: string[], want: string | null) => !want || !have.length || have.some((h) => h.toLowerCase() === want.toLowerCase());
  if (!ok(s.products, t.productId) || !ok(s.vendors, t.vendor) || !ok(s.languages, t.language)) return 0;
  if (generalist) return 1;
  const specific = (t.productId && s.products.length) || (t.vendor && s.vendors.length) || (t.language && s.languages.length);
  return specific ? 2 : 1;
}
/** Agents who are working now, then the best skill match among them (falls back to anyone working). */
export function routingPool<A extends RoutingAgent>(pool: A[], t: RoutingTicket, now: Date, tz: string): A[] {
  const working = pool.filter((a) => onShift(a, now, tz) && !onLeave(a, now, tz));
  if (!working.length) return [];
  const scored = working.map((a) => ({ a, s: skillScore(a, t) }));
  const best = Math.max(...scored.map((x) => x.s));
  return best > 0 ? scored.filter((x) => x.s === best).map((x) => x.a) : working;
}
/** Contract coverage on a given day: the active one, preferring a contract that lists the ticket's product. */
export function pickContract<C extends { startDate: string; endDate: string; productIds: string[] }>(list: C[], day: string, productId: string | null): C | null {
  const active = list.filter((c) => c.startDate <= day && day <= c.endDate);
  return active.find((c) => productId && c.productIds.includes(productId)) || active.find((c) => !c.productIds.length) || active[0] || null;
}
/** Customer health 0–100 from what we know about the account. */
export type HealthInput = { openTickets: number; urgentOpen: number; breaches90: number; ratings90: { good: number; ok: number; bad: number }; daysSinceContact: number | null;
  licencesExpiring30NoRenewal: number; contractExpired: boolean; wonLast365: number; negativeSentiment90: number };
export function healthScore(h: HealthInput) {
  let score = 100; const reasons: string[] = [];
  const hit = (n: number, why: string) => { if (n > 0) { score -= n; reasons.push(why); } };
  hit(Math.min(20, h.urgentOpen * 10), `${h.urgentOpen} urgent ticket${h.urgentOpen === 1 ? '' : 's'} open`);
  hit(Math.min(10, Math.max(0, h.openTickets - 3) * 2), `${h.openTickets} open tickets`);
  hit(Math.min(20, h.breaches90 * 5), `${h.breaches90} SLA breach${h.breaches90 === 1 ? '' : 'es'} in 90 days`);
  const rated = h.ratings90.good + h.ratings90.ok + h.ratings90.bad;
  if (rated) hit(Math.round((h.ratings90.bad / rated) * 25), `${h.ratings90.bad} of ${rated} ratings bad`);
  hit(Math.min(10, h.negativeSentiment90 * 5), `${h.negativeSentiment90} frustrated message${h.negativeSentiment90 === 1 ? '' : 's'}`);
  if (h.daysSinceContact == null) hit(10, 'No contact logged'); else if (h.daysSinceContact > 90) hit(15, `No contact for ${h.daysSinceContact} days`); else if (h.daysSinceContact > 45) hit(5, `No contact for ${h.daysSinceContact} days`);
  hit(Math.min(20, h.licencesExpiring30NoRenewal * 10), `${h.licencesExpiring30NoRenewal} licence${h.licencesExpiring30NoRenewal === 1 ? '' : 's'} expiring without a renewal deal`);
  if (h.contractExpired) hit(10, 'Support contract expired');
  if (h.wonLast365 > 0) { score += 5; }
  score = Math.max(0, Math.min(100, score));
  return { score, label: score >= 75 ? 'Healthy' : score >= 50 ? 'Watch' : 'At risk', reasons };
}
