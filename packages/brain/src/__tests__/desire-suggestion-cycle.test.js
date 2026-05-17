/**
 * desire-suggestion-cycle.test.js
 *
 * 测试 suggestion-cycle.js 的三个核心函数：
 * - getActiveDesiresForSuggestion
 * - buildSuggestionPrompt
 * - runSuggestionCycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// ── Mock createSuggestion（避免真实 DB 写入）──────────────

const mockCreateSuggestion = vi.hoisted(() => vi.fn());
vi.mock('../suggestion-triage.js', () => ({
  createSuggestion: mockCreateSuggestion,
}));

// ── 导入被测模块 ──────────────────────────────────────────

import { getActiveDesiresForSuggestion, buildSuggestionPrompt, runSuggestionCycle } from '../suggestion-cycle.js';

// ── 测试：getActiveDesiresForSuggestion ───────────────────

describe('getActiveDesiresForSuggestion', () => {
  it('查询 status=pending、urgency>=7 的 desires，最多5条', async () => {
    const querySpy = vi.fn().mockResolvedValue({
      rows: [
        { id: 'uuid-1', type: 'propose', content: '建议优化任务调度', urgency: 8 },
        { id: 'uuid-2', type: 'warn', content: '任务堆积过多', urgency: 9 },
      ],
    });
    const mockPool = { query: querySpy };

    const result = await getActiveDesiresForSuggestion(mockPool);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('建议优化任务调度');

    // 验证 SQL 包含关键过滤条件
    const [sql, params] = querySpy.mock.calls[0];
    expect(sql).toContain('pending');
    expect(sql).toContain('urgency');
    expect(params).toContain(5); // LIMIT 5
    expect(params).toContain(7); // urgency >= 7
  });

  it('无 active desires 时返回空数组', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await getActiveDesiresForSuggestion(mockPool);
    expect(result).toEqual([]);
  });
});

// ── 测试：buildSuggestionPrompt ───────────────────────────

describe('buildSuggestionPrompt', () => {
  it('无 desires 时返回纯上下文 prompt（不含欲望章节）', () => {
    const context = '当前系统状态：任务队列正常';
    const prompt = buildSuggestionPrompt(context, []);

    expect(prompt).toContain(context);
    expect(prompt).not.toContain('当前欲望');
  });

  it('有 desires 时注入欲望上下文', () => {
    const context = '当前系统状态：任务队列正常';
    const desires = [
      { type: 'propose', content: '建议优化任务调度', urgency: 8 },
      { type: 'warn', content: '任务堆积过多', urgency: 9 },
    ];
    const prompt = buildSuggestionPrompt(context, desires);

    expect(prompt).toContain(context);
    expect(prompt).toContain('建议优化任务调度');
    expect(prompt).toContain('任务堆积过多');
  });

  it('single desire 时 prompt 包含该 desire 内容', () => {
    const context = '当前系统状态';
    const desires = [{ type: 'celebrate', content: '完成了重要里程碑', urgency: 7 }];
    const prompt = buildSuggestionPrompt(context, desires);

    expect(prompt).toContain('完成了重要里程碑');
  });
});

// ── 测试：runSuggestionCycle ──────────────────────────────

describe('runSuggestionCycle', () => {
  beforeEach(() => {
    mockCreateSuggestion.mockReset();
    mockCreateSuggestion.mockResolvedValue({ id: 'sug-001', priority_score: 0.75 });
  });

  it('有 active desires 时创建 suggestion', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'uuid-1', type: 'propose', content: '建议优化任务调度', urgency: 8 }],
      }),
    };

    const result = await runSuggestionCycle(mockPool);

    expect(mockCreateSuggestion).toHaveBeenCalledTimes(1);
    const callArg = mockCreateSuggestion.mock.calls[0][0];
    expect(callArg.source).toBe('desire_system');
    expect(callArg.content).toContain('建议优化任务调度');
    expect(result.created).toBe(1);
  });

  it('无 active desires 时跳过，不创建 suggestion', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const result = await runSuggestionCycle(mockPool);

    expect(mockCreateSuggestion).not.toHaveBeenCalled();
    expect(result.skipped).toBe('no_active_desires');
  });
});
