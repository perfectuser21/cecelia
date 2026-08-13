/**
 * Brain v2 Phase D3 — codex-immune 单元测试。
 *
 * 覆盖 ensureCodexImmune 三条路径：
 *   1. 最近 < 20h → 返回 { skipped: true, reason: 'too_soon' }
 *   2. 从未触发 → 返回 { created: true, elapsed_ms: Infinity }，调 INSERT
 *   3. 距离上次 ≥ 20h → 返回 { created: true }，调 INSERT
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureCodexImmune } from '../codex-immune.js';

function makeMockPool({ rows = [] } = {}) {
  const queries = [];
  return {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      // 第 1 次 query 是 SELECT，第 2 次是 INSERT
      if (sql.includes('SELECT')) return { rows };
      return { rows: [] };
    }),
  };
}

describe('codex-immune.ensureCodexImmune', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skipped 路径：最近 1h 内已有 codex_qa 任务', async () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 小时前
    const pool = makeMockPool({ rows: [{ created_at: recent }] });

    const result = await ensureCodexImmune(pool);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_soon');
    expect(typeof result.elapsed_ms).toBe('number');
    expect(result.elapsed_ms).toBeLessThan(20 * 60 * 60 * 1000);
    // 没调 INSERT
    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0].sql).toMatch(/SELECT/);
  });

  it('created 路径：从未触发过（rows 为空）', async () => {
    const pool = makeMockPool({ rows: [] });
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'immune-task' } });

    const result = await ensureCodexImmune(pool, taskCreator);

    expect(result.created).toBe(true);
    expect(result.elapsed_ms).toBe(Infinity);
    expect(pool.queries).toHaveLength(1);
    expect(taskCreator).toHaveBeenCalledWith(expect.objectContaining({
      db: pool,
      title: expect.stringMatching(/Codex 免疫检查/),
      description: expect.stringMatching(/run-codex-immune\.sh/),
      task_type: 'codex_qa',
      priority: 'P1',
    }));
  });

  it('created 路径：距上次 > 20h', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 小时前
    const pool = makeMockPool({ rows: [{ created_at: old }] });
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'immune-task' } });

    const result = await ensureCodexImmune(pool, taskCreator);

    expect(result.created).toBe(true);
    expect(result.elapsed_ms).toBeGreaterThan(20 * 60 * 60 * 1000);
    expect(pool.queries).toHaveLength(1);
    expect(taskCreator).toHaveBeenCalledOnce();
  });

  it('SELECT 查询过滤 cancelled / canceled 状态', async () => {
    const pool = makeMockPool({ rows: [] });
    const taskCreator = vi.fn().mockResolvedValue({ task: { id: 'immune-task' } });
    await ensureCodexImmune(pool, taskCreator);

    expect(pool.queries[0].sql).toMatch(/codex_qa/);
    expect(pool.queries[0].sql).toMatch(/NOT IN.*cancelled.*canceled|cancelled.*canceled/);
  });
});
