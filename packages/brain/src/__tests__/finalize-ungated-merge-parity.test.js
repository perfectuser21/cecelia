/**
 * 「PR 已合并但没有 evaluator」——两条路径必须同一套策略。
 *
 * 这个场景系统里早有答案，写在 `_finalizeMergedRun` 的注释原文里：
 *   「门禁通过 → 原行为；门禁未通过 → **仍标 done/completed**（PR 客观已合并
 *    无法撤销）但打 failure_reason，跳过 regression 提升，并发未验收合并告警」
 *
 * 即：放行 + 留疤 + 告警 + 不自动提升。惩罚落在"不提升"上，而不是把账本锁死。
 *
 * 而 `finalizeHarnessTask`（PATCH /tasks/:id 这条路）却是**硬挡**：
 * 返回 no_evaluator_gate，任务永远停在 blocked。同一场景、两条路径、相反策略。
 *
 * 2026-09-21~22 实证：三条任务（a70d7743 / 3dc7792a / 7e7d4db5）活干完、
 * PR 已合并、CI 全绿，就卡在这里。而它们的流水线**一步都没跑起来**
 * （tick 领走后派发撞 map_stale 失败），所以"evaluator 从未 done"是必然的，
 * 不是偷懒——按"跑过但验收员偷懒"来判本身就判错了对象。
 *
 * 本守卫钉住：PATCH 这条路必须照抄 watchdog 已定的策略，不许各发明一套。
 */
import { describe, it, expect, vi } from 'vitest';
import { finalizeHarnessTask } from '../lib/harness-finalize.js';

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PR = 'https://github.com/perfectuser21/cecelia/pull/5457';
const baseTask = {
  id: TASK_ID, status: 'blocked', task_type: 'harness_initiative',
  pr_url: null, payload: { orchestrator: 'skill-relay' },
};

function poolWith(task) {
  const queries = [];
  return {
    queries,
    query: vi.fn(async (sql, params) => {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/FROM tasks WHERE id/.test(sql)) return { rows: [task] };
      return { rows: [], rowCount: 1 };
    }),
  };
}
const ghMerged = async () => JSON.stringify({ state: 'MERGED' });

describe('PR 已合并但无 evaluator：PATCH 路径必须照 watchdog 的策略', () => {
  it('放行——PR 客观已合并，拦着任务只会让账本和现实分叉', async () => {
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn: ghMerged, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => false,
      raiseUngatedMergeAlertFn: async () => {},
    });
    expect(r.applies).toBe(true);
    expect(r.allow, `仍被挡，reason=${r.reason}`).toBe(true);
  });

  it('留疤——必须标 merged_without_evaluator_gate，不许悄悄放过', async () => {
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn: ghMerged, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => false,
      raiseUngatedMergeAlertFn: async () => {},
    });
    expect(r.ungated, '没标未验收合并的疤').toBe(true);
    expect(r.failureReason).toBe('merged_without_evaluator_gate');
  });

  it('告警——必须开 P1 issue，复用 watchdog 那条，不另发明', async () => {
    const alert = vi.fn(async () => {});
    await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn: ghMerged, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => false,
      raiseUngatedMergeAlertFn: alert,
    });
    expect(alert, '未验收合并没告警——这是本策略里唯一让人看见的环节').toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][2]).toBe(PR);
  });

  it('有 evaluator 时一切照旧：不留疤、不告警', async () => {
    const alert = vi.fn(async () => {});
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn: ghMerged, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => true,
      raiseUngatedMergeAlertFn: alert,
    });
    expect(r.allow).toBe(true);
    expect(r.ungated ?? false).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('PR 没合并仍然挡——放宽的只有 evaluator 这一条，不是把闸拆了', async () => {
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask),
      ghFn: async () => JSON.stringify({ state: 'OPEN' }),
      requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => false,
      raiseUngatedMergeAlertFn: async () => {},
    });
    expect(r.allow, 'PR 没合并却放行了——闸被拆过头').toBe(false);
    expect(r.reason).toMatch(/pr_not_merged/);
  });

  it('查不到 PR 仍然挡', async () => {
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn: ghMerged,
      requestedPrUrl: null,
      hasEvaluatorGateFn: async () => false,
      raiseUngatedMergeAlertFn: async () => {},
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/pr_not_found/);
  });
});
