import { describe, it, expect, vi } from 'vitest';
import { isInPatrolWindow, PATROL_HOUR_UTC, PATROL_WINDOW_MINUTES } from '../skill-drift-patrol.js';

vi.mock('../../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFile: vi.fn().mockResolvedValue(''), access: vi.fn().mockRejectedValue(new Error('not found')) };
});

describe('skill-drift-patrol — isInPatrolWindow', () => {
  it('UTC 02:00 在巡检窗口内', () => {
    expect(isInPatrolWindow(new Date('2026-06-11T02:02:00Z'))).toBe(true);
  });

  it('UTC 02:05 已超巡检窗口', () => {
    expect(isInPatrolWindow(new Date('2026-06-11T02:05:00Z'))).toBe(false);
  });

  it('UTC 15:00 不在巡检窗口', () => {
    expect(isInPatrolWindow(new Date('2026-06-11T15:00:00Z'))).toBe(false);
  });

  it('PATROL_HOUR_UTC 常量为 2', () => {
    expect(PATROL_HOUR_UTC).toBe(2);
  });

  it('PATROL_WINDOW_MINUTES 常量为 5', () => {
    expect(PATROL_WINDOW_MINUTES).toBe(5);
  });
});
