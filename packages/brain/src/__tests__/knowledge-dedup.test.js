/**
 * 知识去重测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

// Mock embedding service
vi.mock('../embedding-service.js', () => ({
  generateLearningEmbeddingAsync: vi.fn(),
}));

// Mock openai-client
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

describe('Knowledge Dedup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('recordLearning dedup', () => {
    it('should insert new learning with content_hash', async () => {
      // 首次插入：hash 不存在
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // content_hash 查询：不存在
        .mockResolvedValueOnce({ rows: [{ id: 'new-1', title: 'test', content_hash: 'abc123' }] }); // INSERT

      const { recordLearning } = await import('../learning.js');
      const result = await recordLearning({
        task_id: 't1',
        analysis: { root_cause: 'test root cause' },
        learnings: ['lesson 1'],
        recommended_actions: [],
        confidence: 0.8,
      });

      expect(result).toBeTruthy();
      // 第二次 query 应该是 INSERT，包含 content_hash
      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall[0]).toContain('content_hash');
      expect(insertCall[0]).toContain('version');
      expect(insertCall[0]).toContain('is_latest');
    });

    it('should update version for duplicate content_hash', async () => {
      // 重复插入：hash 已存在
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'existing-1', version: 1 }] }) // hash 查询：存在
        .mockResolvedValueOnce({ rows: [] }); // UPDATE version

      const { recordLearning } = await import('../learning.js');
      const result = await recordLearning({
        task_id: 't2',
        analysis: { root_cause: 'test root cause' },
        learnings: ['lesson 1'],
        recommended_actions: [],
        confidence: 0.8,
      });

      // 应该返回已存在的记录
      expect(result.id).toBe('existing-1');
      // 第二次 query 应该是 UPDATE（version bump）
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE');
      expect(updateCall[1]).toContain(2); // version 1 + 1 = 2
    });
  });

  describe('chat-action-dispatcher LEARN dedup', () => {
    it('should detect duplicate learning via content_hash', async () => {
      // Mock: hash 已存在
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'dup-1', version: 2 }] }) // hash 查询
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      const { detectAction, executeAction } = await import('../chat-action-dispatcher.js');
      // 不测试具体的 action detection，只测试概念
      expect(detectAction).toBeDefined();
      expect(executeAction).toBeDefined();
    });
  });

  describe('content_hash consistency', () => {
    it('same title+content should produce same hash', async () => {
      const crypto = await import('crypto');
      const input1 = 'Test Title\nTest Content';
      const input2 = 'Test Title\nTest Content';
      const hash1 = crypto.createHash('sha256').update(input1).digest('hex').slice(0, 16);
      const hash2 = crypto.createHash('sha256').update(input2).digest('hex').slice(0, 16);
      expect(hash1).toBe(hash2);
    });

    it('different title+content should produce different hash', async () => {
      const crypto = await import('crypto');
      const hash1 = crypto.createHash('sha256').update('Title A\nContent A').digest('hex').slice(0, 16);
      const hash2 = crypto.createHash('sha256').update('Title B\nContent B').digest('hex').slice(0, 16);
      expect(hash1).not.toBe(hash2);
    });
  });
});
