import { describe, it, expect, vi } from 'vitest';
import {
  FAILURE_CLASSES,
  isValidFailureClass,
  assertFailureClass,
  buildFailureResultPatch,
  computeFailureStats,
  deriveFailureClassFromReason,
  persistTerminalFailure,
} from '../failure-class.js';

// 单元配对测试（lint-test-pairing 要求）：与 sprints 合同测试同源验证受控枚举 + 落库助手行为。
describe('failure-class controlled enum', () => {
  it('FAILURE_CLASSES is a frozen array containing the canonical members', () => {
    expect(Object.isFrozen(FAILURE_CLASSES)).toBe(true);
    for (const c of ['timeout', 'runtime_crash', 'unknown', 'watchdog_deadline']) {
      expect(FAILURE_CLASSES).toContain(c);
    }
  });

  it('isValidFailureClass / assertFailureClass are fail-closed on free text', () => {
    expect(isValidFailureClass('timeout')).toBe(true);
    expect(isValidFailureClass('free_text_bogus')).toBe(false);
    expect(isValidFailureClass(42)).toBe(false);
    expect(() => assertFailureClass('timeout')).not.toThrow();
    expect(() => assertFailureClass('free_text_bogus')).toThrow(/invalid failure_class/i);
  });

  it('buildFailureResultPatch redacts detail secrets and keeps null null', () => {
    expect(buildFailureResultPatch('timeout', 'plain detail'))
      .toEqual({ failure_class: 'timeout', failure_detail: 'plain detail' });
    expect(buildFailureResultPatch('timeout', null))
      .toEqual({ failure_class: 'timeout', failure_detail: null });
    const redacted = buildFailureResultPatch('timeout', 'token=abc123secret');
    expect(redacted.failure_detail).not.toContain('abc123secret');
    expect(() => buildFailureResultPatch('nope', 'x')).toThrow(/invalid failure_class/i);
  });

  it('deriveFailureClassFromReason maps known reasons and defaults to unknown', () => {
    expect(deriveFailureClassFromReason('automation_deadline_exceeded')).toBe('watchdog_deadline');
    expect(deriveFailureClassFromReason('blocked_same_state:BLOCKED')).toBe('product_failure');
    expect(deriveFailureClassFromReason('timeout')).toBe('timeout');
    expect(deriveFailureClassFromReason('something totally novel')).toBe('unknown');
    expect(FAILURE_CLASSES).toContain(deriveFailureClassFromReason(null));
  });

  it('computeFailureStats wires by_class + rolling failure_rate', () => {
    const stats = computeFailureStats([
      { failure_class: 'timeout', is_terminal_failed: true },
      { failure_class: 'timeout', is_terminal_failed: true },
      { failure_class: 'runtime_crash', is_terminal_failed: true },
      { failure_class: null, is_terminal_failed: false },
    ]);
    expect(stats.by_class).toEqual({ timeout: 2, runtime_crash: 1 });
    expect(stats.total_terminal_failed).toBe(3);
    expect(stats.total_terminal_done).toBe(1);
    expect(stats.failure_rate).toBeCloseTo(0.75, 2);
    expect(computeFailureStats([])).toEqual({
      by_class: {}, total_terminal_failed: 0, total_terminal_done: 0, failure_rate: 0,
    });
  });

  it('persistTerminalFailure asserts class then writes result patch via one UPDATE', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await persistTerminalFailure({ query }, 'task-1', 'timeout', 'boom');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE tasks SET result = COALESCE\(result, '\{\}'::jsonb\) \|\| \$2::jsonb WHERE id = \$1/);
    expect(params[0]).toBe('task-1');
    expect(JSON.parse(params[1])).toEqual({ failure_class: 'timeout', failure_detail: 'boom' });

    const rejectQuery = vi.fn();
    await expect(persistTerminalFailure({ query: rejectQuery }, 'task-2', 'bogus', 'x'))
      .rejects.toThrow(/invalid failure_class/i);
    expect(rejectQuery).not.toHaveBeenCalled();
  });
});
