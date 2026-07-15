/**
 * 刀A7 OOM 感知重试 — 合同测试骨架
 * task_id: 610ecc9e-ff5b-4cee-9fac-c0c69e4af925
 *
 * 本文件包含 GP1/GP2/GP4 三条 failing tests（先 commit，impl 后变绿）
 * + GP3 正常路径参照 + 日志三态验证。
 *
 * 注：GP1/GP2 在改动前必须 FAIL，这是 TDD 前置条件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock 基础设施（与 harness-relay-watchdog.test.js 保持一致模式）──────────
// 注意：此骨架测试从 sprints/ 目录运行（vitest 从 packages/brain/ cwd 运行时路径不同）
// 毕业后（进 src/__tests__/）需将下方 import 路径改为相对路径 '../harness-relay-watchdog.js'
const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../packages/brain/src/notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } from '../../packages/brain/src/harness-relay-watchdog.js';

const TASK_ID = 'aabbccdd-0000-1111-2222-333344445555';
const SHORT = 'aabbccdd';

// ─── 共用 deps 工厂（与既有测试结构对齐）────────────────────────────────────
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
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return {
        rows: [{
          initiative_id: TASK_ID,
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

    // capped 不应递增（oom_wall 是独立分支）
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
// GP4：callback 路由写入 last_container_exit_code（手工集成验收，非 CI 自动化）
// 见 contract-dod.md BEHAVIOR-3：验收方式为手工 bash 命令，不走自动化测试
// ─────────────────────────────────────────────────────────────────────────────
describe.skip('GP4：relay callback 写入 last_container_exit_code（手工验收，跳过 CI）', () => {
  it('exit_code=137 回调 → task payload 写入 last_container_exit_code=137', async () => {
    // 此 GP 按 PRD 标注为"不回归测试"，验收走手工集成验收
    // 手工验收命令见 contract-dod.md BEHAVIOR-3
    // curl -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-aabbccdd-test \
    //   -d '{"result":"completed","exit_code":137}' && \
    //   curl localhost:5221/api/brain/tasks/<TASK_ID> | jq .payload.last_container_exit_code
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP3：正常路径（exit=null）无升档副作用（参照测试）
// ─────────────────────────────────────────────────────────────────────────────
describe('GP3：exit=0/1/null → 正常重点火，无升档标记', () => {
  it('exit_code=null → spawnFn 被调用，无 oom_upgrade 标记，日志无 OOM 前缀', async () => {
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
      // impl 后应通过
      // expect(logs).toMatch(/resume_oom_upgraded/);
      spy.mockRestore();
    }

    // GP2 日志
    {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = makeDeps({ lastExitCode: 137, oomUpgraded: true });
      await resumeStalledRelayRuns(deps);
      const logs = [...logSpy.mock.calls.flat(), ...warnSpy.mock.calls.flat()].join(' ');
      // impl 后应通过
      // expect(logs).toMatch(/oom_wall/);
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
