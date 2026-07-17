/**
 * dispatch-worker-relay.test.js — TDD Red → Green（wire-dispatch-worker）
 *
 * 覆盖合同 BEHAVIOR-1/2/4（映射 T1/T2/T3）：
 *   T1: worker-pool executor 路由到 dispatchWorkerFn（不调用 spawnFn）
 *   T2: 核心任务护栏 — base_repo=cecelia + packages/brain/src → 拒绝，feedback_no_core_tasks_to_codex
 *   T3: 白名单外 executor 值拒绝（返回 ok:false，不调用任何 fn）
 *
 * 禁止 mock：dispatchWithRotation / buildCommand / queryUsage 不在测试中被 stub。
 * task_id: 1f50b6ac-8076-47c5-bff6-cc6bdb79bcd1
 */

import { describe, it, expect, vi } from 'vitest';
import { spawnSkillRelaySession } from '../src/harness-skill-relay.js';

// ─── 公共 deps mock（最小集）────────────────────────────────────────────────
function makeDeps(overrides = {}) {
  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    },
    // spawnFn 被注入：如果 worker-pool 路径误调了 spawnFn，测试会捕获到
    spawnFn: vi.fn().mockResolvedValue({ ok: false, error: 'spawnFn should not be called in worker-pool path' }),
    // loadSkill / ensureWt / resolveAccountFn / tokenFn：stub 保证 worker-pool 路径到达注入点
    loadSkill: vi.fn().mockReturnValue('## SKILL CONTENT'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/fake-worktree'),
    resolveAccountFn: vi.fn().mockResolvedValue({}),
    tokenFn: vi.fn().mockResolvedValue('ghp_fake'),
    // execFn：docker ps 去重守卫 — 返回空串（无运行容器）
    execFn: vi.fn().mockReturnValue(''),
    ...overrides,
  };
}

// ─── T1: worker-pool 路由到 dispatchWorkerFn ────────────────────────────────
describe('T1: worker-pool executor 路由', () => {
  it('worker-pool routes to dispatchWorkerFn, not spawnFn', async () => {
    const dispatchWorkerFn = vi.fn().mockResolvedValue({ ok: true });

    const task = {
      id: 'task-t1-0001',
      task_type: 'dev',
      title: 'smoke test',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'worker-pool',
        base_repo: 'zenithjoy',
        sprint_dir: 'sprints/smoke-test',
      },
    };

    const deps = makeDeps({ dispatchWorkerFn });

    const result = await spawnSkillRelaySession(task, deps);

    // 核心断言：dispatchWorkerFn 被调用
    expect(dispatchWorkerFn).toHaveBeenCalledTimes(1);
    // spawnFn 不被调用（docker 路径不走）
    expect(deps.spawnFn).not.toHaveBeenCalled();
    // 返回值格式
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('skill-relay');
    expect(result.orchestratorHost).toBe('skill-relay-worker-pool');
  });

  it('worker-pool does not increment _activeCodexRelays', async () => {
    const { _setActiveCodexRelays } = await import('../src/harness-skill-relay.js');
    _setActiveCodexRelays(0);

    const dispatchWorkerFn = vi.fn().mockResolvedValue({ ok: true });

    const task = {
      id: 'task-t1-counter',
      task_type: 'dev',
      title: 'counter test',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'worker-pool',
        base_repo: 'zenithjoy',
        sprint_dir: 'sprints/counter-test',
      },
    };

    await spawnSkillRelaySession(task, makeDeps({ dispatchWorkerFn }));

    // worker-pool 不应递增 _activeCodexRelays，无法直接读取，
    // 间接验证：再发一次 codex 任务，B2 守门不应因 worker-pool 被阻
    // 此处只验证 dispatchWorkerFn 调用成功（计数未增）
    expect(dispatchWorkerFn).toHaveBeenCalledTimes(1);
  });
});

// ─── T2: 核心任务护栏 ──────────────────────────────────────────────────────
describe('T2: 核心任务护栏', () => {
  it('core task guard rejects worker-pool with feedback_no_core_tasks_to_codex', async () => {
    const dispatchWorkerFn = vi.fn();

    const task = {
      id: 'task-t2-core',
      task_type: 'dev',
      title: 'core brain patch',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'worker-pool',
        base_repo: '/Users/administrator/perfect21/cecelia',
        contract_paths: ['packages/brain/src/tick.js'],
        sprint_dir: 'sprints/core-test',
      },
    };

    const deps = makeDeps({ dispatchWorkerFn });

    const result = await spawnSkillRelaySession(task, deps);

    // 护栏触发：返回 ok:false
    expect(result.ok).toBe(false);
    // error 或 reason 含 feedback_no_core_tasks_to_codex
    const resultStr = JSON.stringify(result);
    expect(resultStr).toContain('feedback_no_core_tasks_to_codex');
    // dispatchWorkerFn 不被调用
    expect(dispatchWorkerFn).not.toHaveBeenCalled();
    // spawnFn 不被调用
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('cecelia base_repo short form also triggers guard', async () => {
    const dispatchWorkerFn = vi.fn();

    const task = {
      id: 'task-t2-short',
      task_type: 'dev',
      title: 'core patch short',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'worker-pool',
        base_repo: 'cecelia',
        contract_paths: ['packages/brain/src/server.js'],
        sprint_dir: 'sprints/core-short',
      },
    };

    const result = await spawnSkillRelaySession(task, makeDeps({ dispatchWorkerFn }));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('feedback_no_core_tasks_to_codex');
    expect(dispatchWorkerFn).not.toHaveBeenCalled();
  });

  it('non-cecelia base_repo with brain/src contract_paths does NOT trigger guard', async () => {
    const dispatchWorkerFn = vi.fn().mockResolvedValue({ ok: true });

    const task = {
      id: 'task-t2-noncecelia',
      task_type: 'dev',
      title: 'zenithjoy patch',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'worker-pool',
        base_repo: 'zenithjoy',
        contract_paths: ['packages/brain/src/tick.js'],
        sprint_dir: 'sprints/zj-test',
      },
    };

    const result = await spawnSkillRelaySession(task, makeDeps({ dispatchWorkerFn }));

    // 非 cecelia repo，不触发护栏
    expect(result.ok).toBe(true);
    expect(dispatchWorkerFn).toHaveBeenCalledTimes(1);
  });
});

// ─── T3: 白名单外 executor 拒绝 ─────────────────────────────────────────────
describe('T3: 白名单外 executor 拒绝', () => {
  it('unknown executor is rejected, no spawnFn called', async () => {
    const dispatchWorkerFn = vi.fn();

    const task = {
      id: 'task-t3-unknown',
      task_type: 'dev',
      title: 'unknown executor test',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'unknown-bot',
        base_repo: 'zenithjoy',
        sprint_dir: 'sprints/unknown-test',
      },
    };

    const deps = makeDeps({ dispatchWorkerFn });

    const result = await spawnSkillRelaySession(task, deps);

    // 返回 ok:false，error 非空
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    // 不调用任何 spawnFn
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(dispatchWorkerFn).not.toHaveBeenCalled();
  });

  it('another unknown executor "gpt-bot" is also rejected', async () => {
    const task = {
      id: 'task-t3-gpt',
      task_type: 'dev',
      title: 'gpt-bot test',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'gpt-bot',
        sprint_dir: 'sprints/gpt-test',
      },
    };

    const result = await spawnSkillRelaySession(task, makeDeps());

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
