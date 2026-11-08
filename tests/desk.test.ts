import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, businessMinutesBetween, dueDates, pickPolicy } from '@/lib/sla';
import { isAutoReply, matchTicketRef, stripQuoted } from '@/lib/mail-parse';
import { canAssign, canSeeTicket, canWorkTicket, type DeskCtx, type AgentLite } from '@/lib/desk-rules';
import { renderMarkdown } from '@/lib/markdown';
import { totpCode, verifyTotp, base32Decode, base32Encode } from '@/lib/totp';
import type { SlaPolicy } from '@/db/schema';

const BH = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', holidays: ['2026-12-02'] };
const TZ = 'Asia/Dubai';
const dxb = (s: string) => new Date(s + '+04:00');

describe('business hours SLA', () => {
  it('adds minutes inside the working day', () => {
    expect(addBusinessMinutes(dxb('2026-11-09T09:00:00'), 60, BH, TZ).toISOString()).toBe(dxb('2026-11-09T10:00:00').toISOString());
  });
  it('rolls over the night', () => {
    expect(addBusinessMinutes(dxb('2026-11-09T16:30:00'), 60, BH, TZ).toISOString()).toBe(dxb('2026-11-10T08:30:00').toISOString());
  });
  it('skips the weekend (Fri 16:00 + 2h → Mon 09:00)', () => {
    expect(addBusinessMinutes(dxb('2026-11-13T16:00:00'), 120, BH, TZ).toISOString()).toBe(dxb('2026-11-16T09:00:00').toISOString());
  });
  it('a ticket created at night starts the clock next morning', () => {
    expect(addBusinessMinutes(dxb('2026-11-09T22:00:00'), 30, BH, TZ).toISOString()).toBe(dxb('2026-11-10T08:30:00').toISOString());
  });
  it('skips public holidays (2 Dec)', () => {
    expect(addBusinessMinutes(dxb('2026-12-01T16:00:00'), 120, BH, TZ).toISOString()).toBe(dxb('2026-12-03T09:00:00').toISOString());
  });
  it('24x7 policies ignore working hours', () => {
    expect(addBusinessMinutes(dxb('2026-11-13T23:00:00'), 120, BH, TZ, false).toISOString()).toBe(dxb('2026-11-14T01:00:00').toISOString());
  });
  it('counts working minutes between two times', () => {
    expect(businessMinutesBetween(dxb('2026-11-09T16:00:00'), dxb('2026-11-10T09:00:00'), BH, TZ)).toBe(120);
    expect(businessMinutesBetween(dxb('2026-11-13T16:00:00'), dxb('2026-11-16T08:00:00'), BH, TZ)).toBe(60);
  });
  it('picks the first matching policy and computes both due dates', () => {
    const base = { active: true, businessHours: true, warnPct: 80, escalateTo: 'both' as const, departmentId: null, tier: null };
    const ps = [{ ...base, id: 'std', name: 'Standard', sortOrder: 2, targets: { High: { first: 60, resolve: 480 } } },
      { ...base, id: 'vip', name: 'Strategic', sortOrder: 1, tier: 'Strategic', targets: { High: { first: 30, resolve: 240 } } }] as SlaPolicy[];
    expect(pickPolicy(ps, 'd1', 'Strategic')!.id).toBe('vip');
    expect(pickPolicy(ps, 'd1', 'Key')!.id).toBe('std');
    const d = dueDates(ps[1], 'High', dxb('2026-11-09T09:00:00'), BH, TZ);
    expect(d.firstResponseDueAt!.toISOString()).toBe(dxb('2026-11-09T09:30:00').toISOString());
    expect(d.dueAt!.toISOString()).toBe(dxb('2026-11-09T13:00:00').toISOString());
  });
});

describe('email threading', () => {
  it('finds the ticket reference in a subject', () => {
    expect(matchTicketRef('RE: [#RD-1042] Licence not activating', 'RD')).toBe(42);
    expect(matchTicketRef('Fwd: #rd-1001 hello', 'RD')).toBe(1);
    expect(matchTicketRef('New issue with firewall', 'RD')).toBeNull();
  });
  it('ignores auto-replies, bounces and bulk mail', () => {
    expect(isAutoReply({ 'auto-submitted': 'auto-replied' }, 'a@b.com')).toBe(true);
    expect(isAutoReply({ precedence: 'bulk' }, 'a@b.com')).toBe(true);
    expect(isAutoReply({}, 'MAILER-DAEMON@mx.example.com')).toBe(true);
    expect(isAutoReply({ 'auto-submitted': 'no' }, 'omar@client.ae')).toBe(false);
  });
  it('strips quoted history from replies', () => {
    const t = 'Thanks, that fixed it.\n\nOn Mon, 9 Nov 2026 at 10:00, Support <support@raidefend.com> wrote:\n> Please restart the service.';
    expect(stripQuoted(t)).toBe('Thanks, that fixed it.');
    expect(stripQuoted('Still failing\n\nFrom: Support\nSent: Monday\nSubject: x\nold text')).toBe('Still failing');
  });
});

