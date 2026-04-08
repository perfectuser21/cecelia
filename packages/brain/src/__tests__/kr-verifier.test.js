/**
 * KR Verifier — getKrVerifierHealth() 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module before importing kr-verifier
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db.js';
import { getKrVerifierHealth } from '../kr-verifier.js';

const NOW = new Date('2026-04-08T12:00:00Z');

function makeVerifierRow(overrides = {}) {
  return {
    id: 'v-001',
    kr_id: 'kr-001',
    verifier_type: 'sql',
    query: 'SELECT COUNT(*) as count FROM tasks WHERE status = \'completed\'',
    threshold: '4',
    current_value: '5',
    last_checked: new Date(NOW.getTime() - 1 * 60 * 60 * 1000), // 1h ago
    last_error: null,
    enabled: true,
    check_interval_minutes: 60,
    kr_title: 'KR1: 自媒体',
    kr_status: 'active',
    progress_pct: 100,
    ...overrides,
  };
}

describe('getKrVerifierHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('健康 verifier 返回 healthy + 空 issues', async () => {
    pool.query.mockResolvedValueOnce({ rows: [makeVerifierRow()] });

    const { verifiers, summary } = await getKrVerifierHealth();

    expect(verifiers).toHaveLength(1);
    expect(verifiers[0].health).toBe('healthy');
    expect(verifiers[0].issues).toEqual([]);
    expect(summary.healthy).toBe(1);
    expect(summary.warn).toBe(0);
    expect(summary.critical).toBe(0);
  });

  it('静态 SQL 被标记为 warn + static_sql', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({ query: 'SELECT 72::numeric as count' })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].health).toBe('warn');
    expect(verifiers[0].issues).toContain('static_sql');
    expect(verifiers[0].is_static_sql).toBe(true);
  });

  it('SELECT 0 也被视为静态 SQL', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({ query: 'SELECT 0 as count' })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].issues).toContain('static_sql');
  });

  it('last_checked 超过 3h 被标记为 stale', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({
        last_checked: new Date(NOW.getTime() - 4 * 60 * 60 * 1000), // 4h ago
      })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].issues).toContain('stale');
    expect(verifiers[0].health).toBe('warn');
  });

  it('last_checked 为 null 被标记为 stale', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({ last_checked: null })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].issues).toContain('stale');
    expect(verifiers[0].hours_since_check).toBeNull();
  });

  it('last_error 非空标记为 critical', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({ last_error: 'column "x" does not exist' })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].health).toBe('critical');
    expect(verifiers[0].issues).toContain('has_error');
  });

  it('critical 优先级高于 warn（同时有 static_sql 和 has_error）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({
        query: 'SELECT 72::numeric as count',
        last_error: 'some error',
      })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].health).toBe('critical');
    expect(verifiers[0].issues).toContain('static_sql');
    expect(verifiers[0].issues).toContain('has_error');
  });

  it('disabled verifier 标记为 warn + disabled', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [makeVerifierRow({ enabled: false })],
    });

    const { verifiers } = await getKrVerifierHealth();

    expect(verifiers[0].issues).toContain('disabled');
    expect(verifiers[0].health).toBe('warn');
  });

  it('summary 正确汇总多个 verifier', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        makeVerifierRow({ kr_id: 'kr-1', kr_title: 'KR1' }),
        makeVerifierRow({ kr_id: 'kr-2', kr_title: 'KR2', query: 'SELECT 72::numeric as count' }),
        makeVerifierRow({ kr_id: 'kr-3', kr_title: 'KR3', last_error: 'err' }),
      ],
    });

    const { summary } = await getKrVerifierHealth();

    expect(summary.healthy).toBe(1);
    expect(summary.warn).toBe(1);
    expect(summary.critical).toBe(1);
  });

  it('空 verifier 列表返回空数组 + 零 summary', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const { verifiers, summary } = await getKrVerifierHealth();

    expect(verifiers).toEqual([]);
    expect(summary.healthy).toBe(0);
    expect(summary.warn).toBe(0);
    expect(summary.critical).toBe(0);
  });
});
