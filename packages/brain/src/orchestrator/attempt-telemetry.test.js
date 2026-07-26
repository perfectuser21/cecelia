import { describe, expect, it } from 'vitest';

import {
  calculateAttemptTime,
  queryAttemptTelemetry,
} from './attempt-telemetry.js';

describe('attempt-telemetry', () => {
  it('calculateAttemptTime 只接受完整且单调的结构化时间', () => {
    expect(calculateAttemptTime({
      created_at: '2026-07-26T00:00:00.000Z',
      started_at: '2026-07-26T00:00:00.500Z',
      completed_at: '2026-07-26T00:00:01.500Z',
      time_derived: true,
    })).toEqual({
      active_time_ms: 1000,
      wait_time_ms: 500,
      wall_time_ms: 1500,
      derived: true,
    });

    expect(calculateAttemptTime({
      created_at: '2026-07-26T00:00:02.000Z',
      started_at: '2026-07-26T00:00:01.000Z',
      completed_at: '2026-07-26T00:00:03.000Z',
      time_derived: false,
    })).toEqual({
      active_time_ms: 0,
      wait_time_ms: 0,
      wall_time_ms: 0,
      derived: false,
    });
  });

  it('queryAttemptTelemetry 从结构化字段聚合且不泄露 result 文本', async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (calls.length === 1) return { rows: [{ id: 'run-a' }] };
        return {
          rows: [
            {
              id: 'attempt-a',
              run_id: 'run-a',
              hop: 1,
              role: 'generator',
              status: 'completed',
              logical_cycle_id: 'cycle-a',
              attempt_kind: 'retry',
              retry_of_attempt_id: 'attempt-parent',
              restart_reason: 'evaluator_failed',
              workstream_key: 'ws2',
              time_derived: false,
              created_at: '2026-07-26T00:00:00.000Z',
              started_at: '2026-07-26T00:00:00.500Z',
              completed_at: '2026-07-26T00:00:01.500Z',
              result: {
                evaluation: { valid: false },
                summary: 'SUPER-SECRET must not leave the server',
              },
            },
            {
              id: 'attempt-b',
              run_id: 'run-a',
              hop: 2,
              role: 'reviewer',
              status: 'running',
              logical_cycle_id: 'cycle-a',
              attempt_kind: 'initial',
              retry_of_attempt_id: null,
              restart_reason: null,
              workstream_key: null,
              time_derived: false,
              created_at: '2026-07-26T00:00:02.000Z',
              started_at: '2026-07-26T00:00:02.500Z',
              completed_at: null,
              result: null,
            },
          ],
        };
      },
    };

    const telemetry = await queryAttemptTelemetry(db, {
      taskId: 'task-a',
      tenantId: 'tenant-a',
    });

    expect(calls[0].params).toEqual(['task-a', 'tenant-a']);
    expect(calls[1].params).toEqual([['run-a']]);
    expect(telemetry).toMatchObject({
      task_id: 'task-a',
      run_count: 1,
      logical_cycle_count: 1,
      raw_counts: { generator: 1, reviewer: 1 },
      totals: {
        active_time_ms: 1000,
        wait_time_ms: 500,
        wall_time_ms: 1500,
        retry_count: 1,
        recovery_count: 0,
        invalid_count: 1,
      },
      role_metrics: [{
        role: 'generator',
        workstream_key: 'ws2',
        active_time_ms: 1000,
        wait_time_ms: 500,
        wall_time_ms: 1500,
        retry_count: 1,
        recovery_count: 0,
        invalid_count: 1,
      }],
    });
    expect(telemetry.attempts).toEqual([
      expect.objectContaining({
        attempt_id: 'attempt-a',
        logical_cycle_id: 'cycle-a',
        workstream_key: 'ws2',
      }),
      expect.objectContaining({
        attempt_id: 'attempt-b',
        logical_cycle_id: 'cycle-a',
        workstream_key: 'ws1',
      }),
    ]);
    expect(JSON.stringify(telemetry)).not.toContain('SUPER-SECRET');
    expect(telemetry.attempts[0]).not.toHaveProperty('result');
  });

  it('queryAttemptTelemetry 对无租户命中返回结构化 telemetry_not_found', async () => {
    const db = { query: async () => ({ rows: [] }) };

    await expect(queryAttemptTelemetry(db, {
      taskId: 'task-a',
      tenantId: 'tenant-b',
    })).rejects.toMatchObject({
      message: 'telemetry_not_found',
      code: 'telemetry_not_found',
    });
  });

  it('legacy null logical_cycle_id 的计数与响应 fallback 使用同一口径', async () => {
    const sqls = [];
    const db = {
      query: async (sql) => {
        sqls.push(sql);
        if (sql.includes('JOIN initiative_runs')) return { rows: [{ id: 'run-legacy' }] };
        return {
          rows: [{
            id: 'attempt-legacy',
            run_id: 'run-legacy',
            hop: 1,
            role: 'generator',
            status: 'completed',
            logical_cycle_id: null,
            attempt_kind: null,
            retry_of_attempt_id: null,
            restart_reason: null,
            workstream_key: null,
            time_derived: false,
            created_at: '2026-07-26T00:00:00.000Z',
            started_at: '2026-07-26T00:00:00.500Z',
            completed_at: '2026-07-26T00:00:01.500Z',
            result: null,
          }],
        };
      },
    };

    const telemetry = await queryAttemptTelemetry(db, {
      taskId: 'task-legacy',
      tenantId: 'tenant-a',
    });

    expect(telemetry.logical_cycle_count).toBe(1);
    expect(telemetry.attempts[0].logical_cycle_id).toBe('intent:run-legacy:1');
    expect(sqls[0]).toMatch(/COALESCE\([^)]*tenant_id[^)]]*'default'/);
  });
});
