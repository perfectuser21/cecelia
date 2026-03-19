/**
 * content-topics 路由单元测试
 *
 * 覆盖：
 *   POST /generate  — 正常生成、count 校验、LLM 异常
 *   GET  /          — 列表查询、status 过滤、分页
 *   PATCH /:id      — 状态更新、404、非法 status
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock llm-caller.js
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

import pool from '../db.js';
import { callLLM } from '../llm-caller.js';
import contentTopicsRouter from '../routes/content-topics.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/content/topics', contentTopicsRouter);
  return app;
}

/** 生成 n 条 mock 选题 */
function mockTopics(n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    title: `选题 ${i + 1}`,
    hook: `这是钩子句 ${i + 1}`,
    body_draft: `这是文案草稿 ${i + 1}，内容足够长，超过一百字。`.repeat(5),
    target_platforms: ['douyin', 'xiaohongshu'],
    ai_score: 8.0 + i * 0.1,
    score_reason: `评分理由 ${i + 1}`,
  }));
}

/** 生成 n 条 DB 返回行 */
function mockDbRows(n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    id: `uuid-${i}`,
    title: `选题 ${i + 1}`,
    hook: `钩子句 ${i + 1}`,
    body_draft: `文案草稿 ${i + 1}`.repeat(10),
    target_platforms: ['douyin'],
    ai_score: 8.0,
    score_reason: '理由',
    status: 'pending',
    generated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /generate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/brain/content/topics/generate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('默认返回 10 条选题', async () => {
    const topics = mockTopics(10);
    callLLM.mockResolvedValue({ text: JSON.stringify(topics) });
    const rows = mockDbRows(10);
    pool.query.mockResolvedValue({ rows: [rows[0]] });

    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.topics).toHaveLength(10);
    expect(res.body.count).toBe(10);
  });

  it('每条选题含必需字段', async () => {
    const topics = mockTopics(1);
    callLLM.mockResolvedValue({ text: JSON.stringify(topics) });
    const row = {
      id: 'uuid-0',
      title: topics[0].title,
      hook: topics[0].hook,
      body_draft: topics[0].body_draft,
      ai_score: topics[0].ai_score,
      target_platforms: topics[0].target_platforms,
      score_reason: topics[0].score_reason,
      status: 'pending',
      generated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    pool.query.mockResolvedValue({ rows: [row] });

    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({ count: 1 });

    expect(res.status).toBe(200);
    const topic = res.body.topics[0];
    expect(topic.title).toBeTruthy();
    expect(topic.hook).toBeTruthy();
    expect(topic.body_draft).toBeTruthy();
    expect(typeof topic.ai_score).toBe('number');
  });

  it('count ≤ 0 返回 HTTP 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({ count: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/count/);
  });

  it('count > 50 返回 HTTP 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({ count: 51 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/count/);
  });

  it('count 为负数返回 HTTP 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({ count: -5 });
    expect(res.status).toBe(400);
  });

  it('LLM 调用异常返回 HTTP 500 + error 字段', async () => {
    callLLM.mockRejectedValue(new Error('API key invalid'));

    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  it('LLM 返回非 JSON 内容返回 HTTP 500', async () => {
    callLLM.mockResolvedValue({ text: '抱歉，无法生成内容。' });

    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  it('LLM 返回 JSON 块中包含数组时解析成功', async () => {
    const topics = mockTopics(2);
    const textWithExtra = `以下是选题建议：\n${JSON.stringify(topics)}\n请参考使用。`;
    callLLM.mockResolvedValue({ text: textWithExtra });
    pool.query.mockResolvedValue({ rows: [mockDbRows(1)[0]] });

    const res = await request(makeApp())
      .post('/api/brain/content/topics/generate')
      .send({ count: 2 });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brain/content/topics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回选题列表和 total', async () => {
    const rows = mockDbRows(5);
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 5 }] })   // COUNT
      .mockResolvedValueOnce({ rows });                    // SELECT

    const res = await request(makeApp()).get('/api/brain/content/topics');

    expect(res.status).toBe(200);
    expect(res.body.topics).toHaveLength(5);
    expect(res.body.total).toBe(5);
  });

  it('status 过滤 — 只返回 pending', async () => {
    const rows = mockDbRows(3);
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows });

    const res = await request(makeApp())
      .get('/api/brain/content/topics?status=pending');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    // 确认 COUNT query 含 WHERE 子句
    const countCall = pool.query.mock.calls[0];
    expect(countCall[0]).toContain('WHERE');
    expect(countCall[1]).toContain('pending');
  });

  it('非法 status 返回 400', async () => {
    const res = await request(makeApp())
      .get('/api/brain/content/topics?status=invalid');
    expect(res.status).toBe(400);
  });

  it('DB 异常返回 500', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(makeApp()).get('/api/brain/content/topics');
    expect(res.status).toBe(500);
  });

  it('分页参数生效', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 100 }] })
      .mockResolvedValueOnce({ rows: mockDbRows(5) });

    const res = await request(makeApp())
      .get('/api/brain/content/topics?limit=5&offset=10');

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/brain/content/topics/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adopted → 返回更新后记录，含 adopted_at', async () => {
    const now = new Date().toISOString();
    pool.query.mockResolvedValue({
      rows: [{ id: 'uuid-1', title: '选题1', status: 'adopted', adopted_at: now }],
    });

    const res = await request(makeApp())
      .patch('/api/brain/content/topics/uuid-1')
      .send({ status: 'adopted' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('adopted');
    expect(res.body.adopted_at).toBeTruthy();
  });

  it('skipped → adopted_at 为 null', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 'uuid-1', title: '选题1', status: 'skipped', adopted_at: null }],
    });

    const res = await request(makeApp())
      .patch('/api/brain/content/topics/uuid-1')
      .send({ status: 'skipped' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
    expect(res.body.adopted_at).toBeNull();
  });

  it('ID 不存在返回 404', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(makeApp())
      .patch('/api/brain/content/topics/non-existent-id')
      .send({ status: 'adopted' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('非法 status 返回 400', async () => {
    const res = await request(makeApp())
      .patch('/api/brain/content/topics/uuid-1')
      .send({ status: 'deleted' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/);
  });

  it('缺少 status 字段返回 400', async () => {
    const res = await request(makeApp())
      .patch('/api/brain/content/topics/uuid-1')
      .send({});

    expect(res.status).toBe(400);
  });

  it('DB 异常返回 500', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));

    const res = await request(makeApp())
      .patch('/api/brain/content/topics/uuid-1')
      .send({ status: 'adopted' });

    expect(res.status).toBe(500);
  });
});
