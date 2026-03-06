/**
 * Tests for alertness/escalation.js
 * 升级机制 - 4级响应体系
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted 确保在 mock factory 中可用
const mockConnect = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockEmit = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({
  default: {
    connect: mockConnect
  }
}));

vi.mock('../../event-bus.js', () => ({
  emit: mockEmit
}));

// 动态导入，确保 mock 先设置
let escalateResponse;
let executeResponse;
let getCurrentResponseLevel;
let getEscalationStatus;

describe('alertness/escalation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // 设置默认 pool.connect() 返回值
    mockRelease.mockImplementation(() => {});
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease
    });

    // 每个测试前重新导入，重置模块状态
    vi.resetModules();

    // 重新注册 mock（resetModules 后需要重新 mock）
    vi.mock('../../db.js', () => ({
      default: { connect: mockConnect }
    }));
    vi.mock('../../event-bus.js', () => ({
      emit: mockEmit
    }));

    const mod = await import('../../alertness/escalation.js');
    escalateResponse = mod.escalateResponse;
    executeResponse = mod.executeResponse;
    getCurrentResponseLevel = mod.getCurrentResponseLevel;
    getEscalationStatus = mod.getEscalationStatus;
  });

  afterEach(() => {
    vi.resetModules();
  });

  // ============================================================
  // getCurrentResponseLevel
  // ============================================================

  describe('getCurrentResponseLevel', () => {
    it('初始状态返回 null', () => {
      const level = getCurrentResponseLevel();
      expect(level).toBeNull();
    });
  });

  // ============================================================
  // getEscalationStatus
  // ============================================================

  describe('getEscalationStatus', () => {
    it('返回初始状态对象', () => {
      const status = getEscalationStatus();
      expect(status).toHaveProperty('level');
      expect(status).toHaveProperty('isActive');
      expect(status).toHaveProperty('startedAt');
      expect(status).toHaveProperty('triggeredBy');
      expect(status).toHaveProperty('actionsExecuted');
      expect(status).toHaveProperty('duration');
    });

    it('初始 isActive 为 false', () => {
      const status = getEscalationStatus();
      expect(status.isActive).toBe(false);
    });

    it('初始 duration 为 0', () => {
      const status = getEscalationStatus();
      expect(status.duration).toBe(0);
    });
  });

  // ============================================================
  // escalateResponse
  // ============================================================

  describe('escalateResponse', () => {
    it('PANIC (4) 时返回 L3 human_intervention', async () => {
      const diagnosis = { summary: '严重异常', issues: [] };
      const result = await escalateResponse(4, diagnosis);
      expect(result.level).toBe('human_intervention');
      expect(Array.isArray(result.actions)).toBe(true);
    });

    it('ALERT (3) 且持续时间短时返回 L1 graceful_degrade', async () => {
      const diagnosis = { summary: '明显异常', issues: [] };
      // 初始状态 startedAt=null，duration=0，< 2分钟
      const result = await escalateResponse(3, diagnosis);
      expect(result.level).toBe('graceful_degrade');
    });

    it('AWARE (2) 时返回 L0 auto_recovery（持续时间短）', async () => {
      const diagnosis = { summary: '轻微异常', issues: [] };
      const result = await escalateResponse(2, diagnosis);
      expect(result.level).toBe('auto_recovery');
    });

    it('CALM (1) 时返回 null（无需响应）', async () => {
      const diagnosis = { summary: '正常', issues: [] };
      const result = await escalateResponse(1, diagnosis);
      expect(result.level).toBeNull();
    });

    it('SLEEPING (0) 时返回 null（无需响应）', async () => {
      const diagnosis = { summary: '休眠', issues: [] };
      const result = await escalateResponse(0, diagnosis);
      expect(result.level).toBeNull();
    });

    it('返回结构包含 level 和 actions', async () => {
      const diagnosis = { summary: '测试', issues: [] };
      const result = await escalateResponse(4, diagnosis);
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('actions');
    });

    it('级别未变化时不重复执行升级', async () => {
      const diagnosis = { summary: '测试', issues: [] };
      // 第一次调用
      await escalateResponse(4, diagnosis);
      const callCount1 = mockEmit.mock.calls.length;
      // 第二次调用，级别相同
      await escalateResponse(4, diagnosis);
      const callCount2 = mockEmit.mock.calls.length;
      // 第二次不应该再触发 emit（级别未变）
      expect(callCount2).toBe(callCount1);
    });

    it('DB 错误时被捕获，不抛出', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));
      const diagnosis = { summary: '测试', issues: [] };
      // 应不抛出，DB 错误被内部捕获
      await expect(escalateResponse(4, diagnosis)).resolves.toBeDefined();
    });
  });

  // ============================================================
  // executeResponse
  // ============================================================

  describe('executeResponse', () => {
    it('无 actions 时直接返回 undefined', async () => {
      const result = await executeResponse({});
      expect(result).toBeUndefined();
    });

    it('空 actions 数组时返回空结果', async () => {
      const result = await executeResponse({ actions: [] });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('monitor action 返回成功结果', async () => {
      const response = {
        actions: [{ type: 'monitor', params: { interval: 60000 } }]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(true);
      expect(results[0].action).toBe('monitor');
    });

    it('collect_metrics action 触发 emit', async () => {
      const response = {
        actions: [{ type: 'collect_metrics', params: { detailed: true } }]
      };
      await executeResponse(response);
      expect(mockEmit).toHaveBeenCalledWith('escalation:collect_metrics', { detailed: true });
    });

    it('未知 action type 返回 null 结果', async () => {
      const response = {
        actions: [{ type: 'unknown_action', params: {} }]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(true);
      expect(results[0].result).toBeNull();
    });

    it('reduce_concurrency action 返回新并发数', async () => {
      const response = {
        actions: [{ type: 'reduce_concurrency', params: { factor: 0.5 } }]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(true);
      expect(results[0].result).toHaveProperty('concurrency');
    });

    it('pause_low_priority action 调用 DB', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });
      const response = {
        actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(true);
      expect(results[0].result.paused).toBe(3);
    });

    it('stop_dispatch action 触发 emit', async () => {
      const response = {
        actions: [{ type: 'stop_dispatch', params: {} }]
      };
      await executeResponse(response);
      expect(mockEmit).toHaveBeenCalledWith('escalation:stop_dispatch');
    });

    it('enable_safe_mode action 触发 safe_mode emit', async () => {
      const response = {
        actions: [{ type: 'enable_safe_mode', params: {} }]
      };
      await executeResponse(response);
      expect(mockEmit).toHaveBeenCalledWith('escalation:safe_mode', { enabled: true });
    });

    it('send_alert action 对各渠道发送告警', async () => {
      const response = {
        actions: [{ type: 'send_alert', params: { channels: ['slack', 'email'] } }]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(true);
      expect(results[0].result.alerted).toEqual(['slack', 'email']);
    });

    it('generate_report action 返回报告对象', async () => {
      const response = {
        actions: [{ type: 'generate_report', params: { detailed: true } }]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(true);
      expect(results[0].result.report).toHaveProperty('timestamp');
    });

    it('stop_all action 触发 emergency_stop emit', async () => {
      const response = {
        actions: [{ type: 'stop_all', params: {} }]
      };
      await executeResponse(response);
      expect(mockEmit).toHaveBeenCalledWith('escalation:emergency_stop');
    });

    it('action 抛出异常时记录失败但继续执行后续 action', async () => {
      // pause_low_priority 的 DB 调用抛出错误
      mockQuery
        .mockRejectedValueOnce(new Error('DB error')) // pause_low_priority 失败
        .mockResolvedValue({ rows: [], rowCount: 0 }); // updateEscalationActions 成功

      const response = {
        actions: [
          { type: 'pause_low_priority', params: { priorities: ['P2'] } },
          { type: 'monitor', params: { interval: 60000 } }
        ]
      };
      const results = await executeResponse(response);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
      expect(results[1].success).toBe(true);
    });
  });
});
