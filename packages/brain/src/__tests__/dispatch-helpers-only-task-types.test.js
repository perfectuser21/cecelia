/**
 * dispatch-helpers-only-task-types.test.js
 *
 * Brain 任务 6e63bedf：selectNextDispatchableTask 新增 options.onlyTaskTypes，
 * 供 dispatcher 在任务池总闸关着时只选 qiumi_task（秋米任务穿透 MMV，不占 fleet 槽位）。
 *
 * 语义：非空数组 → SQL 加 `AND t.task_type = ANY($n::text[])`，类型数组走参数占位符；
 *       null / 不传 / 空数组 → 不限定，SQL 与改动前完全一致。
 * 注意现有 SQL 里已有排除子句 `NOT (t.task_type = ANY(...))`，断言必须能区分二者。
 *
 * 变异清单：
 *   忽略 onlyTaskTypes（不加 SQL 子句）           → 用例 1 红
 *   把类型数组直接拼进 SQL 文本而非参数            → 用例 1 红（参数里没有数组）
 *   空数组也加限定（会把所有任务过滤光）            → 用例 3 红
 *   不传时也加限定                                → 用例 2 红
 *   限定子句占位符序号错位（打乱 excludeIds 序号）  → 用例 4 红
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));
vi.mock('../alertness-actions.js', () => ({ getMitigationState: () => ({ p2_paused: false }) }));

import { selectNextDispatchableTask } from '../dispatch-helpers.js';

const ONLY_CLAUSE = /AND\s+t\.task_type\s*=\s*ANY/;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('selectNextDispatchableTask：options.onlyTaskTypes', () => {
  it('1. 传 [qiumi_task] → SQL 加 task_type = ANY($n::text[]) 限定，类型数组走参数', async () => {
    await selectNextDispatchableTask(null, [], { onlyTaskTypes: ['qiumi_task'] });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/AND\s+t\.task_type\s*=\s*ANY\(\$\d+::text\[\]\)/);
    expect(params).toContainEqual(['qiumi_task']);
  });

  it('2. 不传 / null → SQL 不含限定子句（只有原有的 NOT (... = ANY) 排除）', async () => {
    await selectNextDispatchableTask(null, []);
    await selectNextDispatchableTask(null, [], { onlyTaskTypes: null });

    for (const [sql, params] of mockQuery.mock.calls) {
      expect(sql).not.toMatch(ONLY_CLAUSE);
      expect(params).not.toContainEqual(['qiumi_task']);
    }
  });

  it('3. 传空数组 → 同样不加限定（空数组 = 不限定，不能把候选过滤光）', async () => {
    await selectNextDispatchableTask(null, [], { onlyTaskTypes: [] });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(ONLY_CLAUSE);
  });

  it('4. 与 goalIds / excludeIds 并用 → 占位符序号各指各的参数，不错位', async () => {
    await selectNextDispatchableTask(['g1'], ['x1'], { onlyTaskTypes: ['qiumi_task'] });

    const [sql, params] = mockQuery.mock.calls[0];
    const idx = (re) => Number(sql.match(re)[1]);
    expect(params[idx(/t\.goal_id = ANY\(\$(\d+)\)/) - 1]).toEqual(['g1']);
    expect(params[idx(/t\.id != ALL\(\$(\d+)\)/) - 1]).toEqual(['x1']);
    expect(params[idx(/AND\s+t\.task_type\s*=\s*ANY\(\$(\d+)::text\[\]\)/) - 1]).toEqual(['qiumi_task']);
    // 原有排除子句仍指向 TICK_DISPATCH_EXCLUDED 那个数组，不是被新参数顶替
    const excludedIdx = idx(/NOT \(t\.task_type = ANY\(\$(\d+)::text\[\]\)\)/);
    expect(params[excludedIdx - 1]).not.toEqual(['qiumi_task']);
  });
});
