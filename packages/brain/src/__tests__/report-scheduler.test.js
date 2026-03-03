/**
 * 单元测试：report-scheduler.js
 *
 * 测试覆盖：
 * D1: checkScheduledReport - 首次报告（无历史记录）
 * D2: checkScheduledReport - 未到时间，跳过
 * D3: checkScheduledReport - 已到时间，触发生成
 * D4: generateSystemReport - 基础统计数据
 * D5: REPORT_INTERVAL_HOURS 环境变量设置为 0 时立即触发
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 依赖模块
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: 'Mock LLM summary' }),
}));

vi.mock('../websocket.js', () => ({
  broadcast: vi.fn(),
}));

describe('report-scheduler', () => {
  let pool;
  let broadcast;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // 重新导入 mock 模块
    const dbMod = await import('../db.js');
    pool = dbMod.default;

    const wsMod = await import('../websocket.js');
    broadcast = wsMod.broadcast;
  });

  afterEach(() => {
    // 清除环境变量修改
    delete process.env.REPORT_INTERVAL_HOURS;
  });

  describe('D1: 首次报告（无历史记录）', () => {
    it('当 working_memory 中无 last_report_time 时，应立即生成报告', async () => {
      // Mock: 无历史记录
      pool.query.mockImplementation((sql, params) => {
        if (sql.includes('working_memory') && sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO working_memory')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO reports')) {
          return Promise.resolve({ rows: [{ id: 'test-report-id-1' }] });
        }
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return Promise.resolve({
            rows: [{ completed: '10', failed: '2', quarantined: '0', total: '12', active: '3' }],
          });
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('cecelia_events')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('UPDATE reports')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { checkScheduledReport } = await import('../report-scheduler.js');
      const result = await checkScheduledReport(pool);

      expect(result).toBe(true);
      // 应该保存了报告到数据库
      const insertCall = pool.query.mock.calls.find(
        ([sql]) => sql.includes('INSERT INTO reports')
      );
      expect(insertCall).toBeTruthy();
    });
  });

  describe('D2: 未到时间，跳过', () => {
    it('距上次报告不足 48h 时，不应触发生成', async () => {
      const recentTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24h 前

      pool.query.mockImplementation((sql) => {
        if (sql.includes('working_memory') && sql.includes('SELECT')) {
          return Promise.resolve({
            rows: [{ value_json: { timestamp: recentTimestamp } }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const { checkScheduledReport } = await import('../report-scheduler.js');
      const result = await checkScheduledReport(pool);

      expect(result).toBe(false);
      // 不应该有 INSERT INTO reports
      const insertCall = pool.query.mock.calls.find(
        ([sql]) => sql.includes('INSERT INTO reports')
      );
      expect(insertCall).toBeUndefined();
    });
  });

  describe('D3: 已到时间，触发生成', () => {
    it('距上次报告超过 48h 时，应触发生成', async () => {
      const oldTimestamp = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(); // 49h 前

      pool.query.mockImplementation((sql) => {
        if (sql.includes('working_memory') && sql.includes('SELECT')) {
          return Promise.resolve({
            rows: [{ value_json: { timestamp: oldTimestamp } }],
          });
        }
        if (sql.includes('INSERT INTO working_memory') || sql.includes('DO UPDATE SET')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO reports')) {
          return Promise.resolve({ rows: [{ id: 'test-report-id-3' }] });
        }
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return Promise.resolve({
            rows: [{ completed: '5', failed: '1', quarantined: '0', total: '6', active: '2' }],
          });
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('cecelia_events')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('UPDATE reports')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { checkScheduledReport } = await import('../report-scheduler.js');
      const result = await checkScheduledReport(pool);

      expect(result).toBe(true);
    });
  });

  describe('D4: generateSystemReport 基础数据', () => {
    it('生成报告时应包含正确的任务统计', async () => {
      pool.query.mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return Promise.resolve({
            rows: [{ completed: '20', failed: '3', quarantined: '1', total: '24', active: '5' }],
          });
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY')) {
          return Promise.resolve({
            rows: [
              { status: 'queued', cnt: '2' },
              { status: 'in_progress', cnt: '3' },
            ],
          });
        }
        if (sql.includes('cecelia_events')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO reports')) {
          return Promise.resolve({ rows: [{ id: 'test-report-d4' }] });
        }
        if (sql.includes('UPDATE reports')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { generateSystemReport } = await import('../report-scheduler.js');
      const report = await generateSystemReport(pool);

      expect(report.tasks_completed).toBe(20);
      expect(report.tasks_failed).toBe(3);
      expect(report.tasks_total).toBe(24);
      expect(report.health_status).toMatch(/healthy|degraded|critical/);
      expect(report.summary).toBeTruthy();
    });
  });

  describe('D5: REPORT_INTERVAL_HOURS=0 时立即触发', () => {
    it('设置 REPORT_INTERVAL_HOURS=0 时，距上次任意时间都应触发', async () => {
      process.env.REPORT_INTERVAL_HOURS = '0';

      // 刚刚生成过（1 分钟前）
      const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString();

      pool.query.mockImplementation((sql) => {
        if (sql.includes('working_memory') && sql.includes('SELECT')) {
          return Promise.resolve({
            rows: [{ value_json: { timestamp: recentTimestamp } }],
          });
        }
        if (sql.includes('INSERT INTO working_memory') || sql.includes('DO UPDATE SET')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO reports')) {
          return Promise.resolve({ rows: [{ id: 'test-report-d5' }] });
        }
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return Promise.resolve({
            rows: [{ completed: '1', failed: '0', quarantined: '0', total: '1', active: '0' }],
          });
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('cecelia_events')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('UPDATE reports')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { checkScheduledReport } = await import('../report-scheduler.js');
      const result = await checkScheduledReport(pool);

      expect(result).toBe(true);
    });
  });

  describe('D6: LLM 失败时降级', () => {
    it('LLM 调用失败时，应使用降级摘要（stats_only）', async () => {
      const { callLLM } = await import('../llm-caller.js');
      callLLM.mockRejectedValue(new Error('LLM service unavailable'));

      pool.query.mockImplementation((sql) => {
        if (sql.includes('FROM tasks') && sql.includes('COUNT')) {
          return Promise.resolve({
            rows: [{ completed: '5', failed: '2', quarantined: '0', total: '7', active: '1' }],
          });
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('cecelia_events')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO reports')) {
          return Promise.resolve({ rows: [{ id: 'test-report-d6' }] });
        }
        if (sql.includes('UPDATE reports')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { generateSystemReport } = await import('../report-scheduler.js');
      const report = await generateSystemReport(pool);

      // 降级时仍然应该返回报告
      expect(report.generated_by).toBe('stats_only');
      expect(report.summary).toContain('简报');
    });
  });
});
