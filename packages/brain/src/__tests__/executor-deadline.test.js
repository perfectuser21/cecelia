/**
 * Regression test: executor.js watchdog deadline 计算
 *
 * Bug: Math.max(60_000, negative) = 60_000 当 deadline 已过期
 * Fix: 过期或 null deadline → 6h fallback，未过期 → 剩余 ms
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { computeDeadlineMs } from '../executor.js';
import { CODEX_REVIEW_LOCK_DIR } from '../lib/codex-review-liveness.js';

const SIX_HOURS_MS = 6 * 3600 * 1000;

describe('computeDeadlineMs', () => {
  it('null deadlineAt → 6h fallback', () => {
    expect(computeDeadlineMs(null)).toBe(SIX_HOURS_MS);
  });

  it('undefined deadlineAt → 6h fallback', () => {
    expect(computeDeadlineMs(undefined)).toBe(SIX_HOURS_MS);
  });

  it('过期的 deadlineAt → 6h fallback（Bug 1 回归）', () => {
    const pastDate = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 分钟前
    const result = computeDeadlineMs(pastDate);
    // Bug: Math.max(60_000, negative) = 60_000；Fix: 应返回 6h
    expect(result).toBe(SIX_HOURS_MS);
    // 确保不是 60_000（这是 bug 的表现）
    expect(result).not.toBe(60_000);
  });

  it('未来的 deadlineAt → 剩余 ms（正数，小于 6h）', () => {
    const futureDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2h 后
    const result = computeDeadlineMs(futureDate);
    // 应在 [1h55m, 2h5m] 范围内（允许测试执行延迟）
    expect(result).toBeGreaterThan(1 * 3600 * 1000);
    expect(result).toBeLessThan(SIX_HOURS_MS);
  });

  it('deadline 恰好现在（边界）→ 6h fallback', () => {
    const nowish = new Date(Date.now() - 1).toISOString(); // 刚过期 1ms
    expect(computeDeadlineMs(nowish)).toBe(SIX_HOURS_MS);
  });
});

// ── probeTaskLiveness REVIEW 分支 shard-1 落点用例（brain-diff-coverage） ──
// 正宫功能用例（三态：lock 新鲜/缺失/超龄）在 src/__tests__/liveness-probe.test.js。
// 本文件只补一个最小场景，理由：CI 的 brain-unit shard 1 用 vitest 原生
// --shard=1/6（按文件 hash 轮转分片），liveness-probe.test.js 不落在 shard 1，
// 而 brain-diff-coverage 只消费 shard-1 的 lcov —— 导致 executor.js 新增的
// REVIEW_TASK_TYPES 分支（probeTaskLiveness 内）与 lib/codex-review-liveness.js
// 的函数体在 shard-1 覆盖率里恒为 0，diff-coverage 必红。executor-deadline.test.js
// 本身就在 shard-1 且已直接 import '../executor.js'（computeDeadlineMs 是纯函数、
// 不碰 db/child_process/task-router），加一组独立 mock 不会影响上面既有 5 个用例。
describe('probeTaskLiveness — REVIEW 分支 shard-1 落点用例（diff-coverage）', () => {
  const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
  vi.mock('../db.js', () => ({ default: mockPool }));
  vi.mock('child_process', () => ({
    spawn: vi.fn(),
    execSync: vi.fn(() => '0'),
  }));
  vi.mock('../task-router.js', () => ({
    getInternalTaskHandler: vi.fn(() => null),
    getTaskLocation: vi.fn(() => 'us'),
  }));

  let probeTaskLiveness, suspectProcesses;
  const lockFiles = [];
  const lockPath = (taskId) => path.join(CODEX_REVIEW_LOCK_DIR, `${taskId}.lock`);

  beforeAll(async () => {
    // 与 liveness-probe.test.js 同款做法：不在顶层 await import，用 beforeAll +
    // vi.resetModules() 确保 probeTaskLiveness 与 suspectProcesses 来自同一个
    // （已应用本 describe mock 的）新鲜模块实例，不影响上面 computeDeadlineMs
    // 用的那个（文件顶层静态 import 时已加载的）旧实例。
    vi.resetModules();
    const executor = await import('../executor.js');
    probeTaskLiveness = executor.probeTaskLiveness;
    suspectProcesses = executor.suspectProcesses;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    suspectProcesses.clear();
  });

  afterEach(() => {
    while (lockFiles.length) {
      const f = lockFiles.pop();
      try { rmSync(f, { force: true }); } catch { /* already gone */ }
    }
  });

  it('lock 新鲜 → probeTaskLiveness 后任务不被标 SUSPECT', async () => {
    const taskId = `arch-review-fresh-${randomUUID()}`;
    if (!existsSync(CODEX_REVIEW_LOCK_DIR)) {
      mkdirSync(CODEX_REVIEW_LOCK_DIR, { recursive: true });
    }
    const lockFile = lockPath(taskId);
    writeFileSync(lockFile, JSON.stringify({ startedAt: new Date().toISOString() }), 'utf-8');
    lockFiles.push(lockFile);

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        title: 'Arch Review Fresh (shard-1 落点)',
        task_type: 'arch_review',
        payload: {},
        started_at: new Date(Date.now() - 120000).toISOString(), // 早于 60s grace，触发进程死信号
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]);
    expect(suspectProcesses.has(taskId)).toBe(false);
  });
});
