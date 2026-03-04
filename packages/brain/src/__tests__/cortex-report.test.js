/**
 * cortex.js - generateSystemReport() 单元测试
 *
 * 测试系统简报生成功能：
 * 1. 调用 LLM 生成中文 Markdown 简报
 * 2. 正确收集并组装 KR、任务统计、健康状态数据
 * 3. LLM 失败时降级生成基础简报
 * 4. 简报保存到 system_reports 表
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db 模块
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

// Mock llm-caller
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn()
}));

describe('cortex.generateSystemReport - 系统简报生成', () => {
  let generateSystemReport;
  let mockPool;
  let mockCallLLM;

  const mockLLMResponse = JSON.stringify({
    title: '系统简报 2026-03-04 (48h)',
    summary: '过去 48 小时系统运行稳定，共完成 25 个任务。',
    kr_progress: {
      overview: 'OKR 进展良好',
      highlights: ['Task Management System 完成 3 个子任务'],
      concerns: []
    },
    task_stats: {
      analysis: '完成率 83%，较上期提升 5%',
      bottlenecks: []
    },
    system_health: {
      status: 'healthy',
      assessment: 'Tick Loop 运行正常，资源充足'
    },
    risks: [],
    recommendations: ['继续当前节奏，保持高完成率'],
    confidence: 0.85
  });

  beforeEach(async () => {
    vi.resetModules();

    const dbMock = await import('../db.js');
    mockPool = dbMock.default;

    // 默认 mock 返回
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('goals')) {
        return Promise.resolve({ rows: [{ id: 'kr-1', title: 'Task Management', status: 'in_progress', progress: 30, completed_tasks: 5, failed_tasks: 1, queued_tasks: 10 }] });
      }
      if (sql.includes('tasks') && sql.includes('COUNT')) {
        return Promise.resolve({ rows: [{ completed: '25', failed: '5', queued: '10', in_progress: '2', quarantined: '1', failure_rate_pct: '16.7' }] });
      }
      if (sql.includes('working_memory')) {
        return Promise.resolve({ rows: [{ key: 'tick_enabled', value_json: { enabled: true } }] });
      }
      if (sql.includes('failed') && sql.includes('order')) {
        return Promise.resolve({ rows: [{ title: '失败任务1', task_type: 'dev', error_message: '超时', updated_at: new Date() }] });
      }
      if (sql.includes('cortex_analyses')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('INSERT INTO system_reports')) {
        return Promise.resolve({ rows: [{ id: 'saved-report-uuid' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const llmMock = await import('../llm-caller.js');
    mockCallLLM = llmMock.callLLM;
    mockCallLLM.mockResolvedValue({ text: mockLLMResponse });

    const cortexModule = await import('../cortex.js');
    generateSystemReport = cortexModule.generateSystemReport;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功生成简报并返回含 id 的结果', async () => {
    const result = await generateSystemReport({ timeRangeHours: 48 });

    expect(result).toBeDefined();
    expect(result.id).toBe('saved-report-uuid');
    expect(result.time_range_hours).toBe(48);
    expect(result.generated_at).toBeDefined();
  });

  it('调用 LLM 时传入中文 prompt', async () => {
    await generateSystemReport({ timeRangeHours: 48 });

    expect(mockCallLLM).toHaveBeenCalledWith(
      'cortex',
      expect.stringContaining('系统简报'),
      expect.any(Object)
    );
  });

  it('LLM 返回内容包含 title, summary, system_health', async () => {
    const result = await generateSystemReport({ timeRangeHours: 48 });

    expect(result.title).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.system_health).toBeDefined();
  });

  it('LLM 失败时降级生成基础简报（不抛异常）', async () => {
    mockCallLLM.mockRejectedValueOnce(new Error('网络超时'));

    const result = await generateSystemReport({ timeRangeHours: 48 });

    // 降级后仍然有 summary 字段
    expect(result).toBeDefined();
    expect(result.summary).toBeDefined();
    // confidence 应较低
    expect(result.confidence).toBeLessThanOrEqual(0.2);
  });

  it('简报保存到 system_reports 表，类型为 48h_summary', async () => {
    await generateSystemReport({ timeRangeHours: 48 });

    const insertCall = mockPool.query.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO system_reports')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe('48h_summary'); // type 字段
  });

  it('数据库保存失败时仍返回报告内容（id 为 null）', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO system_reports')) {
        return Promise.reject(new Error('DB 连接失败'));
      }
      if (sql.includes('goals')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await generateSystemReport({ timeRangeHours: 48 });

    expect(result).toBeDefined();
    expect(result.id).toBeNull();
    expect(result.summary).toBeDefined();
  });
});
