/**
 * 刀 hotfix：watchdog DIRTY resume 补丁 — 回归测试
 * task_id: c6a171e5-1a9c-4058-8364-abd946daccae
 * sprint: sprints/07171430-watchdog-dirty-resume
 *
 * 本文件包含：
 *   B1 — DIRTY + 容器消失 → 重点火（failing→passing，修复前必须 FAIL）
 *   B2 — BEHIND + 容器消失 → 重点火（回归保护，修复前后均须 PASS）
 *   B3 — CI 全绿 + evaluator 完成 → 不重点火（回归保护）
 *   B4 — BLOCKED（非 DIRTY）+ CI pending → wait_ci_running（回归保护）
 *
 * 铁律：
 *   1. 禁止 mock tryParseJson / isBehind / isDirty 推导路径
 *   2. execFn 必须返回含真实 mergeStateStatus 字段的 JSON 字符串，由 watchdog 内部解析
 *   3. B1 在修复前必须 FAIL（验证测试覆盖了实际 bug 路径）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock 基础设施 ─────────────────────────────────────────────────────────────
const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({
  sendBark: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../packages/brain/src/harness-skill-relay.js', () => ({
  spawnSkillRelaySession: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-c6a171e5' }),
  HEADED_HOSTS: {},
  HEADED_TMUX_PREFIXES: [],
}));

import { resumeStalledRelayRuns, MAX_RELAY_ATTEMPTS } from '../../../packages/brain/src/harness-relay-watchdog.js';

const TASK_ID = 'c6a171e5-1a9c-4058-8364-abd946daccae';
const SHORT = 'c6a171e5'; // shortId() → 去 - 取前 8 位

// ─── 共用 DB mock 工厂 ─────────────────────────────────────────────────────────
/**
 * 构造 pool.query mock：
 *   - initiative_runs 查询：返回一条 v2 run（phase=A_planning，容器路径用 orchestrator_host='skill-relay-session'）
 *   - tasks 查询：返回一条 in_progress task
 *   - initiative_run_events（evaluator gate）：由 evaluatorDone 控制
 *   - 其他：返回空
 */
function makePool({
  attempts = 1,
  prUrl = 'https://github.com/perfectuser21/cecelia/pull/4023',
  evaluatorDone = false,
} = {}) {
  const pool = { query: vi.fn() };

  pool.query.mockImplementation(async (sql, params) => {
    // initiative_runs exact task selector
    if (/FROM initiative_runs r/.test(sql)) {
      return {
        rows: [{
          id: '10000000-0000-4000-8000-000000000005',
          initiative_id: TASK_ID,
          current_task_id: TASK_ID,
          phase: 'A_planning',
          attempts: String(attempts),
          deadline_at: new Date(Date.now() + 3600e3).toISOString(),
          pr_url: prUrl,
          orchestrator_host: 'skill-relay-session',
          started_at: new Date(Date.now() - 600e3).toISOString(),
        }],
      };
    }
    // tasks 查询
    if (/FROM tasks/.test(sql)) {
      return {
        rows: [{
          id: TASK_ID,
          status: 'in_progress',
          title: 'DIRTY resume hotfix test task',
          payload: {
            orchestrator: 'skill-relay',
            base_repo: '/Users/administrator/perfect21/cecelia',
          },
          pr_url: prUrl,
        }],
      };
    }
    // evaluator gate（initiative_run_events）
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorDone ? [{ '?column?': 1 }] : [] };
    }
    // UPDATE 类操作（重点火失败后标状态）
    if (/UPDATE/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  });

  return pool;
}

// ─── execFn 工厂（铁律：必须返回真实 JSON 字符串，不 mock 解析路径）────────────
/**
 * @param {object} opts
 * @param {string}  opts.mergeStateStatus  - 'DIRTY' | 'BEHIND' | 'CLEAN' | 'BLOCKED' 等
 * @param {string}  opts.prState           - 'OPEN' | 'MERGED' | 'CLOSED'
 * @param {Array}   opts.checkRows         - gh pr checks --json state 的返回数据
 * @param {boolean} opts.containerRunning  - docker ps 是否返回非空
 */
function makeExecFn({
  mergeStateStatus = 'DIRTY',
  prState = 'OPEN',
  checkRows = [],
  containerRunning = false,
} = {}) {
  return vi.fn().mockImplementation((cmd) => {
    // docker ps：容器存活检测
    if (/docker ps/.test(cmd)) {
      return containerRunning ? `cecelia-relay-${SHORT.slice(0, 8)}abc\n` : '';
    }

    // gh pr view ... --json state（MERGED 前置检查）
    if (/gh pr view/.test(cmd) && /--json state$/.test(cmd)) {
      // 铁律：返回真实 JSON 字符串
      return JSON.stringify({ state: prState });
    }

    // gh pr checks ... --json state
    if (/gh pr checks/.test(cmd) && /--json state/.test(cmd)) {
      // 铁律：返回真实 JSON 字符串（空数组 = CI pending）
      return JSON.stringify(checkRows);
    }

    // gh pr view ... --json mergeStateStatus（主路径 L391）
    if (/gh pr view/.test(cmd) && /--json mergeStateStatus$/.test(cmd)) {
      // 铁律：返回真实含 mergeStateStatus 字段的 JSON，由 watchdog 内部 tryParseJson 解析
      return JSON.stringify({ mergeStateStatus });
    }

    // gh pr view ... --json statusCheckRollup,mergeStateStatus（fallback L399）
    if (/gh pr view/.test(cmd) && /statusCheckRollup,mergeStateStatus/.test(cmd)) {
      return JSON.stringify({ mergeStateStatus, statusCheckRollup: checkRows });
    }

    // gh pr list（PR 发现 fallback）
    if (/gh pr list/.test(cmd)) {
      return JSON.stringify([]);
    }

    return '';
  });
}

