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

describe('GP F1 step1：用户开发的现役Agent与有头会话准入', () => {
  it('普通无头编码分类为codex_dev，并解析到实际Codex桥执行者', () => {
    const decision = routeWork(request, FACTS);
    expect(decision).toMatchObject({
      canonical_task_type: 'codex_dev', pipeline: 'agent_development',
      orchestrator: 'codex-bridge', default_execution_profile: 'hotfix-v1', repo: 'cecelia', map_scope: ['F1'],
    });
    const task = { task_type: decision.canonical_task_type, status: 'queued', payload: {} };
    expect(resolveDispatchRoute(task)).toMatchObject({ available: true, route: 'codex-bridge', executor: 'bridge' });
    expect(() => assertTaskTypeHasExecutor(task)).not.toThrow();
  });

  it('有头会话显式记账为dev，由人工执行面接手', () => {
    const payload = { headed_manual: 'true', mode: 'headed' };
    const decision = routeWork({ ...request, task: { payload } }, FACTS);
    expect(decision).toMatchObject({ canonical_task_type: 'dev', pipeline: 'headed_development', orchestrator: 'headed-session' });
    const task = { task_type: decision.canonical_task_type, status: 'queued', payload };
    expect(resolveDispatchRoute(task)).toMatchObject({ available: true, route: 'headed', executor: 'human' });
    expect(() => assertTaskTypeHasExecutor(task)).not.toThrow();
  });

  it('中间分类成功不能让退役Claude执行者进入队列', () => {
    const decision = routeWork(request, FACTS);
    const task = { task_type: decision.canonical_task_type, status: 'queued', payload: { executor: 'claude' } };
    expect(resolveDispatchRoute(task)).toMatchObject({ available: false, route: 'claude-retired', executor: null });
    expect(() => assertTaskTypeHasExecutor(task)).toThrow('no_executor_for_task_type');
  });
});
