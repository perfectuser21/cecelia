// GP F1 step1：验证真实路由分类和执行者准入，不把中间分类当成启动成功。
import { describe, it, expect } from 'vitest';
import { routeWork } from '../../../packages/brain/src/work-router.js';
import { assertTaskTypeHasExecutor, resolveDispatchRoute } from '../../../packages/brain/src/lib/dispatch-route.js';

const FACTS = [{ repo: 'cecelia', scope_key: 'cecelia', aliases: ['perfectuser21/cecelia'] }];
const request = {
  source: 'child', source_id: 'planner-recovery:historical-receipt',
  title: '恢复编码工作', mutation_intent: 'write',
  declared_change_kind: 'bugfix', repo_hint: 'perfectuser21/cecelia',
  map_scope_hint: ['F1'], branch: 'cp-route-assurance', base_sha: 'b'.repeat(40),
};

describe('GP F1 step1：普通无头编码走Runner，历史Kernel续跑无执行者', () => {
  it('普通无头编码实际分类为coding_workflow，并通过现役执行者准入', () => {
    const decision = routeWork(request, FACTS);
    expect(decision).toMatchObject({
      canonical_task_type: 'coding_workflow', pipeline: 'coding_workflow',
      orchestrator: 'coding-workflow-runner', repo: 'cecelia', map_scope: ['F1'],
    });
    const task = { task_type: decision.canonical_task_type, status: 'queued', payload: {} };
    expect(resolveDispatchRoute(task)).toMatchObject({ available: true, route: 'own-consumer' });
    expect(() => assertTaskTypeHasExecutor(task)).not.toThrow();
  });

  it('kernel_continuation只保留历史分类，真实执行者闸拒绝无头续跑', () => {
    const decision = routeWork({ ...request, kernel_continuation: true }, FACTS);
    expect(decision).toMatchObject({ canonical_task_type: 'harness_initiative', pipeline: 'harness' });
    const task = { task_type: decision.canonical_task_type, status: 'queued', payload: {} };
    expect(resolveDispatchRoute(task)).toMatchObject({ available: false, route: 'retired-harness-kernel' });
    expect(() => assertTaskTypeHasExecutor(task)).toThrow(expect.objectContaining({
      code: 'no_executor_for_task_type', task_type: 'harness_initiative', route: 'retired-harness-kernel',
    }));
  });
});
