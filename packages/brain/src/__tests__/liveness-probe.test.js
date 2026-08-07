/**
 * Liveness Probe Tests
 * Tests for process liveness detection and double-confirm pattern
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import path from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { CODEX_REVIEW_LOCK_DIR } from '../lib/codex-review-liveness.js';

// Mock pool — hoisted so executor.js always gets this mockPool regardless of module cache order
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '0'),
}));

// Mock task-router
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
// suspectProcesses 是 executor.js 内部的 Map，必须与 probeTaskLiveness 同一模块实例
let probeTaskLiveness, isRunIdProcessAlive, suspectProcesses, isProcessAlive;

beforeAll(async () => {
  vi.resetModules();
  const executor = await import('../executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
  isRunIdProcessAlive = executor.isRunIdProcessAlive;
  suspectProcesses = executor.suspectProcesses;
  isProcessAlive = executor.isProcessAlive;
});

describe('isRunIdProcessAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false for null/empty runId', () => {
    expect(isRunIdProcessAlive(null)).toBe(false);
    expect(isRunIdProcessAlive('')).toBe(false);
    expect(isRunIdProcessAlive(undefined)).toBe(false);
  });

  it('should return true when process with runId exists', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValueOnce('1\n');
    expect(isRunIdProcessAlive('run-abc-123')).toBe(true);
  });

  it('should return false when no process with runId exists', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValueOnce('0\n');
    expect(isRunIdProcessAlive('run-abc-123')).toBe(false);
  });

  it('should return false when execSync throws', async () => {
    const { execSync } = await import('child_process');
    execSync.mockImplementationOnce(() => { throw new Error('fail'); });
    expect(isRunIdProcessAlive('run-abc-123')).toBe(false);
  });
});

describe('probeTaskLiveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suspectProcesses.clear();
  });

  it('should return empty actions when no in_progress tasks', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]);
  });

  it('should mark task as suspect on first probe failure', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // No matching process

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-1',
        title: 'Test Task',
        payload: { current_run_id: 'run-dead-123', run_triggered_at: new Date(Date.now() - 120000).toISOString() },
        started_at: new Date(Date.now() - 120000).toISOString()
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]); // No auto-fail on first probe
    expect(suspectProcesses.has('task-1')).toBe(true);
  });

  it('should requeue task on second probe failure (double-confirm)', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n');

    // Pre-populate suspect status
    suspectProcesses.set('task-2', {
      firstSeen: new Date(Date.now() - 10000).toISOString(),
      tickCount: 1
    });

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-2',
          title: 'Dead Task',
          payload: { current_run_id: 'run-dead-456', run_triggered_at: new Date(Date.now() - 120000).toISOString() },
          started_at: new Date(Date.now() - 120000).toISOString(),
          // task 94ee0ec4：kill 分类需 spawn 证据（A/B/D），本用例测既有 DEAD→requeue 路径 → 补 D（派发回执）
          error_message: 'prior dispatch receipt (fixture)'
        }]
      })
      // requeueTask: SELECT payload, task_type, project_id, title
      .mockResolvedValueOnce({ rows: [{ payload: {}, task_type: 'dev', project_id: null, title: 'Dead Task' }] })
      // requeueTask: UPDATE tasks SET status = 'queued'
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: INSERT INTO task_events 处置留痕（task 94ee0ec4）
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: SELECT content_hash from learnings (dedup check)
      .mockResolvedValueOnce({ rows: [] })
      // requeueTask: INSERT INTO learnings
      .mockResolvedValueOnce({ rowCount: 1 });

    const actions = await probeTaskLiveness();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('liveness_auto_requeue');
    expect(actions[0].task_id).toBe('task-2');
    expect(suspectProcesses.has('task-2')).toBe(false); // Cleared after requeue
  });

  it('should clear suspect status when process recovers', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('1\n'); // Process found

    suspectProcesses.set('task-3', {
      firstSeen: new Date().toISOString(),
      tickCount: 1
    });

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-3',
        title: 'Recovered Task',
        payload: { current_run_id: 'run-alive-789' },
        started_at: new Date(Date.now() - 60000).toISOString()
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]);
    expect(suspectProcesses.has('task-3')).toBe(false);
  });

  it('should use grace period for recently dispatched tasks without run_id', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-4',
        title: 'New Task',
        payload: { run_triggered_at: new Date(Date.now() - 30000).toISOString() }, // 30s ago
        started_at: new Date(Date.now() - 30000).toISOString()
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]); // Within 60s grace period
    expect(suspectProcesses.has('task-4')).toBe(false);
  });

  it('should NOT mark decomposition task as dead within 60min grace period', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // Process not found in ps

    const triggeredAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'decomp-task-1',
        title: 'Initiative 拆解: 丘脑路由',
        payload: {
          decomposition: 'true',
          current_run_id: 'run-decomp-123',
          run_triggered_at: triggeredAt,
        },
        started_at: triggeredAt,
      }]
    });

    const actions = await probeTaskLiveness();
    // Should NOT be suspect or failed — decomp grace period applies
    expect(actions).toEqual([]);
    expect(suspectProcesses.has('decomp-task-1')).toBe(false);
  });

  it('should requeue decomposition task after 60min grace period expires', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('0\n'); // Process not found in ps

    // Pre-populate suspect status
    suspectProcesses.set('decomp-task-2', {
      firstSeen: new Date(Date.now() - 10000).toISOString(),
      tickCount: 1
    });

    const triggeredAt = new Date(Date.now() - 65 * 60 * 1000).toISOString(); // 65 min ago (past grace)

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'decomp-task-2',
          title: 'Initiative 拆解: 老任务',
          payload: {
            decomposition: 'true',
            current_run_id: 'run-decomp-456',
            run_triggered_at: triggeredAt,
          },
          started_at: triggeredAt,
          // task 94ee0ec4：kill 分类需 spawn 证据（A/B/D），本用例测 grace 过期 DEAD→requeue → 补 D
          error_message: 'prior dispatch receipt (fixture)',
        }]
      })
      // requeueTask: SELECT payload, task_type, project_id, title
      .mockResolvedValueOnce({ rows: [{ payload: {}, task_type: 'decomp', project_id: null, title: 'Initiative 拆解: 老任务' }] })
      // requeueTask: UPDATE tasks SET status = 'queued'
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: INSERT INTO task_events 处置留痕（task 94ee0ec4）
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: SELECT content_hash from learnings (dedup check)
      .mockResolvedValueOnce({ rows: [] })
      // requeueTask: INSERT INTO learnings
      .mockResolvedValueOnce({ rowCount: 1 });

    const actions = await probeTaskLiveness();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('liveness_auto_requeue');
    expect(actions[0].task_id).toBe('decomp-task-2');
  });
});

// REVIEW 类任务（arch_review 等）活性以 lock 文件为准（决策 9befa9c3，issue f1d6840f）
// executor.js probeTaskLiveness 内 REVIEW_TASK_TYPES 分支：lock 新鲜 → 不判 SUSPECT；
// lock 缺失/超龄 → 落入既有 SUSPECT→DEAD 双确认流程（回队有出路）。
describe('probeTaskLiveness — REVIEW 分支（codex-review-local lock 探活）', () => {
  const lockFiles = [];

  const lockPath = (taskId) => path.join(CODEX_REVIEW_LOCK_DIR, `${taskId}.lock`);

  const writeLock = (taskId, startedAt) => {
    if (!existsSync(CODEX_REVIEW_LOCK_DIR)) {
      mkdirSync(CODEX_REVIEW_LOCK_DIR, { recursive: true });
    }
    const file = lockPath(taskId);
    writeFileSync(file, JSON.stringify({ startedAt }), 'utf-8');
    lockFiles.push(file);
  };

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
    writeLock(taskId, new Date().toISOString()); // 刚写入，远小于 90 分钟上限

    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        title: 'Arch Review Fresh',
        task_type: 'arch_review',
        payload: {},
        started_at: new Date(Date.now() - 120000).toISOString(), // 早于 60s grace，触发进程死信号
      }]
    });

    const actions = await probeTaskLiveness();
    expect(actions).toEqual([]);
    expect(suspectProcesses.has(taskId)).toBe(false);
  });

  it('lock 缺失 → 两轮 probe 后走 DEAD 处置（requeue）', async () => {
    const taskId = `arch-review-missing-${randomUUID()}`;
    // 不写 lock 文件 —— probeCodexReviewLock 返回 'dead'

    // 第一轮：首次探测失败，标 SUSPECT，不 requeue
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        title: 'Arch Review Missing Lock',
        task_type: 'arch_review',
        payload: {},
        started_at: new Date(Date.now() - 120000).toISOString(),
      }]
    });
    const firstActions = await probeTaskLiveness();
    expect(firstActions).toEqual([]);
    expect(suspectProcesses.has(taskId)).toBe(true);

    // 第二轮：确认死亡 → requeue（复用既有测试的 requeueTask mock 序列）
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: taskId,
          title: 'Arch Review Missing Lock',
          task_type: 'arch_review',
          payload: {},
          started_at: new Date(Date.now() - 120000).toISOString(),
          // task 94ee0ec4：kill 分类需 spawn 证据（A/B/D），本用例测 lock 缺失 DEAD→requeue → 补 D
          error_message: 'prior dispatch receipt (fixture)',
        }]
      })
      // requeueTask: SELECT payload, task_type, project_id, title, started_at
      .mockResolvedValueOnce({ rows: [{ payload: {}, task_type: 'arch_review', project_id: null, title: 'Arch Review Missing Lock' }] })
      // requeueTask: UPDATE tasks SET status = 'queued'
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: INSERT INTO task_events 处置留痕（task 94ee0ec4）
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: SELECT content_hash from learnings (dedup check)
      .mockResolvedValueOnce({ rows: [] })
      // requeueTask: INSERT INTO learnings
      .mockResolvedValueOnce({ rowCount: 1 });

    const secondActions = await probeTaskLiveness();
    expect(secondActions).toHaveLength(1);
    expect(secondActions[0].action).toBe('liveness_auto_requeue');
    expect(secondActions[0].task_id).toBe(taskId);
    expect(suspectProcesses.has(taskId)).toBe(false);
  });

  it('lock 超龄（startedAt 2 小时前）→ 走 DEAD 处置（同缺失 lock）', async () => {
    const taskId = `arch-review-stale-${randomUUID()}`;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeLock(taskId, twoHoursAgo); // 超过 90 分钟 maxAgeMinutes 上限 → probeCodexReviewLock 返回 'dead'

    // 预置 SUSPECT，直接验证第二轮确认死亡（与既有测试对 DEAD 的断言方式一致）
    suspectProcesses.set(taskId, {
      firstSeen: new Date(Date.now() - 10000).toISOString(),
      tickCount: 1,
    });

    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          id: taskId,
          title: 'Arch Review Stale Lock',
          task_type: 'arch_review',
          payload: {},
          started_at: new Date(Date.now() - 120000).toISOString(),
          // task 94ee0ec4：kill 分类需 spawn 证据（A/B/D），本用例测 lock 超龄 DEAD→requeue → 补 D
          error_message: 'prior dispatch receipt (fixture)',
        }]
      })
      .mockResolvedValueOnce({ rows: [{ payload: {}, task_type: 'arch_review', project_id: null, title: 'Arch Review Stale Lock' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      // requeueTask: INSERT INTO task_events 处置留痕（task 94ee0ec4）
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const actions = await probeTaskLiveness();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('liveness_auto_requeue');
    expect(actions[0].task_id).toBe(taskId);
    expect(suspectProcesses.has(taskId)).toBe(false);
  });
});
