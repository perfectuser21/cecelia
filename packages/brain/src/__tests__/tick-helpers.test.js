/**
 * Brain v2 Phase D Part 1.6 — tick-helpers 单元测试。
 *
 * 覆盖：
 *   - routeTask: task_type / platform 路由表正确性
 *   - releaseBlockedTasks: SQL 正确执行 + 返回 row
 *   - autoFailTimedOutTasks: 超时任务 → kill + quarantine + requeue
 *   - getRampedDispatchMax: pressure / alertness / cooldown 调速
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 所有外部依赖
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const mockKillProcess = vi.fn();
const mockCheckServerResources = vi.fn();
vi.mock('../executor.js', () => ({
  killProcess: (...args) => mockKillProcess(...args),
  checkServerResources: (...args) => mockCheckServerResources(...args),
}));

const mockHandleTaskFailure = vi.fn();
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: (...args) => mockHandleTaskFailure(...args),
}));

const mockEmit = vi.fn();
vi.mock('../event-bus.js', () => ({
  emit: (...args) => mockEmit(...args),
}));

const mockGetCurrentAlertness = vi.fn();
vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: (...args) => mockGetCurrentAlertness(...args),
  ALERTNESS_LEVELS: { CALM: 0, AWARE: 1, ALERT: 2, PANIC: 4 },
}));

const mockIsPostDrainCooldown = vi.fn();
vi.mock('../drain.js', () => ({
  isPostDrainCooldown: (...args) => mockIsPostDrainCooldown(...args),
}));

import {
  routeTask,
  releaseBlockedTasks,
  autoFailTimedOutTasks,
  getRampedDispatchMax,
  TASK_TYPE_AGENT_MAP,
  PLATFORM_SKILL_MAP,
} from '../tick-helpers.js';

describe('tick-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckServerResources.mockReturnValue({ metrics: { max_pressure: 0.3 } });
    mockGetCurrentAlertness.mockReturnValue({ level: 0, levelName: 'CALM' });
    mockIsPostDrainCooldown.mockReturnValue(false);
    mockHandleTaskFailure.mockResolvedValue({ quarantined: false, failure_count: 1 });
  });

  // ─── routeTask ─────────────────────────────────────────────
  describe('routeTask', () => {
    it('default task_type → /dev', () => {
      expect(routeTask({ task_type: 'dev' })).toBe('/dev');
      expect(routeTask({})).toBe('/dev'); // 默认 dev
    });

    it('talk → /talk', () => {
      expect(routeTask({ task_type: 'talk' })).toBe('/talk');
    });

    it('qa / audit → /code-review', () => {
      expect(routeTask({ task_type: 'qa' })).toBe('/code-review');
      expect(routeTask({ task_type: 'audit' })).toBe('/code-review');
    });

    it('research → null', () => {
      expect(routeTask({ task_type: 'research' })).toBeNull();
    });

    it('content_publish + 已知平台 → 对应 publisher', () => {
      expect(routeTask({ task_type: 'content_publish', payload: { platform: 'zhihu' } }))
        .toBe('/zhihu-publisher');
      expect(routeTask({ task_type: 'content_publish', payload: { platform: 'douyin' } }))
        .toBe('/douyin-publisher');
    });

    it('content_publish + 未知平台 → null', () => {
      expect(routeTask({ task_type: 'content_publish', payload: { platform: 'unknown' } }))
        .toBeNull();
      expect(routeTask({ task_type: 'content_publish', payload: {} })).toBeNull();
    });

    it('未知 task_type → fallback /dev', () => {
      expect(routeTask({ task_type: 'made_up_type' })).toBe('/dev');
    });

    it('TASK_TYPE_AGENT_MAP / PLATFORM_SKILL_MAP 已 export', () => {
      expect(TASK_TYPE_AGENT_MAP.dev).toBe('/dev');
      expect(PLATFORM_SKILL_MAP.zhihu).toBe('/zhihu-publisher');
    });
  });

  // ─── releaseBlockedTasks ──────────────────────────────────
  describe('releaseBlockedTasks', () => {
    it('返回 SQL 释放的 row 列表', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { task_id: 't1', title: 'A', blocked_reason: 'r1', blocked_duration_ms: 1000 },
          { task_id: 't2', title: 'B', blocked_reason: 'r2', blocked_duration_ms: 2000 },
        ],
      });
      const result = await releaseBlockedTasks();
      expect(result).toHaveLength(2);
      expect(result[0].task_id).toBe('t1');
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE tasks/);
      expect(mockQuery.mock.calls[0][0]).toMatch(/blocked_until <= NOW\(\)/);
    });

    it('无 blocked 任务时返回空数组', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await releaseBlockedTasks();
      expect(result).toEqual([]);
    });
  });

  // ─── autoFailTimedOutTasks ────────────────────────────────
  describe('autoFailTimedOutTasks', () => {
    it('未超时任务不处理', async () => {
      const fresh = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
      const tasks = [{ id: 't1', title: 'fresh', started_at: fresh, payload: {} }];
      const actions = await autoFailTimedOutTasks(tasks);
      expect(actions).toEqual([]);
      expect(mockKillProcess).not.toHaveBeenCalled();
    });

    it('超时任务 → kill + handleTaskFailure + requeue', async () => {
      const old = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90 min ago
      const tasks = [{ id: 't2', title: 'stuck', started_at: old, payload: {} }];

      mockQuery.mockResolvedValue({ rows: [] });
      mockHandleTaskFailure.mockResolvedValueOnce({ quarantined: false, failure_count: 1 });

      const actions = await autoFailTimedOutTasks(tasks);

      expect(mockKillProcess).toHaveBeenCalledWith('t2');
      expect(mockHandleTaskFailure).toHaveBeenCalledWith('t2');
      expect(mockEmit).toHaveBeenCalledWith('patrol_cleanup', 'patrol', expect.any(Object));
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('auto-requeue-timeout');
      expect(actions[0].task_id).toBe('t2');
    });

    it('超时 + quarantine 触发 → action = quarantine', async () => {
      const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
      const tasks = [{ id: 't3', title: 'q-stuck', started_at: old, payload: {} }];

      mockQuery.mockResolvedValue({ rows: [] });
      mockHandleTaskFailure.mockResolvedValueOnce({
        quarantined: true,
        failure_count: 5,
        result: { reason: 'too_many_failures' },
      });

      const actions = await autoFailTimedOutTasks(tasks);
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('quarantine');
      expect(actions[0].reason).toBe('too_many_failures');
    });

    it('无 started_at / run_triggered_at 的任务被跳过', async () => {
      const tasks = [{ id: 't4', title: 'no-time', payload: {} }];
      const actions = await autoFailTimedOutTasks(tasks);
      expect(actions).toEqual([]);
      expect(mockKillProcess).not.toHaveBeenCalled();
    });
  });

  // ─── getRampedDispatchMax ─────────────────────────────────
  describe('getRampedDispatchMax', () => {
    it('cold start：无 ramp_state → 起步 min(2, max)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT empty
      mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT
      const r = await getRampedDispatchMax(9);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(9);
    });

    it('低 pressure + CALM → 加速', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { current_rate: 2 } }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCheckServerResources.mockReturnValue({ metrics: { max_pressure: 0.3 } });
      mockGetCurrentAlertness.mockReturnValue({ level: 0, levelName: 'CALM' });
      const r = await getRampedDispatchMax(9);
      expect(r).toBe(3); // 2 + 1
    });

    it('critical pressure (>0.9) → 强制 1', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { current_rate: 5 } }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCheckServerResources.mockReturnValue({ metrics: { max_pressure: 0.95 } });
      const r = await getRampedDispatchMax(9);
      expect(r).toBe(1);
    });

    it('post-drain cooldown → 强制 1', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { current_rate: 5 } }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockIsPostDrainCooldown.mockReturnValue(true);
      const r = await getRampedDispatchMax(9);
      expect(r).toBe(1);
    });

    it('cap 在 effectiveDispatchMax 内', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { current_rate: 50 } }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const r = await getRampedDispatchMax(3);
      expect(r).toBeLessThanOrEqual(3);
    });
  });
});
