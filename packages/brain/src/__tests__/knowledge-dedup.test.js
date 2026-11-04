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
    // 真实 pool.query 始终返回 Promise；未提供来源路由时明确返回空行。
    mockQuery.mockImplementation(async sql => ({ rows: sql.includes('INSERT INTO memory_stream') ? [{ id: 'dedup-memory' }] : [] }));
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

      const { executeAction } = await import('../chat-action-dispatcher.js');
      const result=await executeAction({type:'CREATE_LEARNING',params:{title:'Owned lesson'}});
      expect(result).toContain('第 3 版');
      expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT.*content_hash/);
      expect(mockQuery.mock.calls[1]).toEqual(['UPDATE learnings SET version = $1 WHERE id = $2',[3,'dup-1']]);
      expect(mockQuery.mock.calls.some(([sql])=>/INSERT INTO learnings/.test(sql))).toBe(false);
    });
  });

  describe('chat content_hash consistency through real actions',()=>{
    it('相同内容查询相同hash，不同内容查询不同hash',async()=>{
      const {executeAction}=await import('../chat-action-dispatcher.js');
      for(const title of ['Lesson A','Lesson A','Lesson B']) {
        const result=await executeAction({type:'CREATE_LEARNING',params:{title}});
        expect(result).toContain('已记录学习');
      }
      const hashes=mockQuery.mock.calls.filter(([sql])=>/SELECT.*content_hash/.test(sql)).map(([,params])=>params[0]);
      expect(hashes).toHaveLength(3);
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[0]).not.toBe(hashes[2]);
      expect(hashes[0]).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
