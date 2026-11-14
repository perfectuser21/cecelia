// 现役Warroom上下文读取仍不得默认读已退役的golden_path旧表。
import { describe, it, expect } from 'vitest';
import { fetchLineContext } from '../../../packages/brain/src/harness-line-context.js';

function makeInertPool() {
  const queries = [];
  return {
    pool: {
      query: async (sql, params) => {
        queries.push({ sql: String(sql), params });
        return { rows: [] };
      },
    },
    queries,
  };
}

describe('F1 step4 上下文只读：golden_path 旧表退役后不再隐式读取', () => {
  it('fetchLineContext 三参齐全时不再 JOIN golden_path，cumulativeFR 恒为 []', async () => {
    const { pool, queries } = makeInertPool();
    const ctx = await fetchLineContext({ pool }, {
      taskId: 'bbbbbbbb-0000-4000-8000-000000000002',
      abilityId: 'cccccccc-0000-4000-8000-000000000003',
      journeyId: 'dddddddd-0000-4000-8000-000000000004',
    });

    expect(ctx.cumulativeFR).toEqual([]);
    expect(queries.length).toBe(3); // step 路跳过（legacyGoldenPath 默认关）；journey_feature / global+area / line ledger 三路
    for (const q of queries) {
      expect(q.sql).not.toMatch(/golden_path\b/);
    }
  });
});
