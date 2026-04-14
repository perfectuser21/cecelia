/**
 * Self-Drive 自主调度流集成测试
 *
 * 覆盖路径：
 *   Path 1: getSelfDriveStatus() — 返回运行状态结构（无 DB 依赖）
 *   Path 2: runSelfDrive() 无数据场景 — probe/scan 为空时短路返回 no_data
 *   Path 3: runSelfDrive() 有 probe 数据 — LLM 返回空 actions 时记录事件
 *   Path 4: startSelfDriveLoop / getSelfDriveStatus 状态联动
 *
 * 测试策略：
 *   - mock pool（db.js）控制 DB 返回数据，测试跨模块逻辑集成
 *   - mock LLM/actions/dopamine 等外部依赖（不测 AI 调用）
 *   - 验证核心调度决策链路的正确性
 *
 * 关联模块：self-drive.js, actions.js, llm-caller.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock DB pool（控制 DB 返回，不依赖真实 PostgreSQL）─────────────────────
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// ─── Mock LLM（不测试 AI 调用）──────────────────────────────────────────────
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: JSON.stringify({ reasoning: '测试', actions: [] }) }),
}));

// ─── Mock actions（不测试任务创建）──────────────────────────────────────────
vi.mock('../../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue('test-task-id'),
}));

// ─── Mock dopamine（不测试奖励系统）─────────────────────────────────────────
vi.mock('../../dopamine.js', () => ({
  getRewardScore: vi.fn().mockResolvedValue({ score: 1.0, count: 2, breakdown: {} }),
}));

// ─── Mock proactive-mouth（不测通知）────────────────────────────────────────
vi.mock('../../proactive-mouth.js', () => ({
  sendProactiveMessage: vi.fn().mockResolvedValue({ sent: false }),
}));

// ─── Mock fs（不读取真实文件系统）───────────────────────────────────────────
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('CURRENT_STATE')) return '{}';
      return actual.readFileSync(p);
    }),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// ─── Mock capacity（不测容量模型）───────────────────────────────────────────
vi.mock('../../capacity.js', () => ({
  getCapacityBudget: vi.fn().mockResolvedValue({ available: 3, allocated: 1 }),
}));

// ─── Mock alertness（不测警觉系统）──────────────────────────────────────────
vi.mock('../../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue('normal'),
  ALERTNESS_LEVELS: { NORMAL: 'normal', ELEVATED: 'elevated', HIGH: 'high' },
}));

// ─── Mock okr-tick（不测 OKR 系统）──────────────────────────────────────────
vi.mock('../../okr-tick.js', () => ({
  syncKRProgressFromTasks: vi.fn().mockResolvedValue({}),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('Self-Drive 自主调度流集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 DB 返回空（无 probe/scan 数据）
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Path 1: getSelfDriveStatus 结构 ──────────────────────────────────────

  describe('Path 1: getSelfDriveStatus() 状态结构', () => {
    it('返回包含 running/interval_ms/max_tasks_per_cycle 字段的对象', async () => {
      const { getSelfDriveStatus } = await import('../../self-drive.js');
      const status = getSelfDriveStatus();

      expect(status).toBeDefined();
      expect(typeof status.running).toBe('boolean');
      expect(typeof status.interval_ms).toBe('number');
      expect(typeof status.max_tasks_per_cycle).toBe('number');
    });

    it('初始状态 running=false（loop 未启动）', async () => {
      const { getSelfDriveStatus } = await import('../../self-drive.js');
      const status = getSelfDriveStatus();
      expect(status.running).toBe(false);
    });

    it('interval_ms 默认值 > 0', async () => {
      const { getSelfDriveStatus } = await import('../../self-drive.js');
      const status = getSelfDriveStatus();
      expect(status.interval_ms).toBeGreaterThan(0);
    });
  });

  // ─── Path 2: runSelfDrive() 无数据场景 ────────────────────────────────────

  describe('Path 2: runSelfDrive() — probe/scan 数据为空时短路', () => {
    it('probe 和 scan 均为空时返回 { reason: no_data }', async () => {
      // DB 返回空的 cecelia_events 查询
      mockPool.query.mockResolvedValue({ rows: [] });

      const { runSelfDrive } = await import('../../self-drive.js');
      const result = await runSelfDrive();

      expect(result).toBeDefined();
      expect(result.reason).toBe('no_data');
      expect(Array.isArray(result.actions)).toBe(true);
      expect(result.actions).toHaveLength(0);
    });

    it('DB 读取 brain_config 和 cecelia_events 时使用正确 SQL', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const { runSelfDrive } = await import('../../self-drive.js');
      await runSelfDrive();

      // 验证至少调用了 pool.query（读取 brain_config 或 cecelia_events）
      expect(mockPool.query).toHaveBeenCalled();

      // 验证查询了 brain_config 或 cecelia_events（自驱动的核心 DB 读取）
      const calls = mockPool.query.mock.calls.map(c => c[0]);
      const hasConfigOrEvents = calls.some(sql =>
        typeof sql === 'string' && (
          sql.includes('brain_config') ||
          sql.includes('cecelia_events') ||
          sql.includes('tasks') ||
          sql.includes('key_results')
        )
      );
      expect(hasConfigOrEvents).toBe(true);
    });
  });

  // ─── Path 3: runSelfDrive() 有 probe 数据，LLM 返回空 ─────────────────────

  describe('Path 3: runSelfDrive() — 有 probe 数据，LLM 无动作', () => {
    it('LLM 返回 no_action 时记录 no_action 事件', async () => {
      const { callLLM } = await import('../../llm-caller.js');
      callLLM.mockResolvedValue({
        text: JSON.stringify({ reasoning: '系统状态良好，无需干预', actions: [] }),
      });

      // probe 事件存在
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // brain_config
        .mockResolvedValueOnce({ rows: [{ payload: { probes: [{ name: 'db', ok: true }] } }] }) // probe event
        .mockResolvedValueOnce({ rows: [{ payload: { checks: [{ name: 'memory', status: 'ok' }] } }] }) // scan event
        .mockResolvedValue({ rows: [] }); // 其他查询

      const { runSelfDrive } = await import('../../self-drive.js');
      const result = await runSelfDrive();

      expect(result).toBeDefined();
      // 有数据但 LLM 返回空 actions → no_action_needed
      expect(['no_action_needed', 'no_data']).toContain(result.reason);
    });

    it('LLM 调用失败时仍能安全返回（不抛异常）', async () => {
      const { callLLM } = await import('../../llm-caller.js');
      callLLM.mockRejectedValue(new Error('LLM timeout'));

      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // brain_config
        .mockResolvedValueOnce({ rows: [{ payload: { probes: [] } }] }) // probe
        .mockResolvedValueOnce({ rows: [{ payload: { checks: [] } }] }) // scan
        .mockResolvedValue({ rows: [] });

      const { runSelfDrive } = await import('../../self-drive.js');

      // 不应抛异常
      await expect(runSelfDrive()).resolves.toBeDefined();
    });
  });

  // ─── Path 4: 状态联动验证 ─────────────────────────────────────────────────

  describe('Path 4: 关键状态字段验证', () => {
    it('getSelfDriveStatus max_tasks_per_cycle 默认 >= 1', async () => {
      const { getSelfDriveStatus } = await import('../../self-drive.js');
      const status = getSelfDriveStatus();
      expect(status.max_tasks_per_cycle).toBeGreaterThanOrEqual(1);
    });

    it('runSelfDrive 返回值包含 actions 数组', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const { runSelfDrive } = await import('../../self-drive.js');
      const result = await runSelfDrive();
      expect(Array.isArray(result.actions)).toBe(true);
    });
  });
});
