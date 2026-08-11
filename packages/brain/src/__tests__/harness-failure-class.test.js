/**
 * harness-failure-class.test.js — 共享失败分类模块 brain-unit 配对测试（lint-test-pairing）。
 *
 * 覆盖纯函数（枚举冻结 / 规范化）与 markHarnessTaskTerminal 的入参校验与 SQL 构造。
 * 说明：markHarnessTaskTerminal ↔ tasks 的「真库写入」由 sprint 合同测试
 * sprints/08111600-harness-failure-observability/tests/mark-terminal-result.test.ts 用真 Postgres 验（禁 mock 边），
 * 本 unit 只验受信入参路径下的 SQL/params 形态与校验分支，不 mock DB 读写语义。
 */
import { describe, it, expect } from 'vitest';
import {
  FAILURE_CLASSES,
  TERMINAL_FAILURE_STATUSES,
  normalizeFailureClass,
  markHarnessTaskTerminal,
} from '../harness-failure-class.js';

describe('harness-failure-class 枚举与规范化', () => {
  it('FAILURE_CLASSES 冻结且含兜底 unclassified', () => {
    expect(Object.isFrozen(FAILURE_CLASSES)).toBe(true);
    expect(FAILURE_CLASSES).toContain('unclassified');
    expect(FAILURE_CLASSES).toContain('watchdog_deadline');
    expect(FAILURE_CLASSES).toContain('missing_orchestrator_flag');
  });

  it('TERMINAL_FAILURE_STATUSES 冻结且为三态', () => {
    expect(Object.isFrozen(TERMINAL_FAILURE_STATUSES)).toBe(true);
    expect([...TERMINAL_FAILURE_STATUSES].sort()).toEqual(['blocked', 'cancelled', 'failed']);
  });

  it('normalizeFailureClass：枚举成员原样、非枚举/null/undefined → unclassified', () => {
    expect(normalizeFailureClass('watchdog_deadline')).toBe('watchdog_deadline');
    expect(normalizeFailureClass('product_failure')).toBe('product_failure');
    expect(normalizeFailureClass('free text xyz')).toBe('unclassified');
    expect(normalizeFailureClass(null)).toBe('unclassified');
    expect(normalizeFailureClass(undefined)).toBe('unclassified');
    expect(normalizeFailureClass(123)).toBe('unclassified');
  });
});

describe('markHarnessTaskTerminal 入参校验与 SQL/params 形态', () => {
  it('非 terminal status 抛错（不把 in_progress 写成假 terminal）', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    await expect(
      markHarnessTaskTerminal(pool, 'tid', { status: 'in_progress', failureClass: 'watchdog_deadline' }),
    ).rejects.toThrow(/terminal/);
  });

  it('缺 taskId / 非法 pool 抛错', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    await expect(markHarnessTaskTerminal(pool, '', { status: 'failed' })).rejects.toThrow(/taskId/);
    await expect(markHarnessTaskTerminal({}, 'tid', { status: 'failed' })).rejects.toThrow(/dbPool/);
  });

  it('failed：SQL 含字面 status=\'failed\' + result 合并，params 落规范化 failure_class + failure_detail', async () => {
    const calls = [];
    const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
    const out = await markHarnessTaskTerminal(pool, 'task-x', {
      status: 'failed',
      failureClass: 'watchdog_deadline',
      failureDetail: 'boom',
    });
    expect(out).toEqual({
      taskId: 'task-x',
      status: 'failed',
      failure_class: 'watchdog_deadline',
      failure_detail: 'boom',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/UPDATE tasks SET status = 'failed'/);
    expect(calls[0].sql).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\| \$3::jsonb/);
    expect(calls[0].params[0]).toBe('task-x');
    const patch = JSON.parse(calls[0].params[2]);
    expect(patch.failure_class).toBe('watchdog_deadline');
    expect(patch.failure_detail).toBe('boom');
  });

  it('自由文本 failureClass 规范化到 unclassified 落库（拒绝自由文本当 class）', async () => {
    const calls = [];
    const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
    await markHarnessTaskTerminal(pool, 'task-y', { status: 'blocked', failureClass: '随便自由文本' });
    const patch = JSON.parse(calls[0].params[2]);
    expect(patch.failure_class).toBe('unclassified');
    expect(calls[0].sql).toMatch(/UPDATE tasks SET status = 'blocked'/);
  });
});
