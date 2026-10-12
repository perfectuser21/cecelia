// A5（决策 b4adf807 先删后补）：kernel-v1 运行时退役后，存量 payload.harness_runtime='kernel-v1'
// 的单不得再起任何执行——relay 咽喉直接拒（不建 run、不碰 worktree、不本机/远程起 kernel），
// watchdog 不再恢复 / 重启 / requeue kernel run。golden_path_proposal 等非 kernel 的 relay 路径不受影响。
import { describe, it, expect, vi } from 'vitest';

vi.mock('../runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
  execFile: vi.fn((...args) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '', '');
  }),
  spawn: vi.fn(),
}));

import * as relay from '../harness-skill-relay.js';
import * as watchdog from '../harness-relay-watchdog.js';

const TASK_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff0000a5a5';
const RUN_ID = '11111111-1111-4111-8111-11111111a5a5';

function relayDeps(env = {}) {
  return {
    env,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    createKernelRun: vi.fn(async () => ({
      created: true,
      run: { id: RUN_ID, controller_session_id: 'cccccccc-dddd-4eee-8fff-00001111a5a5', controller_generation: 1 },
    })),
    launchKernel: vi.fn(async () => ({ pid: 4242 })),
    ensureWt: vi.fn(async () => '/tmp/wt'),
    spawnFn: vi.fn(),
    orchestratorBridge: { targetMachineId: 'm', prepare: vi.fn(), start: vi.fn() },
  };
}

const kernelTask = (extra = {}) => ({
  id: TASK_ID,
  task_type: 'harness_initiative',
  title: 'kernel-v1 存量单',
  payload: { orchestrator: 'skill-relay', harness_runtime: 'kernel-v1', sprint_dir: 'sprints/a5', ...extra },
});

describe('A5 kernel-v1 运行时退役 — relay 咽喉', () => {
  it.each([
    ['本机模式', {}],
    ['零执行闸开（原远程桥路径）', { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' }],
  ])('%s：kernel-v1 无头单直接拒 kernel_runtime_retired，不建 run、不起 kernel', async (_label, env) => {
    const d = relayDeps(env);
    const r = await relay.spawnSkillRelaySession(kernelTask(), d);
    expect(r).toMatchObject({ ok: false, error: 'kernel_runtime_retired' });
    expect(d.createKernelRun).not.toHaveBeenCalled();
    expect(d.launchKernel).not.toHaveBeenCalled();
    expect(d.ensureWt).not.toHaveBeenCalled();
    expect(d.orchestratorBridge.prepare).not.toHaveBeenCalled();
    expect(d.spawnFn).not.toHaveBeenCalled();
  });

  it('有头 kernel（mode=headed + kernel-v1）同样直接拒', async () => {
    const d = relayDeps({});
    const r = await relay.spawnSkillRelaySession(kernelTask({ mode: 'headed' }), d);
    expect(r).toMatchObject({ ok: false, error: 'kernel_runtime_retired' });
    expect(d.createKernelRun).not.toHaveBeenCalled();
    expect(d.ensureWt).not.toHaveBeenCalled();
  });

  it('kernel 启动原语已从 relay 模块删除', () => {
    expect(relay.launchKernelProcess).toBeUndefined();
    expect(relay.buildKernelLaunchArgs).toBeUndefined();
    expect(relay.isTransientRemoteLaunchError).toBeUndefined();
  });

  it('非 kernel 的 relay 路径（golden_path_proposal）不被新拒绝码误伤', async () => {
    const d = relayDeps({ CECELIA_LOCAL_EXECUTION_ENABLED: 'false' });
    const r = await relay.spawnSkillRelaySession({
      id: TASK_ID, task_type: 'golden_path_proposal', title: 'GP', payload: { orchestrator: 'skill-relay' },
    }, d);
    expect(r.error).toBe('local_execution_disabled_on_scheduler');
  });
});

describe('A5 kernel-v1 运行时退役 — relay watchdog', () => {
  function watchdogDeps({ phase = 'planning', host = 'kernel-v1' } = {}) {
    const pool = { query: vi.fn() };
    pool.query.mockImplementation(async (sql) => {
      if (/FROM initiative_runs r(?:\s|$)/.test(sql)) {
        return {
          rows: [{
            id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase, attempts: '1',
            deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null,
            orchestrator_host: host, orchestrator_heartbeat_at: null,
            started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
            controller_session_id: '33333333-3333-4333-8333-33333333a5a5', controller_generation: '1',
            context_resume: phase === 'paused' ? { answered: true } : null,
          }],
        };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', payload: { orchestrator: 'skill-relay', harness_runtime: 'kernel-v1' } }] };
      }
      return { rows: [] };
    });
    return {
      pool,
      execFn: vi.fn(() => ''),
      spawnFn: vi.fn(),
      resumeAttempt: vi.fn(),
      launchKernel: vi.fn(async () => ({ pid: 4242 })),
      requeueKernelRunDeferred: vi.fn(async () => ({ changed: true, deferCount: 1 })),
      writeControllerHeartbeat: vi.fn(),
    };
  }

  it.each([
    ['本机模式', {}],
    ['零执行闸开', { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' }],
  ])('%s：in_progress 的 kernel-v1 run 不恢复、不重启、不 requeue', async (_label, env) => {
    const deps = { ...watchdogDeps(), env };
    const out = await watchdog.resumeStalledRelayRuns(deps);
    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.requeueKernelRunDeferred).not.toHaveBeenCalled();
    expect(deps.resumeAttempt).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(out.resumed).toBe(0);
  });

  it('paused 的 kernel-v1 run（needs_context 已答）不再起 context 子 Controller', async () => {
    const deps = watchdogDeps({ phase: 'paused' });
    await watchdog.resumeStalledRelayRuns(deps);
    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
  });

  it('有头 kernel run 不再续写 Controller 心跳', async () => {
    const deps = watchdogDeps({ host: 'skill-relay-codex-headed' });
    await watchdog.resumeStalledRelayRuns(deps);
    expect(deps.writeControllerHeartbeat).not.toHaveBeenCalled();
    expect(deps.launchKernel).not.toHaveBeenCalled();
  });

  it('kernel 恢复原语已从 watchdog 模块删除', () => {
    expect(watchdog.reconcileExpiredKernelAttempt).toBeUndefined();
    expect(watchdog.resumeKernelAttempt).toBeUndefined();
    expect(watchdog._resumePausedKernelContext).toBeUndefined();
  });
});
