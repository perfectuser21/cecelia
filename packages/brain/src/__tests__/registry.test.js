/**
 * system_registry 路由测试
 *
 * GET  /api/brain/registry        — 列表查询（返回数组）
 * GET  /api/brain/registry/exists — 存在性检查（name+type 必填）
 * POST /api/brain/registry        — 注册（upsert）
 * PATCH /api/brain/registry/:id   — 更新
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db pool
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

let app;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  app = express();
  app.use(express.json());

  const { default: registryRouter } = await import('../routes/registry.js');
  app.use('/api/brain/registry', registryRouter);
});

// ─────────────────────────────────────────────
// GET /api/brain/registry
// ─────────────────────────────────────────────
describe('GET /api/brain/registry', () => {
  it('返回数组结构', async () => {
    const fakeRows = [
      { id: 'uuid-1', name: 'dev', type: 'skill', location: '~/.claude/skills/dev', status: 'active', description: null, metadata: {}, registered_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(app).get('/api/brain/registry');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('dev');
  });

  it('支持 ?type= 过滤', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/registry?type=skill');
    expect(res.status).toBe(200);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain('skill');
  });

  it('支持 ?status= 过滤', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/registry?status=active');
    expect(res.status).toBe(200);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain('active');
  });

  it('支持 ?search= 关键词搜索', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/registry?search=deploy');
    expect(res.status).toBe(200);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain('%deploy%');
  });

  it('支持 ?q= 关键词搜索（别名）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/registry?q=deploy');
    expect(res.status).toBe(200);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain('%deploy%');
  });
});

// ─────────────────────────────────────────────
// GET /api/brain/registry/exists
// ─────────────────────────────────────────────
describe('GET /api/brain/registry/exists', () => {
  it('存在时返回 { exists: true, item }', async () => {
    const fakeRow = { id: 'uuid-1', name: 'dev', type: 'skill', status: 'active' };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const res = await request(app).get('/api/brain/registry/exists?name=dev&type=skill');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.item.name).toBe('dev');
  });

  it('不存在时返回 { exists: false }', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/brain/registry/exists?name=nonexistent&type=skill');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.item).toBeNull();
  });

  it('缺少 name 时返回 400', async () => {
    const res = await request(app).get('/api/brain/registry/exists?type=skill');
    expect(res.status).toBe(400);
  });

  it('缺少 type 时返回 400', async () => {
    const res = await request(app).get('/api/brain/registry/exists?name=dev');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────
// POST /api/brain/registry
// ─────────────────────────────────────────────
describe('POST /api/brain/registry', () => {
  it('注册新条目，返回 201 + 条目', async () => {
    const fakeRow = { id: 'uuid-new', name: 'cron-cleanup', type: 'cron', location: null, status: 'active', description: '定时清理', metadata: {}, registered_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const res = await request(app)
      .post('/api/brain/registry')
      .send({ name: 'cron-cleanup', type: 'cron', description: '定时清理' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('cron-cleanup');
    expect(res.body.id).toBe('uuid-new');
  });

  it('upsert 重复条目时返回 200（已存在则更新）', async () => {
    const existing = { id: 'uuid-1', name: 'dev', type: 'skill', status: 'active', description: '更新描述', metadata: {}, location: null, registered_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const res = await request(app)
      .post('/api/brain/registry')
      .send({ name: 'dev', type: 'skill', description: '更新描述' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.name).toBe('dev');
  });

  it('缺少 name 时返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/registry')
      .send({ type: 'skill' });
    expect(res.status).toBe(400);
  });

  it('缺少 type 时返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/registry')
      .send({ name: 'foo' });
    expect(res.status).toBe(400);
  });

  it('type 非法时返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/registry')
      .send({ name: 'foo', type: 'invalid_type' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────
// PATCH /api/brain/registry/:id
// ─────────────────────────────────────────────
describe('PATCH /api/brain/registry/:id', () => {
  it('更新 status 返回 200 + 更新后条目', async () => {
    const updated = { id: 'uuid-1', name: 'dev', type: 'skill', status: 'inactive', description: null, location: null, metadata: {}, registered_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const res = await request(app)
      .patch('/api/brain/registry/uuid-1')
      .send({ status: 'inactive' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });

  it('条目不存在时返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/brain/registry/nonexistent-id')
      .send({ status: 'deprecated' });

    expect(res.status).toBe(404);
  });

  it('body 为空时返回 400', async () => {
    const res = await request(app)
      .patch('/api/brain/registry/uuid-1')
      .send({});
    expect(res.status).toBe(400);
  });
});
