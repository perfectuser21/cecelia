// F1「工厂 · 开发闭环」步骤 1 —— 接单进车间即分档。
//
// 车道 A4（任务 3e82f891）：harness_initiative 只当有头账本类型，建单入口拒无头 harness_initiative
// （dispatch-route assertTaskTypeHasExecutor 去掉 retired-harness-kernel 放行）。本 PR 同时改了流水线模块
// orchestrator/planner-recovery-consumption-store.js：kernel 续跑后继（无头 queued harness_initiative）被建单闸
// 拒时回 410 planner_recovery_kernel_retired 并回滚。本文件是 lint-gp-anchor-artifact 要求的步骤断言：
// 真 import 被改模块（不 mock），后继请求过真 routeWork + 真建单闸：
//   ① 无头续跑后继 → 410 planner_recovery_kernel_retired，不提交
//   ② 同一后继带 headed_manual 字符串 'true'（有头账本行）→ 建单闸放行，消费照常提交

import { describe, it, expect } from 'vitest';
import { consumePlannerRecoveryReceipt } from '../../../packages/brain/src/orchestrator/planner-recovery-consumption-store.js';
import { routeWork } from '../../../packages/brain/src/work-router.js';
import { assertTaskTypeHasExecutor } from '../../../packages/brain/src/lib/dispatch-route.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const FACTS = [{ repo: 'cecelia', scope_key: 'cecelia', aliases: ['perfectuser21/cecelia'] }];

// 最小假库：只回 planner recovery 消费链路上的锁行与收据行（不 mock 被改模块本身）
function fakePool(calls = []) {
  const client = {
    release() {},
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (/SELECT current_task_id[\s\S]*FROM initiative_runs/.test(text)) return { rows: [{ current_task_id: TASK_ID }] };
      if (/FROM tasks[\s\S]*FOR UPDATE/.test(text)) return { rows: [{ id: TASK_ID, status: 'failed', okr_initiative_id: null }] };
      if (/FROM initiative_runs[\s\S]*FOR UPDATE/.test(text)) {
        return { rows: [{ id: RUN_ID, initiative_id: 'init-1', okr_initiative_id: null, current_task_id: TASK_ID, phase: 'failed', orchestrator_version: 'v2', record_trust_status: 'trusted' }] };
      }
      if (/FROM planner_recovery_receipts recovery[\s\S]*FOR UPDATE OF recovery/.test(text)) {
        return { rows: [{ id: RECEIPT_ID, predecessor_run_id: RUN_ID, source_task_id: TASK_ID, repo: 'perfectuser21/cecelia', head_sha: 'b'.repeat(40), verification_method: 'remote_exact_commit_blob', execution_profile_override: null, change_kind: 'bugfix', map_scope: ['F1'] }] };
      }
      if (/INSERT INTO planner_recovery_consumptions/.test(text)) {
        return { rows: [{ receipt_id: RECEIPT_ID, successor_task_id: 'succ-1', routing_receipt_id: 'route-1', idempotency_key: 'k' }] };
      }
      return { rows: [] };
    },
  };
  return { connect: async () => client };
}

// 建单链路的分档 + 建单闸两段（与 createRoutedTask 同口径：routeWork 定类型 → assertTaskTypeHasExecutor 拦无执行者）
async function routeAndGate(_client, request) {
  const decision = routeWork(request, FACTS);
  const payload = { ...(request.metadata || {}), ...(request.task?.payload || {}) };
  assertTaskTypeHasExecutor({ task_type: decision.canonical_task_type, status: request.task?.status ?? 'queued', payload });
  return { task_id: 'succ-1', routing_receipt_id: 'route-1' };
}

describe('GP F1 step1 — harness_initiative 只当有头账本类型：无头续跑后继建单即拒', () => {
  it('planner recovery 无头续跑后继 → 410 planner_recovery_kernel_retired，回滚不提交', async () => {
    const calls = [];
    const err = await consumePlannerRecoveryReceipt(fakePool(calls), { predecessorRunId: RUN_ID, idempotencyKey: 'k' }, {
      createRoutedTaskFn: routeAndGate,
    }).catch((e) => e);
    expect(err).toMatchObject({ code: 'planner_recovery_kernel_retired', httpStatus: 410 });
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('同一后继以有头账本行（headed_manual 字符串 true）入账 → 建单闸放行，消费提交', async () => {
    const calls = [];
    const headed = (client, request) => routeAndGate(client, { ...request, metadata: { ...request.metadata, headed_manual: 'true' } });
    const result = await consumePlannerRecoveryReceipt(fakePool(calls), { predecessorRunId: RUN_ID, idempotencyKey: 'k' }, {
      createRoutedTaskFn: headed,
    });
    expect(result.successor_task_id).toBe('succ-1');
    expect(calls).toContain('COMMIT');
  });
});
