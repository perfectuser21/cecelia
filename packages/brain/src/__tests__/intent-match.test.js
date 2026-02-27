/**
 * Intent Match API Tests
 * POST /api/brain/intent/match
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pool（数据库）
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// 延迟 import，让 mock 先生效
let app;
let pool;

beforeEach(async () => {
  vi.resetAllMocks();

  pool = (await import('../db.js')).default;

  // 每次测试重新创建 Express app，避免路由缓存
  const { default: intentMatchRoutes } = await import('../routes/intent-match.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/intent', intentMatchRoutes);
});

describe('POST /api/brain/intent/match', () => {
  it('query 为空时返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query is required');
  });

  it('query 缺失时返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query is required');
  });

  it('query 非字符串时返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query is required');
  });

  it('正常查询返回 200 包含必要字段', async () => {
    // Mock goals 查询（主查询 + 关键词补充）
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'goal-1',
            title: '提升任务成功率',
            type: 'kr',
            status: 'in_progress',
            priority: 'P0',
            metadata: null,
            parent_id: null,
            title_rank: 0,
          },
        ],
      })
      // projects 查询
      .mockResolvedValueOnce({
        rows: [],
      });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '任务成功率' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('query', '任务成功率');
    expect(res.body).toHaveProperty('layer_guess');
    expect(res.body).toHaveProperty('matched_goals');
    expect(res.body).toHaveProperty('matched_projects');
    expect(res.body).toHaveProperty('total');
  });

  it('matched_goals 包含正确字段（id, title, type, status, priority, score）', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'goal-1',
            title: '提升任务成功率',
            type: 'kr',
            status: 'in_progress',
            priority: 'P0',
            metadata: null,
            parent_id: null,
            title_rank: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '任务成功率' });

    expect(res.status).toBe(200);
    const goal = res.body.matched_goals[0];
    expect(goal).toHaveProperty('id', 'goal-1');
    expect(goal).toHaveProperty('title', '提升任务成功率');
    expect(goal).toHaveProperty('type', 'kr');
    expect(goal).toHaveProperty('status', 'in_progress');
    expect(goal).toHaveProperty('priority', 'P0');
    expect(goal).toHaveProperty('score');
  });

  it('title_rank=0（标题前缀匹配）时 score 为 0.9', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'goal-1',
            title: '任务成功率指标',
            type: 'kr',
            status: 'in_progress',
            priority: 'P1',
            metadata: null,
            parent_id: null,
            title_rank: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '任务成功率' });

    expect(res.body.matched_goals[0].score).toBe(0.9);
  });

  it('title_rank=1（非前缀匹配）时 score 为 0.6', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'goal-1',
            title: '优化系统任务成功率',
            type: 'kr',
            status: 'in_progress',
            priority: 'P1',
            metadata: null,
            parent_id: null,
            title_rank: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '任务成功率' });

    expect(res.body.matched_goals[0].score).toBe(0.6);
  });

  it('type=kr 时 layer_guess 为 kr', async () => {
    // 主查询返回 kr 类型
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'goal-1',
            title: 'KR 目标',
            type: 'kr',
            status: 'in_progress',
            priority: 'P0',
            metadata: null,
            parent_id: null,
            title_rank: 0,
          },
        ],
      })
      // 关键词补充查询（"关键结果" → 可能有多个关键词，每个返回空）
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '关键结果' });

    expect(res.body.layer_guess).toBe('kr');
  });

  it('有 projects 但无 kr/okr goals 时 layer_guess 为 project', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // goals
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'proj-1',
            name: '测试项目',
            type: 'project',
            status: 'in_progress',
            description: '一个项目',
            parent_id: null,
            name_rank: 0,
          },
        ],
      });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '测试项目' });

    expect(res.body.layer_guess).toBe('project');
  });

  it('layer_hint 有值时直接使用 layer_hint', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '测试', layer_hint: 'initiative' });

    expect(res.body.layer_guess).toBe('initiative');
  });

  it('无匹配时 layer_guess 为 unknown，total 为 0', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '不存在的内容xyz' });

    expect(res.status).toBe(200);
    expect(res.body.layer_guess).toBe('unknown');
    expect(res.body.total).toBe(0);
    expect(res.body.matched_goals).toEqual([]);
    expect(res.body.matched_projects).toEqual([]);
  });

  it('limit 参数被限制在 1-20 范围内（超过 20 截断为 20）', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '测试', limit: 100 });

    expect(res.status).toBe(200);
    // 检查 SQL 调用中的 limit 参数被截断为 20
    const firstCall = pool.query.mock.calls[0];
    expect(firstCall[1][2]).toBe(20);
  });

  it('limit 小于 1 时截断为 1', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '测试', limit: 0 });

    expect(res.status).toBe(200);
    const firstCall = pool.query.mock.calls[0];
    expect(firstCall[1][2]).toBe(1);
  });

  it('数据库报错时返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '任务' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB connection failed');
  });

  it('total 等于 matched_goals.length + matched_projects.length', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'goal-1',
            title: '目标 A',
            type: 'kr',
            status: 'in_progress',
            priority: 'P0',
            metadata: null,
            parent_id: null,
            title_rank: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'proj-1',
            name: '项目 B',
            type: 'project',
            status: 'in_progress',
            description: null,
            parent_id: null,
            name_rank: 1,
          },
        ],
      });

    const res = await request(app)
      .post('/api/brain/intent/match')
      .send({ query: '目标' });

    expect(res.body.total).toBe(
      res.body.matched_goals.length + res.body.matched_projects.length
    );
  });
});
