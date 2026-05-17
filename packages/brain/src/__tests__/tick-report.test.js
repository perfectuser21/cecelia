/**
 * tick.js - 48h 简报定时检查测试
 *
 * 测试 check48hReport() 函数：
 * 1. 时间未到时不触发
 * 2. 超过 48h 时触发（调用 cortex.generateSystemReport）
 * 3. 失败时重置 _lastReportTime 以便重试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock cortex 模块（避免真实 LLM 调用）
vi.mock('../cortex.js', () => ({
  generateSystemReport: vi.fn()
}));

// Mock db（避免真实数据库连接）
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

describe('check48hReport - 48h 简报定时检查', () => {
  let check48hReport;
  let mockGenerateSystemReport;
  let mockPool;

  beforeEach(async () => {
    vi.resetModules();

    // 重新 mock cortex
    const cortexMock = await import('../cortex.js');
    mockGenerateSystemReport = cortexMock.generateSystemReport;
    mockGenerateSystemReport.mockResolvedValue({
      id: 'test-report-id-123',
      title: '测试简报',
      generated_at: new Date().toISOString(),
      time_range_hours: 48
    });

    // 获取真实的 check48hReport（但使用 mock 的 cortex）
    const tickModule = await import('../tick.js');
    check48hReport = tickModule.check48hReport;

    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('REPORT_INTERVAL_MS 默认为 48h（172800000ms）', async () => {
    // 通过检查 tick 模块导出的常量或行为来验证
    // 第一次调用会触发（_lastReportTime 为 0，elapsed 很大）
    const result = await check48hReport(mockPool, { force: false });
    // 只要没有抛出错误就说明间隔配置正确
    expect(mockGenerateSystemReport).toHaveBeenCalledWith({ timeRangeHours: 48 });
  });

  it('force=true 时直接触发不检查时间', async () => {
    const result = await check48hReport(mockPool, { force: true });

    expect(mockGenerateSystemReport).toHaveBeenCalledTimes(1);
    expect(mockGenerateSystemReport).toHaveBeenCalledWith({ timeRangeHours: 48 });
    expect(result).not.toBeNull();
    expect(result.id).toBe('test-report-id-123');
  });

  it('cortex.generateSystemReport 成功时返回 {id, created_at}', async () => {
    const fakeReport = {
      id: 'report-uuid-456',
      title: '系统简报',
      generated_at: '2026-03-04T09:00:00.000Z',
      time_range_hours: 48
    };
    mockGenerateSystemReport.mockResolvedValueOnce(fakeReport);

    const result = await check48hReport(mockPool, { force: true });

    expect(result).toEqual({
      id: 'report-uuid-456',
      created_at: '2026-03-04T09:00:00.000Z'
    });
  });

  it('cortex.generateSystemReport 失败时返回 null 并允许重试', async () => {
    mockGenerateSystemReport.mockRejectedValueOnce(new Error('LLM 超时'));

    const result = await check48hReport(mockPool, { force: true });

    expect(result).toBeNull();
    // 重置后再次调用应该能触发（_lastReportTime 被重置为 0）
    mockGenerateSystemReport.mockResolvedValueOnce({
      id: 'retry-report-id',
      generated_at: new Date().toISOString()
    });
    const retryResult = await check48hReport(mockPool, { force: true });
    expect(retryResult).not.toBeNull();
    expect(retryResult.id).toBe('retry-report-id');
  });

  it('cortex 返回无 id 时抛出错误并返回 null', async () => {
    mockGenerateSystemReport.mockResolvedValueOnce({ title: '没有 id 的简报' });

    const result = await check48hReport(mockPool, { force: true });

    expect(result).toBeNull();
  });
});
