/**
 * System Report Tests - 48h 简报定时检查与生成逻辑
 *
 * 测试覆盖：
 * 1. collectSystemStats - 统计数据收集
 * 2. shouldGenerateReport - 间隔判断
 * 3. generateSystemReport - 完整生成流程（mock LLM）
 * 4. getLatestSystemReport - 获取最新简报
 * 5. tick.js 中的 REPORT_INTERVAL_MS 常量
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mock db pool
// ============================================================
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(() => ({
  query: mockQuery,
  release: mockRelease,
}));

vi.mock('../db.js', () => ({
  default: {
    query: mockQuery,
    connect: mockConnect,
  },
}));

// ============================================================
// Mock callLLM
// ============================================================
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '# Cecelia 48h 系统简报\n\n## 执行摘要\n系统运行正常。' }),
}));

// ============================================================
// Mock other cortex dependencies
// ============================================================
vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {},
  validateDecision: vi.fn(),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
}));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue({}),
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn((s) => s.slice(0, 50)),
}));

vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue({}),
  generateSimilarityHash: vi.fn().mockReturnValue('abc123'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
}));

vi.mock('../policy-validator.js', () => ({
  validatePolicyJson: vi.fn().mockReturnValue({ valid: true, normalized: {} }),
}));

// ============================================================
// Tests
// ============================================================

describe('System Report - cortex.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldGenerateReport', () => {
    it('返回 true 当没有历史记录时', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const { shouldGenerateReport } = await import('../cortex.js');
      const result = await shouldGenerateReport(48 * 60 * 60 * 1000);
      expect(result).toBe(true);
    });

    it('返回 false 当上次生成时间在 48h 内', async () => {
      const recentTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(); // 10h ago
      mockQuery.mockResolvedValueOnce({ rows: [{ generated_at: recentTime }] });
      const { shouldGenerateReport } = await import('../cortex.js');
      const result = await shouldGenerateReport(48 * 60 * 60 * 1000);
      expect(result).toBe(false);
    });

    it('返回 true 当上次生成时间超过 48h', async () => {
      const oldTime = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(); // 50h ago
      mockQuery.mockResolvedValueOnce({ rows: [{ generated_at: oldTime }] });
      const { shouldGenerateReport } = await import('../cortex.js');
      const result = await shouldGenerateReport(48 * 60 * 60 * 1000);
      expect(result).toBe(true);
    });

    it('出错时返回 false 不触发生成', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const { shouldGenerateReport } = await import('../cortex.js');
      const result = await shouldGenerateReport(48 * 60 * 60 * 1000);
      expect(result).toBe(false);
    });
  });

  describe('collectSystemStats', () => {
    it('返回正确格式的统计数据', async () => {
      // Mock all 4 queries in order
      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '10', failed: '2', queued: '5', in_progress: '1', dev_completed: '8', dev_failed: '1' }] })
        .mockResolvedValueOnce({ rows: [{ quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_tokens: '50000', llm_calls: '100' }] })
        .mockResolvedValueOnce({ rows: [{ active_krs: '3', completed_krs: '1', avg_progress: '45' }] });

      const { collectSystemStats } = await import('../cortex.js');
      const stats = await collectSystemStats();

      expect(stats).toHaveProperty('period_hours', 48);
      expect(stats).toHaveProperty('since');
      expect(stats.tasks.completed).toBe(10);
      expect(stats.tasks.failed).toBe(2);
      expect(stats.tasks.queued).toBe(5);
      expect(stats.tasks.dev_completed).toBe(8);
      expect(stats.resources.llm_calls).toBe(100);
      expect(stats.okr.active_krs).toBe(3);
      expect(stats.okr.avg_progress).toBe(45);
    });
  });

  describe('generateSystemReport', () => {
    it('返回包含 content、stats、generated_at 的对象', async () => {
      // Mock collectSystemStats queries
      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '1', queued: '3', in_progress: '0', dev_completed: '4', dev_failed: '1' }] })
        .mockResolvedValueOnce({ rows: [{ quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_tokens: '10000', llm_calls: '50' }] })
        .mockResolvedValueOnce({ rows: [{ active_krs: '2', completed_krs: '0', avg_progress: '30' }] })
        // Mock INSERT into system_reports
        .mockResolvedValueOnce({ rows: [{ id: 'test-report-id-123' }] });

      const { generateSystemReport } = await import('../cortex.js');
      const report = await generateSystemReport();

      expect(report).toHaveProperty('content');
      expect(report).toHaveProperty('stats');
      expect(report).toHaveProperty('generated_at');
      expect(typeof report.content).toBe('string');
      expect(report.content.length).toBeGreaterThan(0);
      expect(report.id).toBe('test-report-id-123');
    });

    it('LLM 失败时使用降级内容', async () => {
      const { callLLM } = await import('../llm-caller.js');
      callLLM.mockRejectedValueOnce(new Error('LLM timeout'));

      mockQuery
        .mockResolvedValueOnce({ rows: [{ completed: '5', failed: '1', queued: '3', in_progress: '0', dev_completed: '4', dev_failed: '1' }] })
        .mockResolvedValueOnce({ rows: [{ quarantined: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_tokens: '10000', llm_calls: '50' }] })
        .mockResolvedValueOnce({ rows: [{ active_krs: '2', completed_krs: '0', avg_progress: '30' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'fallback-report-id' }] });

      const { generateSystemReport } = await import('../cortex.js');
      const report = await generateSystemReport();

      expect(report).toHaveProperty('content');
      expect(report.content).toContain('48h');
    });
  });

  describe('getLatestSystemReport', () => {
    it('返回最新简报', async () => {
      const mockReport = {
        id: 'report-001',
        report_type: '48h_summary',
        content: '# 简报',
        stats: { tasks: {} },
        generated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [mockReport] });

      const { getLatestSystemReport } = await import('../cortex.js');
      const report = await getLatestSystemReport();

      expect(report).toEqual(mockReport);
    });

    it('没有简报时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { getLatestSystemReport } = await import('../cortex.js');
      const report = await getLatestSystemReport();

      expect(report).toBeNull();
    });
  });
});

describe('System Report - tick.js REPORT_INTERVAL_MS', () => {
  it('REPORT_INTERVAL_MS 等于 48 小时的毫秒数', async () => {
    const { REPORT_INTERVAL_MS } = await import('../tick.js');
    expect(REPORT_INTERVAL_MS).toBe(48 * 60 * 60 * 1000);
  });
});
