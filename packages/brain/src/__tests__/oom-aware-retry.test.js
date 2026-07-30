/**
 * 刀A7 OOM 感知重试 — 合同测试
 * task_id: 610ecc9e-ff5b-4cee-9fac-c0c69e4af925
 *
 * GP1/GP2 在改动前必须 FAIL，这是 TDD 前置条件。
 * GP3 在改动前应通过（正常路径守护）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock 基础设施（与 harness-relay-watchdog.test.js 保持一致模式）──────────
const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } from '../harness-relay-watchdog.js';

const TASK_ID = 'aabbccdd-0000-1111-2222-333344445555';
const SHORT = 'aabbccdd';

// ─── 共用 deps 工厂 ────────────────────────────────────────────────────────
function makeDeps({
  attempts = 1,
  containerRunning = false,
  lastExitCode = undefined,  // task.payload.last_container_exit_code
  oomUpgraded = false,       // task.payload.oom_upgraded
  taskStatus = 'in_progress',
} = {}) {
  const pool = { query: vi.fn() };

  pool.query.mockImplementation(async (sql) => {
    // initiative_runs 查询
    if (/FROM initiative_runs r/.test(sql)) {
      return {
        rows: [{
          id: '10000000-0000-4000-8000-000000000001',
          initiative_id: TASK_ID,
          current_task_id: TASK_ID,
          phase: 'A_planning',
          attempts: String(attempts),
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: null,
          orchestrator_host: 'skill-relay-session',
        }],
      };
    }
    // tasks 查询
    if (/FROM tasks/.test(sql)) {
      return {
        rows: [{
          id: TASK_ID,
          status: taskStatus,
          title: 'OOM-test-task',
          payload: {
            orchestrator: 'skill-relay',
            ...(lastExitCode !== undefined ? { last_container_exit_code: lastExitCode } : {}),
            ...(oomUpgraded ? { oom_upgraded: true } : {}),
          },
        }],
      };
    }
    // initiative_run_events（evaluator gate）
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: [{ x: 1 }] }; // evaluator done
    }
    return { rows: [] };
  });

  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return containerRunning ? `${SHORT}abc\n` : '';
    if (/gh pr view/.test(cmd)) return JSON.stringify({ state: 'CLOSED' });
    if (/gh pr checks/.test(cmd)) return JSON.stringify([]);
    if (/gh pr list/.test(cmd)) return JSON.stringify([]);
    return '';
  });

  return {
    pool,
    execFn,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: `cecelia-relay-${SHORT}` }),
  };
}

beforeEach(() => {
  mockPool.query.mockReset();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// GP1：exit=137 首次 → 升档重点火（FAILING TEST — impl 前必须红）
// ─────────────────────────────────────────────────────────────────────────────
describe('GP1：exit=137 首次触发升档重点火', () => {
  it('spawnFn 收到 oom_upgrade 标记，日志含 resume_oom_upgraded', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({ lastExitCode: 137, oomUpgraded: false, containerRunning: false, attempts: 1 });

    const r = await resumeStalledRelayRuns(deps);

    // [BEHAVIOR-1] spawnFn 必须被调用
    expect(deps.spawnFn).toHaveBeenCalledOnce();

    // [BEHAVIOR-1] 调用参数含升档标记（opts.memoryTier='oom_upgrade' 或等效 env）
    const callArgs = deps.spawnFn.mock.calls[0];
    // callArgs[1] 应为 opts 对象，含 memoryTier 或 env.HARNESS_RELAY_MEMORY_OVERRIDE
    const opts = callArgs[1] || {};
    const hasOomUpgradeMarker =
      opts.memoryTier === 'oom_upgrade' ||
      opts?.env?.HARNESS_RELAY_MEMORY_OVERRIDE === '4096' ||
      opts?.env?.HARNESS_RELAY_MEMORY_OVERRIDE === 4096;
    expect(hasOomUpgradeMarker).toBe(true);

    // [BEHAVIOR-6] 日志含 resume_oom_upgraded
    const logMessages = consoleSpy.mock.calls.flat().join(' ');
    expect(logMessages).toMatch(/resume_oom_upgraded/);

    // resumed 计数正常
    expect(r.resumed).toBe(1);

    consoleSpy.mockRestore();
  });

  it('GP1 升档后 DB PATCH oom_upgraded=true', async () => {
    const deps = makeDeps({ lastExitCode: 137, oomUpgraded: false, containerRunning: false });

    await resumeStalledRelayRuns(deps);

    // spawnSkillRelaySession 内部（或 watchdog 内）应 PATCH oom_upgraded=true
    // 检查 pool.query 调用中是否有写入 oom_upgraded
    const allSqls = deps.pool.query.mock.calls.map((c) => String(c[0]));
    const patchedOomUpgraded = allSqls.some((sql) =>
      /oom_upgraded/.test(sql)
    );
    expect(patchedOomUpgraded).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP2：oom_upgraded=true + exit=137 → oom_wall（FAILING TEST — impl 前必须红）
// ─────────────────────────────────────────────────────────────────────────────
describe('GP2：oom_upgraded=true + exit=137 → oom_wall，禁止 spawn', () => {
  it('spawnFn 未被调用，DB PATCH status=failed / failure_reason=oom_wall', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({ lastExitCode: 137, oomUpgraded: true, containerRunning: false, attempts: 1 });

    const r = await resumeStalledRelayRuns(deps);

    // [BEHAVIOR-2] spawnFn 严禁调用
    expect(deps.spawnFn).not.toHaveBeenCalled();

    // [BEHAVIOR-2] DB PATCH 必须含 oom_wall
    const allCalls = deps.pool.query.mock.calls;
    const hasOomWallPatch = allCalls.some(([sql, params]) => {
      return /failure_reason/.test(String(sql)) ||
             (Array.isArray(params) && params.some((p) => p === 'oom_wall'));
    });
    expect(hasOomWallPatch).toBe(true);

    // [BEHAVIOR-6] 日志含 oom_wall
    const allLogs = [
      ...warnSpy.mock.calls.flat(),
      ...logSpy.mock.calls.flat(),
    ].join(' ');
    expect(allLogs).toMatch(/oom_wall/);

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('GP2 attempts=0 时也触发 oom_wall（短路在 cap 检查之前）', async () => {
    const deps = makeDeps({ lastExitCode: 137, oomUpgraded: true, containerRunning: false, attempts: 0 });

    await resumeStalledRelayRuns(deps);

    // [BEHAVIOR-4] attempts=0 也不走 cap 分支，直接 oom_wall
    expect(deps.spawnFn).not.toHaveBeenCalled();

    // 检查 DB 调用确认 failure_reason=oom_wall 存在
    const allCalls = deps.pool.query.mock.calls;
    const hasOomWall = allCalls.some(([sql, params]) =>
      /failure_reason/.test(String(sql)) ||
      (Array.isArray(params) && params.includes('oom_wall'))
    );
    expect(hasOomWall).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP3：正常路径（exit=null/undefined）无升档副作用（参照测试）
// ─────────────────────────────────────────────────────────────────────────────
describe('GP3：exit=0/1/null → 正常重点火，无升档标记', () => {
  it('exit_code=undefined → spawnFn 被调用，无 oom_upgrade 标记，日志无 OOM 前缀', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({ lastExitCode: undefined, oomUpgraded: false, containerRunning: false });

    const r = await resumeStalledRelayRuns(deps);

    // 正常重点火
    expect(deps.spawnFn).toHaveBeenCalledOnce();

    // 无升档标记
    const callArgs = deps.spawnFn.mock.calls[0];
    const opts = callArgs[1] || {};
    expect(opts.memoryTier).not.toBe('oom_upgrade');

    // 日志无 OOM 前缀
    const logMessages = consoleSpy.mock.calls.flat().join(' ');
    expect(logMessages).not.toMatch(/resume_oom_upgraded/);
    expect(logMessages).not.toMatch(/oom_wall/);

    consoleSpy.mockRestore();
  });

  it('exit_code=null → spawnFn 被调用，无 oom_upgrade 标记', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({ lastExitCode: null, oomUpgraded: false, containerRunning: false });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).toHaveBeenCalledOnce();

    const callArgs = deps.spawnFn.mock.calls[0];
    const opts = callArgs[1] || {};
    expect(opts.memoryTier).not.toBe('oom_upgrade');

    consoleSpy.mockRestore();
  });

  it('exit_code=1 → spawnFn 被调用，无 oom_upgrade 标记', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({ lastExitCode: 1, oomUpgraded: false, containerRunning: false });

    const r = await resumeStalledRelayRuns(deps);

    expect(deps.spawnFn).toHaveBeenCalledOnce();

    const callArgs = deps.spawnFn.mock.calls[0];
    const opts = callArgs[1] || {};
    expect(opts.memoryTier).not.toBe('oom_upgrade');

    consoleSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 日志三态验证（BEHAVIOR-6）
// ─────────────────────────────────────────────────────────────────────────────
describe('日志三态可辨', () => {
  it('GP1 路径日志含 resume_oom_upgraded，GP2 路径日志含 oom_wall，GP3 无 OOM 前缀', async () => {
    // GP1 日志
    {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const deps = makeDeps({ lastExitCode: 137, oomUpgraded: false });
      await resumeStalledRelayRuns(deps);
      const logs = spy.mock.calls.flat().join(' ');
      expect(logs).toMatch(/resume_oom_upgraded/);
      spy.mockRestore();
    }

    // GP2 日志
    {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = makeDeps({ lastExitCode: 137, oomUpgraded: true });
      await resumeStalledRelayRuns(deps);
      const logs = [...logSpy.mock.calls.flat(), ...warnSpy.mock.calls.flat()].join(' ');
      expect(logs).toMatch(/oom_wall/);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }

    // GP3 日志
    {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const deps = makeDeps({ lastExitCode: null });
      await resumeStalledRelayRuns(deps);
      const logs = spy.mock.calls.flat().join(' ');
      expect(logs).not.toMatch(/resume_oom_upgraded/);
      expect(logs).not.toMatch(/oom_wall/);
      spy.mockRestore();
    }
  });
});
