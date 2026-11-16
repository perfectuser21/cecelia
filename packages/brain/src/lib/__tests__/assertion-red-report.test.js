// 真实业务断言回执读取、严重级分组与probe身份；不测退休日报渲染。
import { describe, it, expect, vi } from 'vitest';
import {
  PROBE_EXECUTOR_KIND,
  probeKeyOf,
  readAssertionRedState,
} from '../assertion-red-report.js';

const row = (o) => ({
  journey: '客户智能获客路径', step: 'Lead 表进人', assertion_ref: 'probe:videos_readback',
  fail_count: 3, has_error: true, last_at: '2026-09-26T01:00:00Z', ...o,
});
const poolOf = (rows) => ({ query: vi.fn().mockResolvedValue({ rows }) });

describe('readAssertionRedState — 分组与分级', () => {
  it('查询只看探针执行体 + FAIL + 24h 窗口', async () => {
    const pool = poolOf([]);
    await readAssertionRedState(pool);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM journey_assertion_receipts/);
    expect(sql).toMatch(/verdict = 'FAIL'/);
    expect(sql).toMatch(/activity_cells/);
    expect(sql).toMatch(/activities/);
    expect(sql).toMatch(/JOIN \(SELECT \* FROM value_streams UNION ALL SELECT \* FROM capabilities\) j/);
    expect(params).toEqual([PROBE_EXECUTOR_KIND, 24]);
    expect(PROBE_EXECUTOR_KIND).toBe('business_probe_runner');
  });

  it('含 severity=error 的组 → level RED，组按 journey/step/probe key 计数', async () => {
    const state = await readAssertionRedState(poolOf([
      row(),
      row({ assertion_ref: 'probe:line_key_not_null', fail_count: 1, has_error: false }),
    ]));
    expect(state.level).toBe('RED');
    expect(state.total).toBe(4);
    expect(state.window_hours).toBe(24);
    expect(state.groups).toEqual([
      expect.objectContaining({ journey: '客户智能获客路径', step: 'Lead 表进人', probe_key: 'videos_readback', fail_count: 3, severity: 'error' }),
      expect.objectContaining({ probe_key: 'line_key_not_null', fail_count: 1, severity: 'warn' }),
    ]);
  });

  it('只有 warn → level AMBER；severity 缺失（has_error 为 null）按 warn', async () => {
    const state = await readAssertionRedState(poolOf([
      row({ has_error: false }),
      row({ assertion_ref: 'probe:x', has_error: null }),
    ]));
    expect(state.level).toBe('AMBER');
    expect(state.groups.every((g) => g.severity === 'warn')).toBe(true);
  });

  it('pg 文本布尔 "t" 也认作 error', async () => {
    const state = await readAssertionRedState(poolOf([row({ has_error: 't' })]));
    expect(state.level).toBe('RED');
  });

  it('空集 → null', async () => {
    await expect(readAssertionRedState(poolOf([]))).resolves.toBeNull();
  });

  it('查询失败 → best-effort null，不抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('relation does not exist')) };
    await expect(readAssertionRedState(pool)).resolves.toBeNull();
  });

  it('probeKeyOf 去掉 probe: 前缀，非探针 ref 原样', () => {
    expect(probeKeyOf('probe:videos_readback')).toBe('videos_readback');
    expect(probeKeyOf('tests/e2e/x.spec.ts')).toBe('tests/e2e/x.spec.ts');
    expect(probeKeyOf(null)).toBe('');
  });
});
