/**
 * Codex round-10 #4: 静默时段检查 — 跨午夜场景必须正确
 */
import { isInQuietHours } from './decider.service';

function at(h: number, m = 0): Date {
  const d = new Date(2026, 0, 1, h, m, 0, 0);
  return d;
}

describe('isInQuietHours — same-day window', () => {
  it('inside 09:00-18:00 at 14:00 → true', () => {
    expect(isInQuietHours(at(14), '09:00', '18:00')).toBe(true);
  });
  it('before 09:00 at 08:00 → false', () => {
    expect(isInQuietHours(at(8), '09:00', '18:00')).toBe(false);
  });
  it('at end boundary 18:00 → false (exclusive)', () => {
    expect(isInQuietHours(at(18), '09:00', '18:00')).toBe(false);
  });
  it('at start boundary 09:00 → true (inclusive)', () => {
    expect(isInQuietHours(at(9), '09:00', '18:00')).toBe(true);
  });
});

describe('isInQuietHours — cross-midnight window 22:00-08:00', () => {
  it('at 23:00 → true', () => {
    expect(isInQuietHours(at(23), '22:00', '08:00')).toBe(true);
  });
  it('at 02:00 → true', () => {
    expect(isInQuietHours(at(2), '22:00', '08:00')).toBe(true);
  });
  it('at 07:59 → true', () => {
    expect(isInQuietHours(at(7, 59), '22:00', '08:00')).toBe(true);
  });
  it('at 08:00 (end boundary) → false (exclusive)', () => {
    expect(isInQuietHours(at(8), '22:00', '08:00')).toBe(false);
  });
  it('at 21:59 → false', () => {
    expect(isInQuietHours(at(21, 59), '22:00', '08:00')).toBe(false);
  });
  it('at 12:00 (middle of day) → false', () => {
    expect(isInQuietHours(at(12), '22:00', '08:00')).toBe(false);
  });
});

describe('isInQuietHours — edge cases', () => {
  it('zero-length window 09:00-09:00 → always false', () => {
    expect(isInQuietHours(at(9), '09:00', '09:00')).toBe(false);
    expect(isInQuietHours(at(15), '09:00', '09:00')).toBe(false);
  });
  it('invalid format gracefully returns false', () => {
    expect(isInQuietHours(at(14), 'abc', '18:00')).toBe(false);
    expect(isInQuietHours(at(14), '09:00', 'xyz')).toBe(false);
  });
});
