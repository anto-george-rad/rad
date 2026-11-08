import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { healthScore, onLeave, onShift, pickContract, routingPool, skillScore } from '@/lib/routing';
import { detectLanguage, heuristicCategory, heuristicPriority, heuristicSentiment } from '@/lib/triage-rules';
import { wantsSales } from '@/lib/handoff';
import { nextEscalation } from '@/lib/escalation';
import { contractEconomics } from '@/lib/contracts';
import { messageParties } from '@/lib/outlook';
import { phoneKey, validSignature } from '@/lib/whatsapp';
import { checkLeadForm } from '@/lib/lead-form';
import { renderReport, scheduleDue } from '@/lib/report-mail';
import { agentPoints, periodRange } from '@/lib/leaderboard';
import { basePerms, narrowPerms } from '@/lib/auth';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';

const TZ = 'Asia/Dubai'; const dxb = (s: string) => new Date(s + '+04:00');
const none = { products: [], vendors: [], languages: [] };

describe('skills, shifts and leave routing', () => {
  const day = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };
  it('respects shifts in Gulf time, including overnight shifts', () => {
    expect(onShift({ shift: day }, dxb('2026-11-09T09:00:00'), TZ)).toBe(true); // Monday
    expect(onShift({ shift: day }, dxb('2026-11-09T17:00:00'), TZ)).toBe(false);
    expect(onShift({ shift: day }, dxb('2026-11-08T10:00:00'), TZ)).toBe(false); // Sunday
    expect(onShift({ shift: { days: [1], start: '22:00', end: '06:00' } }, dxb('2026-11-09T23:30:00'), TZ)).toBe(true);
    expect(onShift({ shift: null }, dxb('2026-11-08T03:00:00'), TZ)).toBe(true);
  });
  it('skips agents on leave', () => {
    expect(onLeave({ leave: [{ startDate: '2026-11-09', endDate: '2026-11-12' }] }, dxb('2026-11-10T10:00:00'), TZ)).toBe(true);
    expect(onLeave({ leave: [{ startDate: '2026-11-09', endDate: '2026-11-12' }] }, dxb('2026-11-13T10:00:00'), TZ)).toBe(false);
  });
  it('prefers the best skill match and falls back to anyone working', () => {
    const t = { productId: 'p1', vendor: null, language: 'Arabic' };
    expect(skillScore({ skills: { products: ['p1'], vendors: [], languages: ['Arabic'] } }, t)).toBe(2);
    expect(skillScore({ skills: none }, t)).toBe(1);
    expect(skillScore({ skills: { products: ['p2'], vendors: [], languages: [] } }, t)).toBe(0);
    const pool = [{ id: 'gen', skills: none, shift: null, leave: [] }, { id: 'ar', skills: { products: [], vendors: [], languages: ['Arabic'] }, shift: null, leave: [] }, { id: 'away', skills: { products: ['p1'], vendors: [], languages: ['Arabic'] }, shift: null, leave: [{ startDate: '2000-01-01', endDate: '2100-01-01' }] }];
    expect(routingPool(pool, t, new Date(), TZ).map((a) => a.id)).toEqual(['ar']);
    expect(routingPool([{ id: 'x', skills: { products: ['p9'], vendors: [], languages: [] }, shift: null, leave: [] }], t, new Date(), TZ).map((a) => a.id)).toEqual(['x']);
  });
});
describe('support contracts', () => {
  const cs = [{ id: 'old', startDate: '2025-01-01', endDate: '2025-12-31', productIds: [] }, { id: 'all', startDate: '2026-01-01', endDate: '2026-12-31', productIds: [] }, { id: 'edr', startDate: '2026-06-01', endDate: '2027-05-31', productIds: ['edr'] }];
  it('picks the active contract, preferring one that names the product', () => {
    expect(pickContract(cs, '2026-11-08', 'edr')?.id).toBe('edr');
    expect(pickContract(cs, '2026-11-08', 'other')?.id).toBe('all');
    expect(pickContract(cs, '2028-01-01', null)).toBeNull();
  });
  it('works out hours used, cost and margin', () => {
    expect(contractEconomics({ hoursIncluded: 40, value: 20000 }, 1800, 150)).toEqual({ hours: 30, cost: 4500, usedPct: 75, margin: 78, profit: 15500 });
    expect(contractEconomics({ hoursIncluded: null, value: null }, 90, 150).usedPct).toBeNull();
  });
});
describe('customer health', () => {
  const base = { openTickets: 0, urgentOpen: 0, breaches90: 0, ratings90: { good: 0, ok: 0, bad: 0 }, daysSinceContact: 5, licencesExpiring30NoRenewal: 0, contractExpired: false, wonLast365: 0, negativeSentiment90: 0 };
  it('is healthy with no warning signs', () => expect(healthScore(base)).toMatchObject({ score: 100, label: 'Healthy', reasons: [] }));
  it('drops with urgent tickets, breaches, bad ratings and lapsing licences', () => {
    const h = healthScore({ ...base, urgentOpen: 2, breaches90: 3, ratings90: { good: 1, ok: 0, bad: 3 }, licencesExpiring30NoRenewal: 1, daysSinceContact: 120 });
    expect(h.label).toBe('At risk'); expect(h.reasons.length).toBe(5); expect(h.score).toBeLessThan(50);
  });
});
describe('AI fallbacks (keyword rules)', () => {
  it('detects language, mood, urgency and category', () => {
    expect(detectLanguage('مرحبا، لدينا مشكلة في الترخيص')).toBe('Arabic');
    expect(detectLanguage('The console is down')).toBe('English');
    expect(heuristicSentiment('This is the third time I am asking. Unacceptable!')).toBe('negative');
    expect(heuristicSentiment('Thanks, works now')).toBe('positive');
    expect(heuristicPriority('Outage: all endpoints offline')).toBe('Urgent');
    expect(heuristicPriority('Cannot activate the licence')).toBe('High');
    expect(heuristicCategory('Licence key will not activate', DEFAULT_SETTINGS.ticketCategories)).toBe('Licensing');
  });
});
describe('sales handoff', () => {
  it('spots renewal and upgrade requests', () => {
    expect(wantsSales('Can you send a quote to renew for next year?', DEFAULT_SETTINGS.handoffKeywords)).toBe(true);
    expect(wantsSales('We need 20 more licences', DEFAULT_SETTINGS.handoffKeywords)).toBe(true);
    expect(wantsSales('Agent is crashing on startup', DEFAULT_SETTINGS.handoffKeywords)).toBe(false);
    expect(wantsSales('anything', '(')).toBe(false);
  });
});
describe('escalation ladder', () => {
  const rules = [{ level: 1, afterMinutes: 0, departmentId: null, active: true }, { level: 2, afterMinutes: 240, departmentId: null, active: true }, { level: 3, afterMinutes: 60, departmentId: 'ren', active: true }];
  const now = new Date('2026-11-08T12:00:00Z');
  it('climbs one level at a time as time passes, and department ladders win', () => {
    expect(nextEscalation(rules, { departmentId: 'sup', dueAt: new Date('2026-11-08T11:00:00Z'), escalationLevel: 0 }, now)?.level).toBe(1);
    expect(nextEscalation(rules, { departmentId: 'sup', dueAt: new Date('2026-11-08T07:00:00Z'), escalationLevel: 1 }, now)?.level).toBe(2);
    expect(nextEscalation(rules, { departmentId: 'sup', dueAt: new Date('2026-11-08T07:00:00Z'), escalationLevel: 2 }, now)).toBeNull();
    expect(nextEscalation(rules, { departmentId: 'ren', dueAt: new Date('2026-11-08T10:00:00Z'), escalationLevel: 0 }, now)?.level).toBe(3);
    expect(nextEscalation(rules, { departmentId: 'sup', dueAt: new Date('2026-11-08T13:00:00Z'), escalationLevel: 0 }, now)).toBeNull();
  });
});
describe('Outlook sync matching', () => {
  it('finds outside parties and direction, ignoring colleagues', () => {
    const m = { id: '1', from: { emailAddress: { address: 'Sara@Falcon.ae' } }, toRecipients: [{ emailAddress: { address: 'omar@raidefend.com' } }], ccRecipients: [{ emailAddress: { address: 'ali@raidefend.com' } }] };
    expect(messageParties(m, 'omar@raidefend.com')).toMatchObject({ direction: 'in', outside: ['sara@falcon.ae'] });
    expect(messageParties({ ...m, from: { emailAddress: { address: 'omar@raidefend.com' } }, toRecipients: [{ emailAddress: { address: 'x@client.com' } }] }, 'omar@raidefend.com')).toMatchObject({ direction: 'out', outside: ['x@client.com'] });
  });
});
describe('WhatsApp webhook', () => {
  it('checks Meta’s signature and normalises phone numbers', () => {
    const body = '{"entry":[]}'; const sig = 'sha256=' + createHmac('sha256', 'shh').update(body).digest('hex');
    expect(validSignature(body, sig, 'shh')).toBe(true); expect(validSignature(body, sig, 'other')).toBe(false); expect(validSignature(body, null, 'shh')).toBe(false);
    expect(phoneKey('+971 50 123 4567')).toBe(phoneKey('0501234567'));
  });
});
describe('website lead form', () => {
  it('validates and spots bots', () => {
    expect('error' in checkLeadForm({ name: '', email: 'a@b.com' })).toBe(true);
    expect('error' in checkLeadForm({ name: 'Sara', email: 'not-an-email' })).toBe(true);
    expect('error' in checkLeadForm({ name: 'Sara' })).toBe(true);
    expect('error' in checkLeadForm({ name: 'Sara', email: 'sara@x.ae', t: Date.now() })).toBe(true);
    const ok = checkLeadForm({ name: 'Sara Al Mansoori', email: 'SARA@X.AE', consent: 'on', t: Date.now() - 10_000 });
    expect('values' in ok && ok.values).toMatchObject({ firstName: 'Sara', lastName: 'Al Mansoori', email: 'sara@x.ae', consent: true });
    expect(checkLeadForm({ name: 'bot', email: 'b@b.com', website: 'spam.com' })).toMatchObject({ bot: true });
  });
});
describe('scheduled reports', () => {
  it('fires once at the right local hour and day', () => {
    const r = { frequency: 'weekly' as const, day: 1, hour: 8, lastSentAt: null, active: true };
    expect(scheduleDue(r, dxb('2026-11-09T08:10:00'), TZ)).toBe(true);
    expect(scheduleDue(r, dxb('2026-11-09T09:10:00'), TZ)).toBe(false);
    expect(scheduleDue({ ...r, lastSentAt: dxb('2026-11-09T08:01:00') }, dxb('2026-11-09T08:30:00'), TZ)).toBe(false);
    expect(scheduleDue({ ...r, frequency: 'monthly', day: 9 }, dxb('2026-11-09T08:10:00'), TZ)).toBe(true);
  });
  it('renders escaped HTML and a text version', () => {
    const { html, text } = renderReport({ subject: 'Pipeline <b>', intro: 'x', kpis: [['Open', '3']], blocks: [{ title: 'By stage', head: ['Stage', 'Deals'], rows: [['<script>', 2]] }] }, 'Raidefend', '');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(text).toContain('BY STAGE');
  });
});
describe('leaderboards', () => {
  it('scores agents and spans periods', () => {
    expect(agentPoints({ resolved: 10, good: 4, bad: 1, breaches: 2, frtMins: 30 })).toBe(10 * 10 + 20 - 5 - 16 + 20);
    expect(agentPoints({ resolved: 0, good: 0, bad: 5, breaches: 5, frtMins: null })).toBe(0);
    const q = periodRange('quarter', new Date('2026-11-08T10:00:00Z')); expect(q.label).toBe('Q4 2026'); expect(q.months).toBe(3);
  });
});
describe('custom roles', () => {
  it('only ever take rights away', () => {
    const base = basePerms('manager', 'agent');
    expect(base.exportData).toBe(true); expect(basePerms('rep', 'none').exportData).toBe(false);
    const n = narrowPerms(base, { exportData: false, viewCost: false }); expect(n.exportData).toBe(false); expect(n.viewCost).toBe(false); expect(n.importData).toBe(true);
    expect(narrowPerms(basePerms('rep', 'none'), { exportData: true }).exportData).toBe(false);
  });
});
