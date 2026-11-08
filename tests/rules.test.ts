import { describe, expect, it } from 'vitest';
import { scoreLead } from '@/lib/scoring';
import { licenceReminderDue, renewalDue, timeTriggerKey } from '@/lib/schedule-rules';
import { brandTokens, contrast } from '@/lib/brand';
import type { ScoringRule } from '@/db/schema';

const rule = (field: string, operator: 'is' | 'contains' | 'filled', value: string | null, points: number): ScoringRule => ({ id: field + value, field, operator, value, points });

describe('lead scoring', () => {
  const rules = [rule('email', 'filled', null, 10), rule('source', 'is', 'Referral', 25), rule('jobTitle', 'contains', 'ciso|cto', 20)];
  it('adds points for matching rules', () => {
    expect(scoreLead({ email: 'a@b.ae', source: 'Referral', jobTitle: 'Group CISO' }, rules).score).toBe(55);
    expect(scoreLead({ source: 'referral' }, rules).score).toBe(25);
  });
  it('caps at 0–100', () => {
    expect(scoreLead({}, [rule('email', 'filled', null, -50)]).score).toBe(0);
    expect(scoreLead({ email: 'x@y.z' }, [rule('email', 'filled', null, 150)]).score).toBe(100);
  });
});

describe('time-based automation rules', () => {
  const today = '2026-11-08';
  it('closing soon fires within the window, keyed by the closing date', () => {
    expect(timeTriggerKey('deal.closing_soon', 7, { closingDate: '2026-11-12' }, today)).toBe('closing:2026-11-12');
    expect(timeTriggerKey('deal.closing_soon', 7, { closingDate: '2026-11-20' }, today)).toBeNull();
    expect(timeTriggerKey('deal.closing_soon', 7, { closingDate: '2026-11-01' }, today)).toBeNull();
  });
  it('idle fires after N days in the stage, once per stage entry', () => {
    expect(timeTriggerKey('deal.idle', 14, { stageEnteredAt: new Date('2026-10-20T08:00:00Z') }, today)).toBe('idle:2026-10-20');
    expect(timeTriggerKey('deal.idle', 14, { stageEnteredAt: new Date('2026-11-01T08:00:00Z') }, today)).toBeNull();
  });
  it('untouched leads fire only while New and never contacted', () => {
    expect(timeTriggerKey('lead.untouched', 2, { status: 'New', createdAt: new Date('2026-11-04T08:00:00Z') }, today)).toBe('untouched');
    expect(timeTriggerKey('lead.untouched', 2, { status: 'New', createdAt: new Date('2026-11-04T08:00:00Z'), firstContactedAt: new Date() }, today)).toBeNull();
    expect(timeTriggerKey('lead.untouched', 2, { status: 'Contacted', createdAt: new Date('2026-11-01T08:00:00Z') }, today)).toBeNull();
  });
  it('renewals open 90 days before contract end', () => {
    expect(renewalDue('2027-01-15', today, 90)).toBe(true);
    expect(renewalDue('2027-03-15', today, 90)).toBe(false);
    expect(renewalDue('2026-09-01', today, 90)).toBe(false); // ended long ago
  });
  it('licence reminders fire once per expiry date', () => {
    expect(licenceReminderDue('2026-11-30', null, today, 30)).toBe(true);
    expect(licenceReminderDue('2026-11-30', '2026-11-30', today, 30)).toBe(false);
    expect(licenceReminderDue('2027-02-01', null, today, 30)).toBe(false);
  });
});

describe('brand colour', () => {
  it('keeps the accent readable on white and on the dark surface', () => {
    for (const hex of ['#4C5BFF', '#F5D90A', '#0F9D6E', '#111111']) {
      const t = brandTokens(hex)!; const rgb = (s: string) => s.split(' ').map(Number);
      expect(contrast(rgb(t.light.accent), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(t.dark.accent), [17, 21, 36])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('rejects bad input', () => { expect(brandTokens('blue')).toBeNull(); });
});
