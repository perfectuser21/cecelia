import { describe, it, expect, vi } from 'vitest';
// 与合同 sprints/.../tests/harness-failure-class.test.js 同口径的 co-located 单测
// （brain-unit 收口 + lint-test-pairing 配对；纯逻辑无 DB，fail-closed 用假 pool 断言不落库）。
import {
  FAILURE_CLASSES,
  assertFailureClass,
  markHarnessTerminal,
  TERMINAL_STATUSES,
} from '../harness-failure-class.js';

describe('harness-failure-class', () => {
  it('FAILURE_CLASSES 冻结非空且含 unknown 兜底桶', () => {
    const arr = [...FAILURE_CLASSES];
    expect(arr.length).toBeGreaterThan(0);
    expect(arr).toContain('unknown');
    expect(Object.isFrozen(FAILURE_CLASSES)).toBe(true);
  });

  it('assertFailureClass 拒绝白名单外值 / 空值，接受合法枚举', () => {
    expect(() => assertFailureClass('__free_text__')).toThrow();
    expect(() => assertFailureClass('')).toThrow();
    expect(() => assertFailureClass(null)).toThrow();
    expect(() => assertFailureClass('invalid_gear')).not.toThrow();
  });

  it('markHarnessTerminal 是函数，terminal 状态集合正确', () => {
    expect(typeof markHarnessTerminal).toBe('function');
    expect([...TERMINAL_STATUSES]).toEqual(['failed', 'blocked', 'cancelled']);
  });

  it('fail-closed：非法 failureClass 在任何 DB 写之前抛错（不落库）', async () => {
    const pool = { query: vi.fn() };
    await expect(
      markHarnessTerminal(pool, { taskId: 't1', status: 'failed', failureClass: '__nope__' }),
    ).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fail-closed：非 terminal 状态抛错（不落库）', async () => {
    const pool = { query: vi.fn() };
    await expect(
      markHarnessTerminal(pool, { taskId: 't1', status: 'completed', failureClass: 'invalid_gear' }),
    ).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
