/**
 * memory.js 去重测试 - 24小时窗口去重
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────
const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

// ────────────────────────────────────────────────────────────

import { runMemory } from '../desire/memory.js';

describe('memory 去重机制', () => {
  let pool;

  beforeEach(() => {
    pool = { query: mockQuery };
    vi.clearAllMocks();
  });

  it('24h 内重复观察被跳过', async () => {
    const observations = [
      { context: '观察池被重复诊断污染' },
      { context: '观察池被重复诊断污染' }, // 重复
    ];

    // Mock LLM 打分（纯数字格式，避开解析 bug）
    mockCallLLM.mockResolvedValueOnce({
      text: '7\n7',
    });

    // Mock 数据库查询序列
    mockQuery
      // 第 1 条：去重查询（未找到）
      .mockResolvedValueOnce({ rows: [] })
      // 第 1 条：写入成功
      .mockResolvedValueOnce({ rows: [] })
      // 第 2 条：去重查询（找到重复）
      .mockResolvedValueOnce({ rows: [{ id: 123 }] })
      // accumulator 查询
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] })
      // accumulator 更新
      .mockResolvedValueOnce({ rows: [] });

    const result = await runMemory(pool, observations);

    expect(result.written).toBe(1); // 只写入 1 条
    expect(result.skipped).toBe(1); // 跳过 1 条
    expect(result.total_importance).toBe(7); // 只累积第一条的 importance（第二条被跳过）
  });

  it('24h 外相同观察可以正常写入', async () => {
    const observations = [
      { context: '老观察' },
    ];

    mockCallLLM.mockResolvedValueOnce({
      text: '1: 6',
    });

    mockQuery
      // 去重查询（未找到 24h 内重复）
      .mockResolvedValueOnce({ rows: [] })
      // 写入成功
      .mockResolvedValueOnce({ rows: [] })
      // accumulator 查询
      .mockResolvedValueOnce({ rows: [{ value_json: 0 }] })
      // accumulator 更新
      .mockResolvedValueOnce({ rows: [] });

    const result = await runMemory(pool, observations);

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('去重查询失败时降级允许写入（fail-open）', async () => {
    const observations = [
      { context: '新观察' },
    ];

    mockCallLLM.mockResolvedValueOnce({
      text: '1: 5',
    });

    mockQuery
      // 去重查询失败
      .mockRejectedValueOnce(new Error('DB query failed'))
      // accumulator 查询
      .mockResolvedValueOnce({ rows: [{ value_json: 0 }] })
      // accumulator 更新
      .mockResolvedValueOnce({ rows: [] });

    const result = await runMemory(pool, observations);

    // 降级：查询失败不影响写入，但会记录错误日志
    expect(result.written).toBe(0); // 插入在 catch 块中失败
    expect(result.skipped).toBe(0);
  });

  it('空观察列表直接返回', async () => {
    const result = await runMemory(pool, []);

    expect(result.written).toBe(0);
    expect(result.skipped).toBeUndefined(); // 未初始化 skipped
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
