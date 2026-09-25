/**
 * rescan-staleness-report.js — rescan 停滞哨兵的晨报一行 / 日报板块渲染。
 * 数据来源 cron/rescan-staleness-patrol.js 的核心停滞判定测试见
 * ../../cron/__tests__/rescan-staleness-patrol.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  readRescanStalenessState,
  renderRescanStalenessLine,
  renderRescanStalenessSection,
  STALE_DETECTION_STOPPED_MS,
} from '../rescan-staleness-report.js';

const NOW = new Date('2026-09-25T12:00:00Z').getTime();

describe('rescan-staleness-report — 晨报一行 / 日报板块渲染', () => {
  it('无数据（job 从未跑）→ 不出行', () => {
    expect(renderRescanStalenessLine(null)).toBeNull();
    expect(renderRescanStalenessSection(null)).toBe('');
  });

  it('不停滞 → 晨报无行，日报出勾', () => {
    const state = { checked_at: new Date(NOW).toISOString(), repo: 'cecelia', stale: false, age_minutes: 1, oldest_kind: 'api', missing_kinds: [] };
    expect(renderRescanStalenessLine(state, NOW)).toBeNull();
    expect(renderRescanStalenessSection(state, NOW)).toContain('✓');
  });

  it('停滞（账龄超预算）→ 🟡 AMBER 行含分钟数', () => {
    const state = { checked_at: new Date(NOW).toISOString(), repo: 'cecelia', stale: true, age_minutes: 45, oldest_kind: 'graph', missing_kinds: [] };
    const line = renderRescanStalenessLine(state, NOW);
    expect(line).toContain('🟡 AMBER');
    expect(line).toContain('45 分钟');
    expect(renderRescanStalenessSection(state, NOW)).toContain('🟡 AMBER');
  });

  it('停滞（缺失类型）→ 🟡 AMBER 行点名缺失类型', () => {
    const state = { checked_at: new Date(NOW).toISOString(), repo: 'cecelia', stale: true, age_minutes: null, oldest_kind: null, missing_kinds: ['test'] };
    const line = renderRescanStalenessLine(state, NOW);
    expect(line).toContain('缺失快照类型 test');
  });

  it('检测本身过期（job 停了）→ 🟡 AMBER 过期提示，优先于 stale 内容', () => {
    const staleCheckedAt = new Date(NOW - STALE_DETECTION_STOPPED_MS - 60_000).toISOString();
    const state = { checked_at: staleCheckedAt, repo: 'cecelia', stale: false, age_minutes: 1, oldest_kind: 'api', missing_kinds: [] };
    const line = renderRescanStalenessLine(state, NOW);
    expect(line).toContain('检测已过期');
  });

  it('readRescanStalenessState：形状不符（别的 key 混进来）→ 返回 null 不误报', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ value_json: { unrelated: true } }] }) };
    await expect(readRescanStalenessState(pool)).resolves.toBeNull();
  });

  it('readRescanStalenessState：查询失败 → best-effort 返回 null', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(readRescanStalenessState(pool)).resolves.toBeNull();
  });
});