// ─── beforeEach 重置 ──────────────────────────────────────────────────────────
beforeEach(() => {
  mockPool.query.mockReset();
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// B1：DIRTY + 容器消失 → 重点火（failing→passing，修复前必须 FAIL）
// ═════════════════════════════════════════════════════════════════════════════
describe('B1: DIRTY + 容器消失 → 触发有界重点火，日志含 resume_conflict', () => {
  it('[BEHAVIOR-1] out.resumed===1，spawnFn 被调一次，日志含 resume_conflict', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pool = makePool({ attempts: 1 });
    const execFn = makeExecFn({
      mergeStateStatus: 'DIRTY',
      prState: 'OPEN',
      checkRows: [],          // CI pending（DIRTY 下 CI 永不完整）
      containerRunning: false, // 容器已消失（触发 DIRTY 重点火的前提）
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-c6a171e5-test' });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // [BEHAVIOR-1] out.resumed 必须为 1
    expect(out.resumed).toBe(1);

    // [BEHAVIOR-1] spawnFn 必须被调用恰好一次
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // [BEHAVIOR-1] 日志必须含 resume_conflict
    const logs = consoleSpy.mock.calls.flat().join('\n');
    expect(logs).toMatch(/resume_conflict/);

    consoleSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B2：BEHIND + 容器消失 → 重点火（回归保护，修复前后均须 PASS）
// ═════════════════════════════════════════════════════════════════════════════
describe('B2: BEHIND + 容器消失 → 重点火（回归保护）', () => {
  it('[BEHAVIOR-2] out.resumed===1，日志含 BEHIND，不含 resume_conflict', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pool = makePool({ attempts: 1 });
    const execFn = makeExecFn({
      mergeStateStatus: 'BEHIND',
      prState: 'OPEN',
      checkRows: [],           // CI pending
      containerRunning: false,
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-c6a171e5-test' });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // [BEHAVIOR-2] 重点火
    expect(out.resumed).toBe(1);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // [BEHAVIOR-2] 日志含 BEHIND
    const logs = consoleSpy.mock.calls.flat().join('\n');
    expect(logs).toMatch(/BEHIND/);

    consoleSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B3：CI 全绿 + CLEAN + evaluator 完成 → 不重点火（回归保护）
// ═════════════════════════════════════════════════════════════════════════════
describe('B3: CI 全绿 + CLEAN + evaluator 完成 → 等待 merge，不重点火（回归保护）', () => {
  it('[BEHAVIOR-3] out.resumed===0，spawnFn 未被调，日志含 skip_green_waiting_merge', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pool = makePool({ attempts: 1, evaluatorDone: true });
    const execFn = makeExecFn({
      mergeStateStatus: 'CLEAN',
      prState: 'OPEN',
      checkRows: [
        { state: 'SUCCESS' },
        { state: 'SUCCESS' },
      ], // CI 全绿
      containerRunning: false,
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // [BEHAVIOR-3] 不重点火
    expect(out.resumed).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();

    // [BEHAVIOR-3] 日志含 skip_green_waiting_merge
    const logs = consoleSpy.mock.calls.flat().join('\n');
    expect(logs).toMatch(/skip_green_waiting_merge/);

    consoleSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B4：BLOCKED（非 DIRTY）+ CI pending → wait_ci_running（回归保护）
// ═════════════════════════════════════════════════════════════════════════════
describe('B4: BLOCKED（非 DIRTY）+ CI pending → wait_ci_running，不重点火（回归保护）', () => {
  it('[BEHAVIOR-4] out.resumed===0，spawnFn 未被调，日志含 wait_ci_running', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pool = makePool({ attempts: 1 });
    const execFn = makeExecFn({
      mergeStateStatus: 'BLOCKED', // 非 DIRTY，非 BEHIND
      prState: 'OPEN',
      checkRows: [],               // CI pending
      containerRunning: false,
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // [BEHAVIOR-4] 不重点火
    expect(out.resumed).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();

    // [BEHAVIOR-4] 日志含 wait_ci_running
    const logs = consoleSpy.mock.calls.flat().join('\n');
    expect(logs).toMatch(/wait_ci_running/);

    consoleSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B5（铁律）：DIRTY + attempt cap 已达上限 → 不重点火
// ═════════════════════════════════════════════════════════════════════════════
describe('B5（铁律）: DIRTY + attempt cap 上限 → 不重点火，cap 生效', () => {
  it('[BEHAVIOR-5] attempts>=MAX_RELAY_ATTEMPTS 时，out.resumed===0，spawnFn 未被调', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pool = makePool({ attempts: MAX_RELAY_ATTEMPTS }); // 达到上限
    const execFn = makeExecFn({
      mergeStateStatus: 'DIRTY',
      prState: 'OPEN',
      checkRows: [],
      containerRunning: false,
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });

    const out = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

    // [BEHAVIOR-5] cap 生效，不重点火
    expect(out.resumed).toBe(0);
    expect(spawnFn).not.toHaveBeenCalled();
    // capped 计数可以是 1，也可以通过 DB UPDATE 落盘
    // 主要约束是 spawnFn 未被调

    consoleSpy.mockRestore();
  });
});
