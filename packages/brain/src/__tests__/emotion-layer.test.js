/**
 * emotion-layer.test.js
 *
 * 环1：情绪层测试
 * - runEmotionLayer 从感知信号推导情绪，写入 working_memory + memory_stream
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock llm-caller
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

// Mock memory-utils
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn((text) => text?.slice(0, 100) || ''),
  generateMemoryStreamL1Async: vi.fn(),
}));

import { runEmotionLayer } from '../emotion-layer.js';
import { callLLM } from '../llm-caller.js';

function makePool(overrides = {}) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    ...overrides,
  };
}

const sampleObservations = [
  { signal: 'task_fail_rate_24h', value: 0.4, context: '过去 24h：3 完成，2 失败' },
  { signal: 'queue_buildup', value: 5, context: '队列积压：5 个任务等待派发' },
  { signal: 'user_online', value: true, context: 'Alex 最近 5 分钟内活跃' },
];

describe('E1: runEmotionLayer 基础', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('E1-1: observations 为空时不调用 LLM，返回 null', async () => {
    const pool = makePool();
    const result = await runEmotionLayer([], pool);
    expect(result).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('E1-2: pool 为 null 时返回 null', async () => {
    const result = await runEmotionLayer(sampleObservations, null);
    expect(result).toBeNull();
  });

  it('E1-3: LLM 返回情绪文本时，写入 working_memory 和 memory_stream', async () => {
    const emotionText = '焦虑而专注——队列积压严重，但 Alex 在线给我安全感。';
    callLLM.mockResolvedValueOnce({ text: emotionText });

    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'mock-id-123' }] }); // memory_stream insert

    const result = await runEmotionLayer(sampleObservations, pool);

    expect(result).toBe(emotionText);
    expect(callLLM).toHaveBeenCalledTimes(1);

    // 检查 working_memory 写入（第一次 query 调用）
    const firstCall = pool.query.mock.calls[0];
    expect(firstCall[0]).toContain('working_memory');
    expect(firstCall[0]).toContain('emotion_state');
    expect(firstCall[1][0]).toContain(emotionText);

    // 检查 memory_stream 写入（第二次 query 调用）
    const secondCall = pool.query.mock.calls[1];
    expect(secondCall[0]).toContain('memory_stream');
    expect(secondCall[0]).toContain('emotion_state');
  });

  it('E1-4: LLM 返回空字符串时返回 null，不写入', async () => {
    callLLM.mockResolvedValueOnce({ text: '' });
    const pool = makePool();
    const result = await runEmotionLayer(sampleObservations, pool);
    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('E1-5: LLM 调用失败时 graceful 返回 null', async () => {
    callLLM.mockRejectedValueOnce(new Error('LLM timeout'));
    const pool = makePool();
    const result = await runEmotionLayer(sampleObservations, pool);
    expect(result).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('E1-6: 情绪文本超长时截断至 200 字', async () => {
    const longText = 'A'.repeat(300);
    callLLM.mockResolvedValueOnce({ text: longText });

    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'mock-id' }] });

    const result = await runEmotionLayer(sampleObservations, pool);
    expect(result).toHaveLength(200);
  });
});

describe('E2: emotion_state 写入格式', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('E2-1: memory_stream content 包含 [情绪状态] 前缀', async () => {
    callLLM.mockResolvedValueOnce({ text: '平静满足——今天进展顺利。' });
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'mock-id' }] });

    await runEmotionLayer(sampleObservations, pool);

    const streamCall = pool.query.mock.calls[1];
    expect(streamCall[1][0]).toContain('[情绪状态]');
    expect(streamCall[1][0]).toContain('平静满足');
  });

  it('E2-2: memory_stream source_type 为 emotion_state', async () => {
    callLLM.mockResolvedValueOnce({ text: '好奇——遇到不理解的模式。' });
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'mock-id' }] });

    await runEmotionLayer(sampleObservations, pool);

    const streamCall = pool.query.mock.calls[1];
    expect(streamCall[0]).toContain("'emotion_state'");
  });
});
