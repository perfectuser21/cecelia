/**
 * 合同测试：刀A5 — gh pr checks 非零退出码容错
 *
 * Task ID: b5162377-4012-424a-ba2f-0b33003eb602
 * Sprint: 07151530-watchdog-ghchecks-exitcode
 *
 * 覆盖场景：
 *   GP-A: gh pr checks 非零退出 + stdout 含 FAILURE → execTolerant 兜底 → 重点火
 *   GP-B: gh pr checks 非零退出 + stdout 全 pending → execTolerant 兜底 → 等待不重点火
 *   GP-C: gh pr checks 非零退出 + 无 stdout（真失败）→ execTolerant 重抛 → 保守跳过
 *   GP-N: gh pr checks 正常退出（exit 0）+ stdout 含 FAILURE → 正常路径不受影响
 *
 * 测试框架：vitest（与 packages/brain/src/__tests__/ 现有测试一致）
 * mock 模式：vi.hoisted + vi.mock + makeDeps 局部 execFn 定制
 *
 * 注意：此文件为独立合同起草文件。
 * PR 实施阶段须将 GP-A/GP-B/GP-C 追加进：
 *   packages/brain/src/__tests__/harness-relay-watchdog.test.js
 * 并 commit 进 repo 作为 regression guard，CI 常驻。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 模块 mock（必须在 import 之前，vi.hoisted 保证顺序）──────────────────────
const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } from '../../../packages/brain/src/harness-relay-watchdog.js';

// ── 常量 ─────────────────────────────────────────────────────────────────────

const TASK_ID = 'bbbbcccc-dddd-eeee-ffff-000011112222';
const SHORT = 'bbbbcccc'; // TASK_ID 去横杠后前 8 位
const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/3971';

// ── makeDeps 基线工厂（与 harness-relay-watchdog.test.js 对齐）──────────────
/**
 * 创建基线 deps，只提供 pool/spawnFn，execFn 由各测试用例按需定制。
 * 原则：不在 makeDeps 公共工厂增加新的默认参数，只在具体 test case 内定制 execFn。
 */
