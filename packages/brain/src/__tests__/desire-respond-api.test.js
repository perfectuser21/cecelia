/**
 * desire-respond-api.test.js
 * POST /api/brain/desires/:id/respond 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), connect: () => ({ query: vi.fn(), release: () => {} }) },
}));

vi.mock('../events/taskEvents.js', () => ({
  publishDesireUpdated: vi.fn(),
}));

const { default: pool } = await import('../db.js');
const { default: routes } = await import('../routes.js');

const app = express();
app.use(express.json());
app.use('/api/brain', routes);

describe('POST /api/brain/desires/:id/respond', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('正常回复 — 返回 200 + 写入 memory_stream + 更新状态', async () => {
    // 第一次查询: 查找 desire
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: 'desire-1', type: 'propose', content: '建议升级 Node 版本', urgency: 6 }],
    });
    // 第二次: 插入 memory_stream
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });
    // 第三次: 更新 desire 状态
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 'desire-1', status: 'acknowledged' }] });

    const res = await request(app)
      .post('/api/brain/desires/desire-1/respond')
      .send({ message: '好的，升级到 Node 22' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('acknowledged');

    // 验证 memory_stream 写入
    expect(pool.query).toHaveBeenCalledTimes(3);
    const memoryCall = vi.mocked(pool.query).mock.calls[1];
    expect(memoryCall[0]).toContain('memory_stream');
    expect(memoryCall[1][0]).toContain('好的，升级到 Node 22');
  });

  it('空 message — 返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/desires/desire-1/respond')
      .send({ message: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message is required');
  });

  it('无 message 字段 — 返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/desires/desire-1/respond')
      .send({});

    expect(res.status).toBe(400);
  });

  it('desire 不存在 — 返回 404', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/desires/nonexistent/respond')
      .send({ message: '我觉得不行' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('desire not found');
  });
});
