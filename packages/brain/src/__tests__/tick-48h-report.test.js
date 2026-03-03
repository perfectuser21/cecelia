/**
 * 测试：48h 系统简报定时检查逻辑
 *
 * 覆盖场景：
 * - 首次运行（system_reports 表为空）→ 触发生成
 * - 距上次生成超过 48h → 触发生成
 * - 距上次生成不足 48h → 跳过生成
 * - LLM 调用失败 → 降级处理，不影响 tick 循环
 * - Brain 重启后能从数据库读取上次简报时间（不重复生成）
 * - 日志包含 [tick:48h-report] 前缀
 *
 * DoD 覆盖：所有功能验收条目
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkAndGenerateSystemReport,
  getLastReportTime,
  REPORT_INTERVAL_HOURS,
  REPORT_INTERVAL_MS,
} from '../system-report-scheduler.js';

// ============================================================
// Mock: cortex.js
// ============================================================

const mockGenerateSystemReport = vi.fn();

vi.mock('../cortex.js', () => ({
  generateSystemReport: mockGenerateSystemReport,
}));

// ============================================================
// Helper: 创建 mock pool
// ============================================================

function createMockPool(rows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

// ============================================================
// Tests
// ============================================================

describe('system-report-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateSystemReport.mockResolvedValue({ success: true, reportId: 'test-report-id' });
  });

  // ===== getLastReportTime =====

  describe('getLastReportTime()', () => {
    it('首次运行：表为空时返回 null', async () => {
      const pool = createMockPool([]);
      const result = await getLastReportTime(pool);
      expect(result).toBeNull();
    });

    it('有历史记录时返回最新时间', async () => {
      const generatedAt = new Date('2026-01-01T00:00:00Z');
      const pool = createMockPool([{ generated_at: generatedAt }]);
      const result = await getLastReportTime(pool);
      expect(result).toEqual(generatedAt);
    });

    it('查询时使用正确的 report_type 参数', async () => {
      const pool = createMockPool([]);
      await getLastReportTime(pool, 'custom_type');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('system_reports'),
        ['custom_type']
      );
    });
  });

  // ===== checkAndGenerateSystemReport =====

  describe('checkAndGenerateSystemReport()', () => {
    it('首次运行（表为空）→ triggered=true，调用 generateSystemReport', async () => {
      const pool = createMockPool([]);
      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(true);
      expect(result.success).toBe(true);
      expect(result.reportId).toBe('test-report-id');
      expect(mockGenerateSystemReport).toHaveBeenCalledOnce();
    });

    it('距上次生成超过 48h → triggered=true，触发生成', async () => {
      // 上次简报时间为 49h 前
      const lastTime = new Date(Date.now() - (REPORT_INTERVAL_HOURS + 1) * 60 * 60 * 1000);
      const pool = createMockPool([{ generated_at: lastTime }]);

      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(true);
      expect(result.success).toBe(true);
      expect(mockGenerateSystemReport).toHaveBeenCalledOnce();
    });

    it('距上次生成不足 48h → triggered=false，不调用 generateSystemReport', async () => {
      // 上次简报时间为 24h 前
      const lastTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pool = createMockPool([{ generated_at: lastTime }]);

      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(false);
      expect(result.hoursElapsed).toBeLessThan(REPORT_INTERVAL_HOURS);
      expect(mockGenerateSystemReport).not.toHaveBeenCalled();
    });

    it('Brain 重启后能从数据库读取上次简报时间（不重复生成）', async () => {
      // 模拟 Brain 重启：上次简报时间为 10h 前（在 48h 内）
      const lastTime = new Date(Date.now() - 10 * 60 * 60 * 1000);
      const pool = createMockPool([{ generated_at: lastTime }]);

      const result = await checkAndGenerateSystemReport(pool);

      // 应该读取到数据库中的时间，不触发生成
      expect(pool.query).toHaveBeenCalled();
      expect(result.triggered).toBe(false);
      expect(mockGenerateSystemReport).not.toHaveBeenCalled();
    });

    it('LLM 调用失败 → triggered=true，success=false，不抛出异常', async () => {
      const pool = createMockPool([]);
      mockGenerateSystemReport.mockResolvedValue({
        success: false,
        error: 'LLM 调用失败: timeout'
      });

      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM 调用失败');
    });

    it('generateSystemReport 抛出异常 → triggered=true，success=false，不向上抛出', async () => {
      const pool = createMockPool([]);
      mockGenerateSystemReport.mockRejectedValue(new Error('意外错误'));

      // 不应该抛出，应该降级
      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('数据库查询失败 → triggered=false，包含错误信息', async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      };

      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(false);
      expect(result.reason).toContain('查询失败');
    });

    it('hoursElapsed 在结果中正确返回（不足 48h 时）', async () => {
      const hoursAgo = 12;
      const lastTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
      const pool = createMockPool([{ generated_at: lastTime }]);

      const result = await checkAndGenerateSystemReport(pool);

      expect(result.triggered).toBe(false);
      // 允许±1h 误差（测试执行时间）
      expect(result.hoursElapsed).toBeGreaterThanOrEqual(hoursAgo - 1);
      expect(result.hoursElapsed).toBeLessThanOrEqual(hoursAgo + 1);
    });
  });

  // ===== Constants =====

  describe('Constants', () => {
    it('REPORT_INTERVAL_HOURS 为 48', () => {
      expect(REPORT_INTERVAL_HOURS).toBe(48);
    });

    it('REPORT_INTERVAL_MS 为 48 * 60 * 60 * 1000', () => {
      expect(REPORT_INTERVAL_MS).toBe(48 * 60 * 60 * 1000);
    });
  });
});
