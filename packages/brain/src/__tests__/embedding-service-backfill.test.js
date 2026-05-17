/**
 * embedding-service backfill + retry queue 测试
 *
 * T1: backfillLearningEmbeddings 对 embedding=null 的记录生成并写入 embedding
 * T2: 单次 backfill 只处理 BATCH_SIZE=10 条（LIMIT 约束）
 * T3: generateLearningEmbeddingAsync 失败时写入 working_memory 重试队列
 * T4: OPENAI_API_KEY 未设置时跳过，返回 {processed:0, failed:0}
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock openai-client.js
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn(),
}));

import pool from '../db.js';
import { generateEmbedding } from '../openai-client.js';
import {
  backfillLearningEmbeddings,
  generateLearningEmbeddingAsync,
  isQuotaError,
  isInQuotaCooldown,
  _resetQuotaCooldown,
} from '../embedding-service.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
});

describe('backfillLearningEmbeddings', () => {
  it('T1: 对 embedding=null 的记录生成并写入 embedding', async () => {
    const fakeRows = [
      { id: 'id-1', title: '教训1', content: '内容1' },
      { id: 'id-2', title: '教训2', content: '内容2' },
    ];
    const mockEmbedding = Array(1536).fill(0.1);

    pool.query
      .mockResolvedValueOnce({ rows: fakeRows }) // SELECT
      .mockResolvedValue({ rows: [] }); // UPDATE calls

    generateEmbedding.mockResolvedValue(mockEmbedding);

    const result = await backfillLearningEmbeddings(pool);

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    // 验证调用了 UPDATE
    const updateCalls = pool.query.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE learnings')
    );
    expect(updateCalls.length).toBe(2);
  });

  it('T2: 无 embedding=null 记录时返回 processed=0', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await backfillLearningEmbeddings(pool);

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('T3: 单条 embedding 生成失败时 failed+1，继续处理其他', async () => {
    const fakeRows = [
      { id: 'id-1', title: '教训1', content: '内容1' },
      { id: 'id-2', title: '教训2', content: '内容2' },
    ];

    pool.query
      .mockResolvedValueOnce({ rows: fakeRows })
      .mockResolvedValue({ rows: [] });

    generateEmbedding
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce(Array(1536).fill(0.1));

    const result = await backfillLearningEmbeddings(pool);

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('T4: OPENAI_API_KEY 未设置时跳过', async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await backfillLearningEmbeddings(pool);

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('OpenAI quota 防护', () => {
  beforeEach(() => {
    _resetQuotaCooldown();
  });

  it('T7: isQuotaError 识别 quota exceeded 错误', () => {
    expect(isQuotaError(new Error('OpenAI quota exceeded: 429 ...'))).toBe(true);
    expect(isQuotaError(new Error('insufficient_quota'))).toBe(true);
    expect(isQuotaError(new Error('You exceeded your current quota, please...'))).toBe(true);
    expect(isQuotaError(new Error('rate limit'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError({})).toBe(false);
  });

  it('T8: 默认不在 quota cooldown', () => {
    expect(isInQuotaCooldown()).toBe(false);
  });

  it('T9: 连续 3 次 quota 错误后整轮中止 backfill 并进入冷却', async () => {
    const quotaErr = new Error('OpenAI quota exceeded: 429');
    generateEmbedding
      .mockRejectedValueOnce(quotaErr)
      .mockRejectedValueOnce(quotaErr)
      .mockRejectedValueOnce(quotaErr)
      .mockResolvedValue([0.1, 0.2]);

    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'l1', title: 't1', content: 'c1' },
        { id: 'l2', title: 't2', content: 'c2' },
        { id: 'l3', title: 't3', content: 'c3' },
        { id: 'l4', title: 't4', content: 'c4' },  // 不应该被处理
      ],
    });

    const result = await backfillLearningEmbeddings(pool);

    // 3 次 quota 失败后立刻 break，第 4 条不被处理
    expect(generateEmbedding).toHaveBeenCalledTimes(3);
    expect(result.processed).toBe(0);
    expect(isInQuotaCooldown()).toBe(true);
  });

  it('T10: 在 cooldown 期 backfill 直接跳过返回 quota_skipped', async () => {
    // 通过先触发 cooldown
    const quotaErr = new Error('insufficient_quota');
    generateEmbedding.mockRejectedValue(quotaErr);
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 'l1', title: 't1', content: 'c1' },
        { id: 'l2', title: 't2', content: 'c2' },
        { id: 'l3', title: 't3', content: 'c3' },
      ],
    });
    await backfillLearningEmbeddings(pool);
    expect(isInQuotaCooldown()).toBe(true);

    vi.clearAllMocks();
    const result = await backfillLearningEmbeddings(pool);

    expect(result.quota_skipped).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});

describe('generateLearningEmbeddingAsync 失败重试队列', () => {
  it('T5: 失败时写入 embedding_retry_queue', async () => {
    generateEmbedding.mockRejectedValue(new Error('OpenAI rate limit'));
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT working_memory
      .mockResolvedValue({ rows: [] }); // INSERT working_memory

    await generateLearningEmbeddingAsync('learn-id-1', '教训内容');

    // 验证写入了重试队列（INSERT INTO working_memory ... embedding_retry_queue）
    const insertCall = pool.query.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('embedding_retry_queue')
        && c[0].includes('INSERT')
    );
    expect(insertCall).toBeDefined();
    // insertCall[1] 是参数数组，第一个参数是 JSON.stringify(trimmed)
    const queueData = JSON.parse(insertCall[1][0]);
    expect(Array.isArray(queueData)).toBe(true);
    expect(queueData[0].table).toBe('learnings');
    expect(queueData[0].id).toBe('learn-id-1');
  });

  it('T6: OPENAI_API_KEY 未设置时不调用 generateEmbedding', async () => {
    delete process.env.OPENAI_API_KEY;

    await generateLearningEmbeddingAsync('learn-id-2', '内容');

    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});
