/**
 * Profile Facts API Tests
 *
 * 测试 /api/brain/profile/facts CRUD + import 端点
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

// Mock embedding-service
const mockGenerateProfileFactEmbeddingAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../embedding-service.js', () => ({
  generateProfileFactEmbeddingAsync: (...args) => mockGenerateProfileFactEmbeddingAsync(...args),
}));

// Mock fs (for API key loading)
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ api_key: 'test-minimax-key' })),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import router after mocks
const { default: profileFactsRoutes } = await import('../routes/profile-facts.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/profile/facts', profileFactsRoutes);
  return app;
}

describe('Profile Facts API', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  // ============ GET ============

  describe('GET /api/brain/profile/facts', () => {
    it('返回 facts 列表和 total', async () => {
      const fakeFacts = [
        { id: 'uuid-1', category: 'preference', content: '偏好简洁的回答', has_embedding: true, created_at: new Date() },
      ];
      mockQuery
        .mockResolvedValueOnce({ rows: fakeFacts })
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });

      const res = await request(app).get('/api/brain/profile/facts');

      expect(res.status).toBe(200);
      expect(res.body.facts).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.facts[0].content).toBe('偏好简洁的回答');
    });

    it('category 过滤传入查询参数', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] });

      const res = await request(app).get('/api/brain/profile/facts?category=behavior&limit=10&offset=5');

      expect(res.status).toBe(200);
      // 检查查询包含 category 参数
      const firstCallArgs = mockQuery.mock.calls[0];
      expect(firstCallArgs[1]).toContain('behavior');
      expect(firstCallArgs[1]).toContain(10); // limit
      expect(firstCallArgs[1]).toContain(5);  // offset
    });

    it('GET ?category=behavior 正确过滤，不返回全量', async () => {
      const behaviorFacts = [
        { id: 'uuid-b', category: 'behavior', content: '习惯早起', has_embedding: false, created_at: new Date() },
      ];
      mockQuery
        .mockResolvedValueOnce({ rows: behaviorFacts })
        .mockResolvedValueOnce({ rows: [{ total: 1 }] });

      const res = await request(app).get('/api/brain/profile/facts?category=behavior');

      expect(res.status).toBe(200);
      expect(res.body.facts).toHaveLength(1);
      expect(res.body.facts[0].category).toBe('behavior');
      // 验证 SQL 包含 category 条件
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('category = $');
    });

    it('DB 错误时返回 500', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app).get('/api/brain/profile/facts');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to list facts');
    });
  });

  // ============ POST ============

  describe('POST /api/brain/profile/facts', () => {
    it('成功创建 fact', async () => {
      const fakeFact = { id: 'uuid-1', category: 'preference', content: '偏好简洁', has_embedding: false, created_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [fakeFact] });

      const res = await request(app)
        .post('/api/brain/profile/facts')
        .send({ content: '偏好简洁', category: 'preference' });

      expect(res.status).toBe(201);
      expect(res.body.content).toBe('偏好简洁');
      expect(res.body.category).toBe('preference');
    });

    it('插入时 user_id 固定为 owner', async () => {
      const fakeFact = { id: 'uuid-1', category: 'other', content: '测试', has_embedding: false, created_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [fakeFact] });

      await request(app)
        .post('/api/brain/profile/facts')
        .send({ content: '测试' });

      const params = mockQuery.mock.calls[0][1];
      expect(params[0]).toBe('owner');
    });

    it('OPENAI_API_KEY 存在时触发 embedding 生成', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const fakeFact = { id: 'uuid-embed', category: 'other', content: '测试embedding', has_embedding: false, created_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [fakeFact] });

      await request(app)
        .post('/api/brain/profile/facts')
        .send({ content: '测试embedding' });

      // 等待 fire-and-forget
      await new Promise(r => setTimeout(r, 10));
      expect(mockGenerateProfileFactEmbeddingAsync).toHaveBeenCalledWith('uuid-embed', '测试embedding');

      delete process.env.OPENAI_API_KEY;
    });

    it('content 为空时返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/profile/facts')
        .send({ content: '', category: 'other' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('content is required');
    });
  });

  // ============ PUT ============

  describe('PUT /api/brain/profile/facts/:id', () => {
    it('成功更新 fact 内容并重置 embedding', async () => {
      const updated = { id: 'uuid-1', category: 'preference', content: '新内容', has_embedding: false, created_at: new Date() };
      mockQuery.mockResolvedValueOnce({ rows: [updated] });

      const res = await request(app)
        .put('/api/brain/profile/facts/uuid-1')
        .send({ content: '新内容', category: 'preference' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('新内容');

      // SQL 中应包含 embedding = NULL
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('embedding = NULL');
    });

    it('fact 不存在时返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .put('/api/brain/profile/facts/nonexistent')
        .send({ content: '新内容' });

      expect(res.status).toBe(404);
    });

    it('content 为空时返回 400', async () => {
      const res = await request(app)
        .put('/api/brain/profile/facts/uuid-1')
        .send({ content: '' });

      expect(res.status).toBe(400);
    });
  });

  // ============ DELETE ============

  describe('DELETE /api/brain/profile/facts/:id', () => {
    it('成功删除 fact', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'uuid-1' }] });

      const res = await request(app).delete('/api/brain/profile/facts/uuid-1');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
      expect(res.body.id).toBe('uuid-1');
    });

    it('fact 不存在时返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).delete('/api/brain/profile/facts/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ============ POST /import ============

  describe('POST /api/brain/profile/facts/import', () => {
    it('调用 MiniMax 拆解文本并批量插入', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"facts": ["姓名是徐啸", "正在写一本书"]}' } }],
        }),
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'id-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'id-2' }] });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: '我叫徐啸，正在写一本书', category: 'auto' });

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
      expect(res.body.facts).toEqual(['姓名是徐啸', '正在写一本书']);
    });

    it('返回正确的 response body 格式', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"facts": ["偏好简洁"]}' } }],
        }),
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: '我偏好简洁的回答' });

      expect(res.body).toHaveProperty('imported');
      expect(res.body).toHaveProperty('facts');
      expect(Array.isArray(res.body.facts)).toBe(true);
    });

    it('text 为空时返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text is required');
    });

    it('MiniMax 返回 markdown 代码块时正确解析，不插入代码符号', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"facts": ["习惯早起", "偏好简洁"]}\n```' } }],
        }),
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'id-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'id-2' }] });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: '我习惯早起，偏好简洁' });

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
      expect(res.body.facts).toEqual(['习惯早起', '偏好简洁']);
      // 确保没有代码符号被插入
      expect(res.body.facts).not.toContain('```');
      expect(res.body.facts).not.toContain('{');
    });

    it('POST category=behavior 保存为 behavior，不降级为 other', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"facts": ["习惯早起"]}' } }],
        }),
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: '我习惯早起', category: 'behavior' });

      expect(res.status).toBe(200);
      // 验证插入时使用了 behavior 分类
      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[1]).toBe('behavior');
    });

    it('MiniMax 返回空 facts 时返回 imported: 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"facts": []}' } }],
        }),
      });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: '...' });

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(0);
    });

    it('CSV 格式绕过 MiniMax 直接解析，指令行被跳过', async () => {
      // 模拟用户实际输入的 CSV（含说明行、header、数据）
      const csvText = [
        '使用说明：,,,,,,',
        '1. 个人关系数据库调用，每当我提到任何一个人的名字时，必须立即检查个人关系数据库，确定我与该人的关系背景，以便准确理解上下文与互动细节。,,,,,,',
        '姓名,称呼,实际关系,生日,分类,职业,备注',
        '张三,小张,同事,1990-01-01,工作,工程师,',
        '李四,老李,朋友,1985-05-15,朋友,,',
      ].join('\n');

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'id-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'id-2' }] });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: csvText });

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(2);
      // MiniMax 没有被调用（CSV 直接解析）
      expect(mockFetch).not.toHaveBeenCalled();
      // 记录内容应包含 姓名:张三，而不是指令行内容
      expect(res.body.facts[0]).toContain('姓名:张三');
      expect(res.body.facts[1]).toContain('姓名:李四');
      // 不应包含指令行文字
      expect(res.body.facts[0]).not.toContain('个人关系数据库调用');
    });

    it('CSV 说明行（单个非空列）被正确跳过，不产生垃圾记录', async () => {
      const csvText = [
        '使用说明：,,,,,,',
        '姓名,称呼,实际关系',
        '王五,小王,朋友',
      ].join('\n');

      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'id-1' }] });

      const res = await request(app)
        .post('/api/brain/profile/facts/import')
        .send({ text: csvText });

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);
      expect(res.body.facts[0]).toContain('姓名:王五');
    });
  });

  // ============ DELETE /batch ============

  describe('DELETE /api/brain/profile/facts/batch', () => {
    it('批量删除多条 facts', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'uuid-1' }, { id: 'uuid-2' }, { id: 'uuid-3' }],
      });

      const res = await request(app)
        .delete('/api/brain/profile/facts/batch')
        .send({ ids: ['uuid-1', 'uuid-2', 'uuid-3'] });

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(3);
      expect(res.body.ids).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
    });

    it('使用 ANY($1) 操作符批量删除', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'uuid-1' }] });

      await request(app)
        .delete('/api/brain/profile/facts/batch')
        .send({ ids: ['uuid-1'] });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('ANY($1)');
      expect(params[0]).toEqual(['uuid-1']);
      expect(params[1]).toBe('owner');
    });

    it('ids 为空数组时返回 400', async () => {
      const res = await request(app)
        .delete('/api/brain/profile/facts/batch')
        .send({ ids: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ids must be a non-empty array');
    });

    it('ids 不是数组时返回 400', async () => {
      const res = await request(app)
        .delete('/api/brain/profile/facts/batch')
        .send({ ids: 'uuid-1' });

      expect(res.status).toBe(400);
    });

    it('DB 错误时返回 500', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app)
        .delete('/api/brain/profile/facts/batch')
        .send({ ids: ['uuid-1'] });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to batch delete facts');
    });
  });
});