function makeBasePool({
  taskStatus = 'in_progress',
  attempts = 2,
  orchestrator = 'skill-relay',
  orchestratorHost = 'skill-relay-session',
  evaluatorGate = true,
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs r/.test(sql)) {
      return {
        rows: [{
          id: '10000000-0000-4000-8000-000000000004',
          initiative_id: TASK_ID,
          current_task_id: TASK_ID,
          phase: 'planning',
          attempts: String(attempts),
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: PR_URL,
          orchestrator_host: orchestratorHost,
        }],
      };
    }
    if (/FROM tasks/.test(sql)) {
      return {
        rows: [{
          id: TASK_ID,
          status: taskStatus,
          title: 't',
          pr_url: PR_URL,
          payload: { orchestrator },
        }],
      };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  return pool;
}

// ── beforeEach ────────────────────────────────────────────────────────────────
beforeEach(() => {
  mockPool.query.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-A: gh pr checks 非零退出 + stdout 含 FAILURE → execTolerant 兜底 → 重点火
// [BEHAVIOR-1]
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-1] GP-A: gh pr checks 非零退出 + stdout 含 FAILURE → 重点火（resume_ci_red）', () => {
  it('execFn throw 但 err.stdout 含 FAILURE JSON → execTolerant 兜底解析 → spawnFn 被调用一次', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const pool = makeBasePool();
      const spawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-test' });

      // 关键：模拟真实 gh 行为——gh pr checks exit 1 时 throw，但 err.stdout 含数据
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return ''; // 容器消失
        if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
        }
        if (/gh pr view/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN' });
        }
        if (/gh pr checks/.test(cmd)) {
          // 模拟 gh pr checks exit 1（有 FAILURE）——非零退出，但 stdout 有可解析数据
          const err = new Error('Command failed: gh pr checks "..." --json state');
          err.stdout = JSON.stringify([{ state: 'FAILURE' }]);
          throw err;
        }
        return '';
      });

      const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // 核心断言：spawnFn 必须被调用一次（execTolerant 兜底使 CI 红触发重点火）
      expect(spawnFn).toHaveBeenCalledOnce();
      expect(r.resumed).toBe(1);

      // 验证走了 gh pr checks 路径（execFn 接收到 gh pr checks 命令）
      const checksCalls = execFn.mock.calls.filter(c => /gh pr checks/.test(c[0]));
      expect(checksCalls.length).toBeGreaterThan(0);

      // 验证日志含 resume_ci_red
      const logMessages = consoleSpy.mock.calls.map(c => c.join(' '));
      expect(logMessages.some(m => m.includes('resume_ci_red'))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('验证：execTolerant err.stdout 兜底后 ciStatus 映射为 fail（非空 FAILURE 数组）', async () => {
    const pool = makeBasePool();
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 混合状态：有 FAILURE 和 SUCCESS——只要有 FAILURE 就映射 'fail'
        const err = new Error('Command failed: gh pr checks');
        err.stdout = JSON.stringify([
          { state: 'FAILURE', name: 'build' },
          { state: 'SUCCESS', name: 'lint' },
        ]);
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // 有 FAILURE 状态 → ciStatus='fail' → 重点火
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-B: gh pr checks 非零退出 + stdout 全 pending → execTolerant 兜底 → 等待不重点火
// [BEHAVIOR-2]
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-2] GP-B: gh pr checks 非零退出 + stdout 全 pending → 等待（wait_ci_running）', () => {
  it('execFn throw 但 err.stdout 含 IN_PROGRESS JSON → execTolerant 兜底解析 → spawnFn 不调用', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const pool = makeBasePool();
      const spawnFn = vi.fn().mockResolvedValue({ ok: true });

      // 关键：模拟真实 gh 行为——gh pr checks exit 8（有 pending），但 err.stdout 含数据
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
        }
        if (/gh pr view/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN' });
        }
        if (/gh pr checks/.test(cmd)) {
          // 模拟 gh pr checks exit 8（有 pending/running checks）
          const err = new Error('Command failed: gh pr checks "..." --json state');
          err.stdout = JSON.stringify([{ state: 'IN_PROGRESS' }]);
          throw err;
        }
        return '';
      });

      const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // 核心断言：spawnFn 不调用（CI 在跑，等待）
      expect(spawnFn).not.toHaveBeenCalled();
      expect(r.resumed).toBe(0);

      // 验证走了 gh pr checks 路径
      const checksCalls = execFn.mock.calls.filter(c => /gh pr checks/.test(c[0]));
      expect(checksCalls.length).toBeGreaterThan(0);

      // 验证日志含 wait_ci_running
      const logMessages = consoleSpy.mock.calls.map(c => c.join(' '));
      expect(logMessages.some(m => m.includes('wait_ci_running'))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('验证：混合 pending+running 状态（无 FAILURE）→ ciStatus=pending → 不重点火', async () => {
    const pool = makeBasePool();
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks');
        // 混合 pending/running 状态，无 FAILURE
        err.stdout = JSON.stringify([
          { state: 'IN_PROGRESS', name: 'build' },
          { state: 'QUEUED', name: 'test' },
        ]);
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-C: gh pr checks 非零退出 + 无 stdout → execTolerant 重抛 → 保守跳过
// [BEHAVIOR-3]
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-3] GP-C: gh pr checks 非零退出 + 无 stdout（真失败）→ 保守跳过', () => {
  it('execFn throw 且 err.stdout 不存在 → execTolerant 重抛 → 外层 catch 保守跳过', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = makeBasePool();
      const spawnFn = vi.fn().mockResolvedValue({ ok: true });

      // 关键：模拟真实查询失败——抛出错误，且 err 上无 stdout 属性（或为空字符串）
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
        }
        if (/gh pr view/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN' });
        }
        if (/gh pr checks/.test(cmd)) {
          // 模拟网络/auth 失败——无 stdout 属性
          throw new Error('gh: authentication token not found');
          // 注意：此错误没有 err.stdout 属性
        }
        return '';
      });

      const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // 核心断言：spawnFn 不调用（查询失败时保守跳过）
      expect(spawnFn).not.toHaveBeenCalled();
      expect(r.resumed).toBe(0);

      // 验证日志含 CI 状态查询失败
      const warnMessages = consoleSpy.mock.calls.map(c => c.join(' '));
      expect(warnMessages.some(m => m.includes('CI 状态查询失败'))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('execFn throw 且 err.stdout 为空字符串 → execTolerant 重抛（length > 0 不满足）→ 保守跳过', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = makeBasePool();
      const spawnFn = vi.fn().mockResolvedValue({ ok: true });

      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
        }
        if (/gh pr view/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN' });
        }
        if (/gh pr checks/.test(cmd)) {
          // err.stdout 存在但为空字符串（length === 0）→ execTolerant 判断 length > 0 不满足 → 重抛
          const err = new Error('Command failed: gh pr checks');
          err.stdout = '';
          throw err;
        }
        return '';
      });

      const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      expect(spawnFn).not.toHaveBeenCalled();
      expect(r.resumed).toBe(0);

      const warnMessages = consoleSpy.mock.calls.map(c => c.join(' '));
      expect(warnMessages.some(m => m.includes('CI 状态查询失败'))).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-N: gh pr checks 正常退出（exit 0）→ 正常路径不受影响
