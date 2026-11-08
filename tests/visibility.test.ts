import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/db', () => ({ db: {}, schema: {} }));
const { computeScope, canSeeTask } = await import('@/lib/visibility');

const users = [
  { id: 'ceo', managerId: null }, { id: 'omar', managerId: 'ceo' }, { id: 'sara', managerId: 'omar' }, { id: 'ali', managerId: 'sara' }, { id: 'lina', managerId: 'ceo' },
];
describe('task visibility follows the reporting line', () => {
  it('a manager sees themselves and everyone below them', () => {
    expect([...computeScope(users, 'omar')].sort()).toEqual(['ali', 'omar', 'sara']);
  });
  it('someone with no reports sees only themselves', () => {
    expect([...computeScope(users, 'lina')]).toEqual(['lina']);
  });
  it('admins (null scope) and unassigned tasks are visible', () => {
    expect(canSeeTask(null, 'anyone')).toBe(true);
    expect(canSeeTask(new Set(['x']), null)).toBe(true);
    expect(canSeeTask(new Set(['x']), 'y')).toBe(false);
  });
});
