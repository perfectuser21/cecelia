/**
 * 反思模块测试 - 静默期机制
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockGenerateL0Summary = vi.hoisted(() => vi.fn());
const mockGenerateMemoryStreamL1Async = vi.hoisted(() => vi.fn());
const mockGenerateMemoryStreamEmbeddingAsync = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: mockGenerateL0Summary,
  generateMemoryStreamL1Async: mockGenerateMemoryStreamL1Async,
}));

vi.mock('../embedding-service.js', () => ({
  generateMemoryStreamEmbeddingAsync: mockGenerateMemoryStreamEmbeddingAsync,
}));

// ────────────────────────────────────────────────────────────

import { runReflection } from '../desire/reflection.js';

describe('反思静默期机制', () => {
  let pool;

  beforeEach(() => {
    pool = { query: mockQuery };
    vi.clearAllMocks();
    mockGenerateL0Summary.mockReturnValue('summary');
  });

  it('静默期-阻止触发: 静默期内不触发反思', async () => {
    // 设置静默期（未来24小时）
    const silenceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Mock 静默期查询
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: silenceUntil }] });

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('in_silence_period');
    expect(result.silence_until).toBe(silenceUntil);
  });

  it('静默期-自动恢复: 静默期结束后恢复正常', async () => {
    // 设置静默期（过去1小时，已过期）
    const silenceUntil = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    // Mock 查询序列
    mockQuery
      .mockResolvedValueOnce({ rows: [{ value_json: silenceUntil }] }) // 查询 reflection_silence_until（已过期）
      .mockResolvedValueOnce({ rows: [] }) // 删除过期静默记录
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // 查询 accumulator（低于阈值）

    const result = await runReflection(pool);

    // 期望删除静默记录
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM working_memory WHERE key = 'reflection_silence_until'"
    );

    // accumulator 低于阈值，不触发反思（但不是因为静默期）
    expect(result.triggered).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('静默期-DB错误降级: working_memory 读写失败时降级处理', async () => {
    // Mock DB 错误
    mockQuery
      .mockRejectedValueOnce(new Error('DB connection failed')) // 静默期查询失败
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator 查询成功

    const result = await runReflection(pool);

    // 降级：跳过静默检查，继续反思逻辑
    expect(result.triggered).toBe(false); // accumulator < 12
    expect(result.reason).toBeUndefined(); // 不是 'in_silence_period'
  });
});

describe('反思模块-基础功能', () => {
  let pool;

  beforeEach(() => {
    pool = { query: mockQuery };
    vi.clearAllMocks();
  });

  it('accumulator 低于阈值时不触发', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // 无静默期
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator = 5 < 12

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    expect(result.accumulator).toBe(5);
  });

  it('无记忆时不触发', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // 无静默期
      .mockResolvedValueOnce({ rows: [{ value_json: 15 }] }) // accumulator = 15 >= 12
      .mockResolvedValueOnce({ rows: [] }); // 无记忆

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
  });
});