// [BEHAVIOR-4]
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-4] GP-N: gh pr checks 正常退出（exit 0）→ 正常路径不受 execTolerant 影响', () => {
  it('execFn 正常返回 FAILURE JSON（不 throw）→ ciStatus=fail → 重点火', async () => {
    const pool = makeBasePool();
    const spawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-normal' });

    // 正常路径：不抛错，execTolerant 的 try 块直接 return
    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        // 正常退出（exit 0）——直接返回 JSON 字符串
        return JSON.stringify([{ state: 'FAILURE' }]);
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('execFn 正常返回 IN_PROGRESS JSON（不 throw）→ ciStatus=pending → 不重点火', async () => {
    const pool = makeBasePool();
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        return JSON.stringify([{ state: 'IN_PROGRESS' }]);
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 边界情况：GP-A 但 attempts 达上限 → 熔断优先，不重点火
// ─────────────────────────────────────────────────────────────────────────────
describe('边界：非零退出 stdout 含 FAILURE，但 attempts 达上限 → 熔断优先，不重点火', () => {
  it('GP-A + attempts >= MAX_RELAY_ATTEMPTS → capped=1，不 spawn', async () => {
    const pool = makeBasePool({ attempts: MAX_RELAY_ATTEMPTS });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('Command failed: gh pr checks');
        err.stdout = JSON.stringify([{ state: 'FAILURE' }]);
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // 熔断优先：即使 CI 红，达到上限也不重点火
    expect(spawnFn).not.toHaveBeenCalled();
    expect(r.capped).toBe(1);
    expect(r.resumed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// execTolerant 单元语义验证（从 harness-relay-watchdog.js 导出或就近测试）
// 注：execTolerant 未导出，通过集成测试的 execFn mock 行为间接验证其语义
// ─────────────────────────────────────────────────────────────────────────────
describe('execTolerant 语义验证（通过 resumeStalledRelayRuns 集成验证）', () => {
  it('I-1: err.stdout 有内容 → 兜底返回（不 throw）→ 可继续解析检查数据', async () => {
    // 通过 GP-A 的结果间接验证：如果 execTolerant 没有兜底，会触发 catch(ciErr) 保守跳过，
    // spawnFn 不会被调用。而 GP-A 验证了 spawnFn 被调用，证明兜底生效。
    const pool = makeBasePool();
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const execFn = vi.fn().mockImplementation((cmd) => {
      if (/docker ps/.test(cmd)) return '';
      if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
      }
      if (/gh pr view/.test(cmd)) {
        return JSON.stringify({ state: 'OPEN' });
      }
      if (/gh pr checks/.test(cmd)) {
        const err = new Error('exit 1');
        err.stdout = JSON.stringify([{ state: 'FAILURE' }]); // err.stdout 有内容
        throw err;
      }
      return '';
    });

    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });
    // spawnFn 被调用 → 证明 execTolerant 兜底了（I-1 满足）
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('I-2: err.stdout 为空/不存在 → rethrow → 外层 catch 保守跳过', async () => {
    // 通过 GP-C 的结果间接验证：execTolerant rethrow 后，外层 catch(ciErr) 触发保守跳过
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = makeBasePool();
      const spawnFn = vi.fn().mockResolvedValue({ ok: true });

      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'CLEAN' });
        }
        if (/gh pr view/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN' });
        }
        if (/gh pr checks/.test(cmd)) {
          throw new Error('auth failure'); // 无 err.stdout
        }
        return '';
      });

      const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });
      // spawnFn 不调用 → 证明 execTolerant rethrow 了（I-2 满足）
      expect(spawnFn).not.toHaveBeenCalled();
      expect(r.resumed).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('I-3: CI 查询失败时（execTolerant rethrow）→ spawnFn 绝不被调用', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pool = makeBasePool();
      const spawnFn = vi.fn();

      const execFn = vi.fn().mockImplementation((cmd) => {
        if (/docker ps/.test(cmd)) return '';
        if (/gh pr view/.test(cmd) && /mergeStateStatus/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN', mergeStateStatus: 'BEHIND' });
        }
        if (/gh pr view/.test(cmd)) {
          return JSON.stringify({ state: 'OPEN' });
        }
        if (/gh pr checks/.test(cmd)) {
          // 即使 mergeStateStatus=BEHIND，CI 查询真失败也必须保守跳过
          throw new Error('network timeout');
        }
        return '';
      });

      const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });
      expect(spawnFn).not.toHaveBeenCalled();
      expect(r.resumed).toBe(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
