/**
 * TDD Red 阶段：harness-relay-watchdog execTolerant 路径覆盖测试
 *
 * 覆盖三条 Golden Path：
 *   GP-A (resume_ci_red)    — gh pr checks 非零退出 + err.stdout 含 FAILURE → 触发重点火
 *   GP-B (wait_ci_running)  — gh pr checks 非零退出 + err.stdout 全 pending → 等待，不重点火
 *   GP-C (skip_query_failure) — gh pr checks 非零退出 + 无 stdout → 保守跳过，不重点火
 *
 * 当前状态：这些测试在未修复的代码下应该【失败】（TDD Red）。
 * 根因：现有 makeDeps.execFn mock 对 gh pr checks 始终正常返回字符串，
 * 从未模拟非零退出抛出 err.stdout 的场景，execTolerant 兜底路径无覆盖。
 *
 * Task: b5162377-4012-424a-ba2f-0b33003eb602
 * Sprint: 07151530-watchdog-ghchecks-exitcode
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB / notifier mock（与现有测试对齐）──────────────────────────────────────
const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } from '../../../packages/brain/src/harness-relay-watchdog.js';

// ── 常量 ─────────────────────────────────────────────────────────────────────
const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const PR_URL = 'https://github.com/org/repo/pull/3971';

/**
 * 基础 deps 工厂（与 harness-relay-watchdog.test.js 的 makeDeps 对齐）。
 * execFn 在各 test case 中通过局部覆盖定制，不修改公共工厂函数签名。
 */
function makeBaseDeps({
  taskStatus = 'in_progress',
  attempts = 2,
  prUrl = PR_URL,
  orchestrator = 'skill-relay',
  evaluatorGate = true,
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs r/.test(sql)) {
      return {
        rows: [{
          id: '10000000-0000-4000-8000-000000000003',
          initiative_id: TASK_ID,
          current_task_id: TASK_ID,
          phase: 'planning',
          attempts: String(attempts),
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: prUrl,
          orchestrator_host: 'skill-relay-session',
        }],
      };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload: { orchestrator } }] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  return {
    pool,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-test' }),
  };
}

beforeEach(() => {
  mockPool.query.mockReset();
});

// ── GP-A：resume_ci_red ────────────────────────────────────────────────────
describe('GP-A: resume_ci_red — gh pr checks 非零退出 + err.stdout 含 FAILURE → 重点火', () => {
  it('execFn 对 gh pr checks 抛出 err（err.stdout 含 FAILURE JSON）→ execTolerant 兜底 → ciStatus=fail → spawnFn 调用一次', async () => {
    const base = makeBaseDeps();

    // 自定义 execFn：gh pr checks 抛出非零退出错误（模拟 exit 1）
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return ''; // 容器消失
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 模拟 gh pr checks exit 1（有 FAILURE）：execSync 抛出 err，携带 err.stdout
        const err = new Error('Command failed: gh pr checks "' + PR_URL + '" --json state\nexit code 1');
        err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'FAILURE' }]);
        err.stderr = '';
        err.status = 1;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ ...base, execFn });

    // GP-A 断言：execTolerant 兜底后 ciStatus='fail' → 落穿到重点火逻辑 → spawnFn 被调用
    expect(base.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);

    // 验证 gh pr checks 确实被调用（execFn 已触达 gh pr checks 分支）
    const checksCalled = execFn.mock.calls.some(([cmd]) => /gh pr checks/.test(cmd));
    expect(checksCalled).toBe(true);
  });
});

// ── GP-B：wait_ci_running ──────────────────────────────────────────────────
describe('GP-B: wait_ci_running — gh pr checks 非零退出 + err.stdout 全 pending → 等待不重点火', () => {
  it('execFn 对 gh pr checks 抛出 err（err.stdout 含 IN_PROGRESS JSON）→ execTolerant 兜底 → ciStatus=pending → spawnFn 不调用', async () => {
    const base = makeBaseDeps();

    // 自定义 execFn：gh pr checks 抛出非零退出错误（模拟 exit 8）
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return ''; // 容器消失
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 模拟 gh pr checks exit 8（全 pending）：execSync 抛出 err，携带 err.stdout
        const err = new Error('Command failed: gh pr checks "' + PR_URL + '" --json state\nexit code 8');
        err.stdout = JSON.stringify([{ name: 'brain-ci', state: 'IN_PROGRESS' }]);
        err.stderr = '';
        err.status = 8;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ ...base, execFn });

    // GP-B 断言：execTolerant 兜底后 ciStatus='pending' → wait_ci_running → spawnFn 不被调用
    expect(base.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);

    // 验证 gh pr checks 确实被调用
    const checksCalled = execFn.mock.calls.some(([cmd]) => /gh pr checks/.test(cmd));
    expect(checksCalled).toBe(true);
  });

  it('execFn 对 gh pr checks 抛出 err（err.stdout 含混合 pending+IN_PROGRESS JSON）→ ciStatus=pending → spawnFn 不调用', async () => {
    const base = makeBaseDeps();

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks exit 8');
        // 多条 check 全为 pending 类状态
        err.stdout = JSON.stringify([
          { name: 'ci-a', state: 'IN_PROGRESS' },
          { name: 'ci-b', state: 'QUEUED' },
        ]);
        err.status = 8;
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ ...base, execFn });
    expect(base.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});

// ── GP-C：skip_query_failure ───────────────────────────────────────────────
describe('GP-C: skip_query_failure — gh pr checks 非零退出 + 无 stdout → 保守跳过', () => {
  it('execFn 对 gh pr checks 抛出无 stdout 属性的错误 → execTolerant rethrow → 外层 catch 保守跳过 → spawnFn 不调用', async () => {
    const base = makeBaseDeps();

    // 自定义 execFn：gh pr checks 抛出无 err.stdout 的错误（模拟真实网络/auth 失败）
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return ''; // 容器消失
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 真实查询失败：无 err.stdout（或空字符串）
        const err = new Error('gh: authentication token not found');
        // 故意不设 err.stdout，或设为空字符串
        err.stdout = '';
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ ...base, execFn });

    // GP-C 断言：execTolerant rethrow → 外层 catch 保守跳过 → spawnFn 不被调用
    expect(base.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('execFn 对 gh pr checks 抛出没有 stdout 属性的纯 Error → execTolerant rethrow → 保守跳过', async () => {
    const base = makeBaseDeps();

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // stdout 属性完全不存在
        throw new Error('network timeout');
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ ...base, execFn });
    expect(base.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});