describe('helpdesk permissions', () => {
  const ctx = (o: Partial<DeskCtx>): DeskCtx => ({ userId: 'me', role: 'agent', scope: 'own', deptIds: ['d1'], teamIds: ['t1'], reportIds: [], ...o });
  const t = (o: Partial<{ departmentId: string; teamId: string | null; assigneeId: string | null }>) => ({ departmentId: 'd1', teamId: null, assigneeId: null, ...o });
  const agent = (o: Partial<AgentLite>): AgentLite => ({ id: 'x', active: true, deskRole: 'agent', deptIds: ['d1'], teamIds: [], ...o });
  it('own scope: own + unassigned in my departments only', () => {
    expect(canSeeTicket(ctx({}), t({ assigneeId: 'me' }))).toBe(true);
    expect(canSeeTicket(ctx({}), t({}))).toBe(true);
    expect(canSeeTicket(ctx({}), t({ assigneeId: 'other' }))).toBe(false);
    expect(canSeeTicket(ctx({}), t({ departmentId: 'd2' }))).toBe(false);
  });
  it('team scope adds my teams; department scope adds the whole department', () => {
    expect(canSeeTicket(ctx({ scope: 'team' }), t({ assigneeId: 'other', teamId: 't1' }))).toBe(true);
    expect(canSeeTicket(ctx({ scope: 'team' }), t({ assigneeId: 'other', teamId: 't9' }))).toBe(false);
    expect(canSeeTicket(ctx({ scope: 'department' }), t({ assigneeId: 'other' }))).toBe(true);
    expect(canSeeTicket(ctx({ scope: 'department' }), t({ departmentId: 'd2' }))).toBe(false);
  });
  it('managers see tickets of people who report to them', () => {
    expect(canSeeTicket(ctx({ reportIds: ['sara'] }), t({ departmentId: 'd2', assigneeId: 'sara' }))).toBe(true);
  });
  it('light agents read their department but cannot work tickets; no role sees nothing', () => {
    expect(canSeeTicket(ctx({ role: 'light' }), t({ assigneeId: 'other' }))).toBe(true);
    expect(canWorkTicket(ctx({ role: 'light' }), t({}))).toBe(false);
    expect(canSeeTicket(ctx({ role: 'none' }), t({}))).toBe(false);
  });
  it('assignment respects department membership and scope', () => {
    expect(canAssign(ctx({}), t({}), agent({ id: 'me' }))).toBe(true);
    expect(canAssign(ctx({}), t({}), agent({ id: 'other' }))).toBe(false);
    expect(canAssign(ctx({ scope: 'department' }), t({}), agent({ id: 'other' }))).toBe(true);
    expect(canAssign(ctx({ scope: 'department' }), t({}), agent({ id: 'other', deptIds: ['d2'] }))).toBe(false);
    expect(canAssign(ctx({ scope: 'department' }), t({}), agent({ id: 'lite', deskRole: 'light' }))).toBe(false);
    expect(canAssign(ctx({ role: 'admin' }), t({}), agent({ id: 'other' }))).toBe(true);
    expect(canAssign(ctx({ scope: 'team' }), t({}), agent({ id: 'mate', teamIds: ['t1'] }))).toBe(true);
  });
});

describe('markdown is safe', () => {
  it('escapes HTML and formats basics', () => {
    const h = renderMarkdown('# Title\n\n<script>alert(1)</script> **bold** [link](https://x.ae)\n- a\n- b');
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<ul><li>a</li>'.replace('<ul><li>', '<ul>\n<li>'));
  });
  it('drops javascript: links', () => { expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript'); });
});

describe('two-step sign-in codes', () => {
  it('matches the RFC 6238 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpCode(secret, 59_000, 30, 8)).toBe('94287082');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('accepts the current code with a little clock drift', () => {
    const s = base32Encode(Buffer.from('raidefend-test-secret')); const now = Date.now();
    expect(verifyTotp(s, totpCode(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, '000000', now)).toBe(totpCode(s, now) === '000000');
  });
});

describe('mobile signatures', () => {
  it('drops a trailing "Sent from my iPhone"', () => {
    expect(stripQuoted('It crashes every time.\n\nSent from my iPhone')).toBe('It crashes every time.');
    expect(stripQuoted('Done.\nGet Outlook for Android\n')).toBe('Done.');
  });
  it('keeps the line when it is the whole message', () => {
    expect(stripQuoted('Sent from my iPhone')).toBe('Sent from my iPhone');
  });
});
