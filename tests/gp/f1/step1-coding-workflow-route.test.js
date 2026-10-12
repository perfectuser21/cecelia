// F1「工厂 · 开发闭环」步骤 1 —— 接单进车间即分档。
//
// 车道 A2（任务 eb9094ee）：无头编码单改投 coding_workflow runner，分档口子在 work-router。
// 本 PR 同时改了流水线模块 orchestrator/planner-recovery-consumption-store.js：kernel 自身的续跑单
// （planner recovery 后继，要绑定 kernel run 收据）带 kernel_continuation 留在 harness_initiative，
// 不被误投 runner。本文件是 lint-gp-anchor-artifact 要求的步骤断言：真 import 被改的流水线模块
// （不 mock），用它真实组出的建单请求过真 routeWork，钉住两条分档：
//   ① 续跑单 → harness_initiative（kernel 形态）
//   ② 同一请求去掉 kernel_continuation（普通无头编码单）→ coding_workflow（runner 认领）

import { describe, it, expect } from 'vitest';
import { consumePlannerRecoveryReceipt } from '../../../packages/brain/src/orchestrator/planner-recovery-consumption-store.js';
import { routeWork } from '../../../packages/brain/src/work-router.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const FACTS = [{ repo: 'cecelia', scope_key: 'cecelia', aliases: ['perfectuser21/cecelia'] }];

// 最小假库：只回 planner recovery 消费链路上的锁行与收据行（不 mock 被改模块本身）
function fakePool() {
  const client = {
    release() {},
    async query(sql) {
      const text = String(sql);
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

describe('GP F1 step1 — 编码单分档：无头改投 runner，kernel 续跑单留在 kernel 形态', () => {
  it('planner recovery 真实组出的后继请求带 kernel_continuation，经 routeWork 落 harness_initiative', async () => {
    let captured = null;
    await consumePlannerRecoveryReceipt(fakePool(), { predecessorRunId: RUN_ID, idempotencyKey: 'k' }, {
      createRoutedTaskFn: async (_client, request) => { captured = request; return { task_id: 'succ-1', routing_receipt_id: 'route-1' }; },
    });
    expect(captured?.kernel_continuation).toBe(true);
    expect(routeWork(captured, FACTS)).toMatchObject({ canonical_task_type: 'harness_initiative', pipeline: 'harness' });
  });

  it('同一请求去掉 kernel_continuation（普通无头编码单）→ coding_workflow，交 runner', async () => {
    let captured = null;
    await consumePlannerRecoveryReceipt(fakePool(), { predecessorRunId: RUN_ID, idempotencyKey: 'k' }, {
      createRoutedTaskFn: async (_client, request) => { captured = request; return { task_id: 'succ-1', routing_receipt_id: 'route-1' }; },
    });
    const { kernel_continuation: _drop, ...headless } = captured;
    expect(routeWork(headless, FACTS)).toMatchObject({ canonical_task_type: 'coding_workflow', orchestrator: 'coding-workflow-runner' });
  });
});
