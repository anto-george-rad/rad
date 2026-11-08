import { describe, expect, it } from 'vitest';
import { addDaysISO, contractEndFrom, daysBetweenISO, formatPhone, isValidTrn, normalizePhone, passwordProblem, todayISO } from '@/lib/utils';

describe('phone numbers', () => {
  it('normalises UAE numbers to +971', () => {
    expect(normalizePhone('050 123 4567')).toBe('+971501234567');
    expect(normalizePhone('00971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('971501234567')).toBe('+971501234567');
    expect(normalizePhone('02 123 4567')).toBe('+97121234567');
    expect(normalizePhone('+44 20 7946 0000')).toBe('+442079460000');
    expect(normalizePhone('')).toBeNull();
  });
  it('formats +971 numbers for display', () => {
    expect(formatPhone('+971501234567')).toBe('+971 50 123 4567');
    expect(formatPhone('+97121234567')).toBe('+971 2 123 4567');
    expect(formatPhone('+442079460000')).toBe('+442079460000');
  });
});
describe('TRN', () => {
  it('accepts exactly 15 digits or empty', () => {
    expect(isValidTrn('100123456700003')).toBe(true);
    expect(isValidTrn('100 1234 5670 0003')).toBe(true);
    expect(isValidTrn('12345')).toBe(false);
    expect(isValidTrn('')).toBe(true);
  });
});
describe('passwords', () => {
  it('needs 10+ chars with letters and numbers, not the email name', () => {
    expect(passwordProblem('short1')).toMatch(/10/);
    expect(passwordProblem('onlyletterslong')).toMatch(/letters and numbers/);
    expect(passwordProblem('anto12345678', 'anto@raidefend.com')).toMatch(/email/);
    expect(passwordProblem('Desert-Falcon-2026')).toBeNull();
  });
});
describe('dates', () => {
  it('uses the company time zone for today', () => {
    // 21:30 UTC on 31 Dec is already 1 Jan in Dubai (UTC+4)
    expect(todayISO(new Date('2026-12-31T21:30:00Z'))).toBe('2027-01-01');
  });
  it('adds days and measures gaps without DST surprises', () => {
    expect(addDaysISO(1, '2026-02-28')).toBe('2026-03-01');
    expect(addDaysISO(-1, '2026-03-01')).toBe('2026-02-28');
    expect(daysBetweenISO('2026-01-01', '2026-03-01')).toBe(59);
  });
  it('computes contract end from start and term', () => {
    expect(contractEndFrom('2026-01-01', 12)).toBe('2026-12-31');
    expect(contractEndFrom('2026-03-15', 6)).toBe('2026-09-14');
    expect(contractEndFrom(null, 12)).toBeNull();
  });
});
