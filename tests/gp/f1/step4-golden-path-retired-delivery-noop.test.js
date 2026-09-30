// F1「工厂 · 开发闭环」步骤 4「交付有回执」—— 边：harness_initiative merged 终态触发的
// 回执/冻结流程 × golden_path 旧表退役闸（任务 7d312fd8，决策 3e867cad / f425e3fd）
//
// promoteRegressionOnHarnessMerged 在 kernel/harness 到达 merged 终态时以 dbOnly:true
// 调 promoteToRegression 做「交付回执」；fetchLineContext 在 proposer/generator/evaluator
// 注入 line context 时读「已验收行为」。golden_path 表已被 steps/journey_step_links/
// step_probes 取代（09-26 验证层六棒链），两条边都必须默认不再读写它，否则退役闸形同虚设。
//
// 真 import 被改模块 harness-promote-regression.js 与 harness-line-context.js（守卫在边上，均不 mock）。
import { describe, it, expect } from 'vitest';
import { promoteToRegression } from '../../../packages/brain/src/harness-promote-regression.js';
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

describe('F1 step4 交付有回执：golden_path 旧表退役后，回执/line-context 停读停写', () => {
  it('promoteToRegression dbOnly=true（merged 终态回执调用形态）不碰任何连接，直接返回 golden_path_retired', async () => {
    const out = await promoteToRegression({}, {
      task: { id: 'aaaaaaaa-0000-4000-8000-000000000001' },
      sprintDir: 'sprints/irrelevant-for-dbonly',
      worktreePath: '/irrelevant-for-dbonly',
      dbOnly: true,
    });
    expect(out).toMatchObject({ ok: true, dbWritten: false, skipped: true, reason: 'golden_path_retired' });
  });

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
