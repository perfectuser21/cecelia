/**
 * Report Scheduler 单元测试
 *
 * 覆盖：
 * - checkShouldGenerateReport：时间窗口检查逻辑
 * - generateSystemReport：简报生成结构验证
 * - saveReport：数据库写入验证
 * - runReportSchedulerIfNeeded：主流程（生成/跳过）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() 解决 vi.mock factory 提升问题
const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

const { mockBroadcast } = vi.hoisted(() => {
  const mockBroadcast = vi.fn();
  return { mockBroadcast };
});

vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../websocket.js', () => ({
  broadcast: mockBroadcast,
  WS_EVENTS: {
    SYSTEM_REPORT: 'system:report'
  }
}));

import {
  getLastReportTime,
  checkShouldGenerateReport,
  generateSystemReport,
  saveReport,
  updateLastReportTime,
  pushReportToFrontend,
  runReportSchedulerIfNeeded,
  LAST_REPORT_KEY
} from '../report-scheduler.js';

describe('Report Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getLastReportTime ──────────────────────────────────

  describe('getLastReportTime', () => {
    it('返回 null 当没有记录时', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getLastReportTime({ query: mockQuery });
      expect(result).toBeNull();
    });

    it('返回 Date 当有记录时', async () => {
      const ts = new Date('2026-03-01T00:00:00Z').toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { timestamp: ts } }]
      });
      const result = await getLastReportTime({ query: mockQuery });
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe(ts);
    });

    it('返回 null 当 value_json 没有 timestamp 字段时', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { other: 'data' } }]
      });
      const result = await getLastReportTime({ query: mockQuery });
      expect(result).toBeNull();
    });
  });

  // ── checkShouldGenerateReport ──────────────────────────

  describe('checkShouldGenerateReport', () => {
    it('should=true 当没有上次记录时', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await checkShouldGenerateReport({ query: mockQuery });
      expect(result.should).toBe(true);
      expect(result.reason).toBe('no_previous_report');
    });

    it('should=true 当超过间隔时间时', async () => {
      // 上次报告时间设为 72h 前（超过 48h）
      const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { timestamp: ts } }]
      });
      const result = await checkShouldGenerateReport({ query: mockQuery });
      expect(result.should).toBe(true);
      expect(result.reason).toBe('interval_elapsed');
    });

    it('should=false 当未超过间隔时间时', async () => {
      // 上次报告时间设为 1h 前（未超过 48h）
      const ts = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({
        rows: [{ value_json: { timestamp: ts } }]
      });
      const result = await checkShouldGenerateReport({ query: mockQuery });
      expect(result.should).toBe(false);
      expect(result.reason).toBe('too_soon');
      expect(result.next_report_in_ms).toBeGreaterThan(0);
    });
  });

  // ── generateSystemReport ──────────────────────────────

  describe('generateSystemReport', () => {
    it('返回正确的简报结构', async () => {
      // Mock 5 个并发查询
      mockQuery
        // 1. 任务统计
        .mockResolvedValueOnce({
          rows: [{ completed: '10', failed: '2', queued: '5', in_progress: '3', quarantined: '0' }]
        })
        // 2. 关键事件
        .mockResolvedValueOnce({ rows: [
          { event_type: 'task_completed', source: 'tick', payload: {}, created_at: new Date() }
        ]})
        // 3. 报警等级
        .mockResolvedValueOnce({
          rows: [{ value_json: { level: 1, level_name: 'NORMAL' } }]
        })
        // 4. Token 费用
        .mockResolvedValueOnce({
          rows: [{ total_cost_usd: '2.50', api_calls: '100' }]
        })
        // 5. OKR 目标
        .mockResolvedValueOnce({ rows: [
          { title: 'KR1', status: 'in_progress', priority: 'P0', progress: 60, project_name: 'cecelia' }
        ]});

      const report = await generateSystemReport({ query: mockQuery });

      expect(report).toHaveProperty('type', 'system_report');
      expect(report).toHaveProperty('period');
      expect(report.period).toHaveProperty('from');
      expect(report.period).toHaveProperty('to');
      expect(report.period).toHaveProperty('hours');
      expect(report).toHaveProperty('system_health');
      expect(report).toHaveProperty('task_stats');
      expect(report.task_stats.completed).toBe(10);
      expect(report.task_stats.failed).toBe(2);
      expect(report.task_stats.success_rate).toBe(83); // 10/(10+2) = 83%
      expect(report).toHaveProperty('goals_progress');
      expect(report).toHaveProperty('generated_at');
    });

    it('system_health=healthy 当没有失败时', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '0', queued: '3', in_progress: '2', quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cost_usd: '0', api_calls: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const report = await generateSystemReport({ query: mockQuery });
      expect(report.system_health).toBe('healthy');
    });

    it('system_health=warning 当有失败但未超过完成数时', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '1', queued: '0', in_progress: '1', quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cost_usd: '0', api_calls: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const report = await generateSystemReport({ query: mockQuery });
      expect(report.system_health).toBe('warning');
    });

    it('system_health=critical 当失败超过完成时', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '1', failed: '5', queued: '0', in_progress: '0', quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cost_usd: '0', api_calls: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const report = await generateSystemReport({ query: mockQuery });
      expect(report.system_health).toBe('critical');
    });

    it('success_rate=null 当没有完成或失败任务时', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '0', failed: '0', queued: '3', in_progress: '2', quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cost_usd: '0', api_calls: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const report = await generateSystemReport({ query: mockQuery });
      expect(report.task_stats.success_rate).toBeNull();
    });

    it('查询失败时降级为默认值', async () => {
      // 所有查询都失败
      mockQuery.mockRejectedValue(new Error('DB error'));

      // 不应该抛出，应该降级
      const report = await generateSystemReport({ query: mockQuery });
      expect(report.task_stats.completed).toBe(0);
      expect(report.key_events).toEqual([]);
    });
  });

  // ── saveReport ────────────────────────────────────────

  describe('saveReport', () => {
    it('写入 daily_logs 并返回 id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'test-uuid-123' }] });

      const report = { type: 'system_report', generated_at: new Date().toISOString() };
      const result = await saveReport({ query: mockQuery }, report);

      expect(result.id).toBe('test-uuid-123');
      expect(result.created).toBe(true);

      // 验证 INSERT 语句使用了正确的 type（system_report 是 SQL 字面值，不是参数）
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO daily_logs');
      expect(callArgs[0]).toContain("'system_report'"); // type 写在 SQL 里
    });
  });

  // ── updateLastReportTime ──────────────────────────────

  describe('updateLastReportTime', () => {
    it('更新 working_memory', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await updateLastReportTime({ query: mockQuery }, new Date());

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO working_memory');
      expect(callArgs[1][0]).toBe(LAST_REPORT_KEY);
    });
  });

  // ── pushReportToFrontend ──────────────────────────────

  describe('pushReportToFrontend', () => {
    it('调用 broadcast 发送简报', () => {
      const report = {
        system_health: 'healthy',
        period: { from: 'a', to: 'b', hours: 48 },
        task_stats: { completed: 5, failed: 1, queued: 2, success_rate: 83 },
        generated_at: new Date().toISOString()
      };

      pushReportToFrontend(report, 'test-id');

      expect(mockBroadcast).toHaveBeenCalledOnce();
      const callArgs = mockBroadcast.mock.calls[0];
      expect(callArgs[0]).toBe('system:report');
      expect(callArgs[1].id).toBe('test-id');
      expect(callArgs[1].system_health).toBe('healthy');
    });

    it('broadcast 异常时不抛出', () => {
      mockBroadcast.mockImplementation(() => { throw new Error('WS error'); });

      const report = {
        system_health: 'healthy',
        period: {},
        task_stats: { completed: 0, failed: 0, queued: 0, success_rate: null },
        generated_at: new Date().toISOString()
      };

      expect(() => pushReportToFrontend(report, 'test-id')).not.toThrow();
    });
  });

  // ── runReportSchedulerIfNeeded ────────────────────────

  describe('runReportSchedulerIfNeeded', () => {
    it('跳过当未到达间隔时间', async () => {
      // getLastReportTime 返回 1h 前
      const ts = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce({ rows: [{ value_json: { timestamp: ts } }] });

      const result = await runReportSchedulerIfNeeded({ query: mockQuery });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('too_soon');
    });

    it('生成简报当达到间隔时间', async () => {
      // getLastReportTime 返回 72h 前（超过 48h）
      const ts = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

      mockQuery
        // checkShouldGenerateReport -> getLastReportTime
        .mockResolvedValueOnce({ rows: [{ value_json: { timestamp: ts } }] })
        // generateSystemReport: 5 个查询
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '0', queued: '3', in_progress: '1', quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cost_usd: '1.0', api_calls: '50' }] })
        .mockResolvedValueOnce({ rows: [] })
        // saveReport -> INSERT INTO daily_logs
        .mockResolvedValueOnce({ rows: [{ id: 'report-id-abc' }] })
        // updateLastReportTime -> INSERT INTO working_memory
        .mockResolvedValueOnce({ rows: [] });

      const result = await runReportSchedulerIfNeeded({ query: mockQuery });

      expect(result.skipped).toBe(false);
      expect(result.ok).toBe(true);
      expect(result.report_id).toBe('report-id-abc');
      expect(mockBroadcast).toHaveBeenCalledOnce();
    });

    it('当没有上次记录时生成简报（首次运行）', async () => {
      mockQuery
        // checkShouldGenerateReport -> getLastReportTime (无记录)
        .mockResolvedValueOnce({ rows: [] })
        // generateSystemReport: 5 个查询
        .mockResolvedValueOnce({ rows: [{ completed: '0', failed: '0', queued: '0', in_progress: '0', quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_cost_usd: '0', api_calls: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        // saveReport
        .mockResolvedValueOnce({ rows: [{ id: 'first-report-id' }] })
        // updateLastReportTime
        .mockResolvedValueOnce({ rows: [] });

      const result = await runReportSchedulerIfNeeded({ query: mockQuery });

      expect(result.ok).toBe(true);
      expect(result.report_id).toBe('first-report-id');
    });
  });
});
