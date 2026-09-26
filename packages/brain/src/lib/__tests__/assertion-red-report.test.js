/**
 * assertion-red-report.js — 业务断言红灯（链 bf5088a3 棒4 消费，决策 702949b6）。
 * 24h 内 business_probe_runner 的 FAIL 回执：任一 severity=error → RED，只有 warn → AMBER，
 * 空集/查询失败 → null（晨报不出行、日报不出板块）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PROBE_EXECUTOR_KIND,
  probeKeyOf,
  readAssertionRedState,
  renderAssertionRedLine,
  renderAssertionRedSection,
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
    expect(sql).toMatch(/journey_step_links/);
    expect(sql).toMatch(/journey_steps/);
    expect(sql).toMatch(/JOIN journeys/);
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

describe('render — 晨报一行 / 日报板块', () => {
  const state = {
    level: 'RED', total: 4, window_hours: 24,
    groups: [
      { journey: '客户智能获客路径', step: 'Lead 表进人', probe_key: 'videos_readback', fail_count: 3, severity: 'error', last_at: null },
      { journey: '客户智能获客路径', step: 'Lead 表进人', probe_key: 'line_key_not_null', fail_count: 1, severity: 'warn', last_at: null },
    ],
  };

  it('null → 晨报无行，日报空串', () => {
    expect(renderAssertionRedLine(null)).toBeNull();
    expect(renderAssertionRedSection(null)).toBe('');
  });

  it('RED 行：徽标 + 路径/步骤 + key×次数（24h）', () => {
    expect(renderAssertionRedLine(state)).toBe(
      '🔴 RED 断言红灯：客户智能获客路径/Lead 表进人 videos_readback×3, line_key_not_null×1（24h）',
    );
  });

  it('AMBER 行用 🟡 AMBER 徽标', () => {
    expect(renderAssertionRedLine({ ...state, level: 'AMBER' })).toMatch(/^🟡 AMBER 断言红灯：/);
  });

  it('行最多列 3 个路径/步骤组，超出加省略号，组间用；分隔', () => {
    const groups = ['a', 'b', 'c', 'd'].map((s) => ({ journey: 'J', step: s, probe_key: 'k', fail_count: 1, severity: 'warn', last_at: null }));
    const line = renderAssertionRedLine({ level: 'AMBER', total: 4, window_hours: 24, groups });
    expect(line).toContain('J/a k×1；J/b k×1；J/c k×1 …');
    expect(line).not.toContain('J/d');
  });

  it('日报板块：标题 + 汇总行 + 每组一行带严重级', () => {
    const section = renderAssertionRedSection(state);
    expect(section.split('\n')).toEqual([
      '== 业务断言红灯（24h）==',
      '🔴 RED 共 4 次 FAIL（含 error 级）',
      '  - 🔴 客户智能获客路径 / Lead 表进人 · videos_readback ×3（error）',
      '  - 🟡 客户智能获客路径 / Lead 表进人 · line_key_not_null ×1（warn）',
    ]);
    expect(renderAssertionRedSection({ ...state, level: 'AMBER' })).toContain('🟡 AMBER 共 4 次 FAIL（仅 warn 级）');
  });
});
