/**
 * Tests for recordLLMError 结构化字段
 * DoD: thalamus-record-llm-error-structured
 *
 * 验证：
 * 1. recordLLMError 写入 payload 包含 http_status / elapsed_ms / model / provider / fallback_attempt
 * 2. opts 字段缺失时写入 null（不抛出）
 * 3. context 字段正确合并
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordLLMError } from '../thalamus.js';

// Mock db pool
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../db.js', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }
}));

// Mock 依赖模块（thalamus.js 的间接依赖）
vi.mock('../learning.js', () => ({
  getRecentLearnings: vi.fn().mockResolvedValue([]),
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '{}', model: 'test', provider: 'test', elapsed_ms: 100 }),
  callLLMStream: vi.fn(),
}));
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
}));

describe('recordLLMError — 结构化字段', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('写入 payload 包含所有新结构化字段', async () => {
    const error = new Error('Anthropic API error: 429 - rate limit');
    await recordLLMError('thalamus', error, { event_type: 'tick' }, {
      http_status: 429,
      elapsed_ms: 3200,
      model: 'claude-haiku-4-5-20251001',
      provider: 'anthropic-api',
      fallback_attempt: 0,
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO cecelia_events');

    const payload = JSON.parse(params[2]);
    expect(payload.http_status).toBe(429);
    expect(payload.elapsed_ms).toBe(3200);
    expect(payload.model).toBe('claude-haiku-4-5-20251001');
    expect(payload.provider).toBe('anthropic-api');
    expect(payload.fallback_attempt).toBe(0);
    expect(payload.error_message).toBe('Anthropic API error: 429 - rate limit');
    expect(payload.event_type).toBe('tick');
  });

  it('opts 字段全部缺失时写入 null 而非抛出', async () => {
    const error = new Error('output parse failed');
    await recordLLMError('thalamus', error, { event_type: 'task_failed' });

    expect(mockQuery).toHaveBeenCalledOnce();
    const payload = JSON.parse(mockQuery.mock.calls[0][1][2]);
    expect(payload.http_status).toBeNull();
    expect(payload.elapsed_ms).toBeNull();
    expect(payload.model).toBeNull();
    expect(payload.provider).toBeNull();
    expect(payload.fallback_attempt).toBeNull();
  });

  it('fallback 场景写入 fallback_attempt > 0', async () => {
    const error = new Error('all candidates failed');
    await recordLLMError('cortex', error, {}, {
      http_status: 500,
      elapsed_ms: 12000,
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      fallback_attempt: 2,
    });

    const payload = JSON.parse(mockQuery.mock.calls[0][1][2]);
    expect(payload.fallback_attempt).toBe(2);
    expect(payload.http_status).toBe(500);
    expect(payload.elapsed_ms).toBe(12000);
  });

  it('DB 写入失败时不抛出（静默降级）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    const error = new Error('llm error');

    // 不应抛出
    await expect(
      recordLLMError('thalamus', error, {}, { http_status: 503 })
    ).resolves.toBeUndefined();
  });
});
