/**
 * routes/__tests__/clips.test.js
 * Unit tests for clips route — POST/GET/retry/callback/webhook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({
  unexpectedDb: vi.fn(), unexpectedFetch: vi.fn(), process: vi.fn(),
}));
vi.mock('node:child_process', () => Object.fromEntries(
  ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map(name => [name, (...args) => {
    boundary.process(name, ...args); throw Error('clips_test_process_forbidden');
  }]),
));

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../../clips-extractor.js', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
}));

import pool from '../../db.js';
import { extractClip } from '../../clips-extractor.js';

const SYNTHETIC_NOTION_KEY = 'synthetic-clips-notion-key-not-a-real-credential';
const SYNTHETIC_DB = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.clearAllMocks();
  pool.query.mockReset().mockImplementation((...args) => {
    boundary.unexpectedDb(...args); throw Error('clips_test_unarranged_db');
  });
  vi.stubEnv('NOTION_API_KEY', SYNTHETIC_NOTION_KEY);
  vi.stubEnv('NOTION_KNOWLEDGE_REF_DB_ID', SYNTHETIC_DB);
  vi.stubEnv('CLIPS_WEBHOOK_SECRET', '');
  delete process.env.CLIPS_WEBHOOK_SECRET;
  vi.stubGlobal('fetch', async (...args) => {
    boundary.unexpectedFetch(...args); throw Error('clips_test_unarranged_fetch');
  });
});
afterEach(() => {
  try {
    expect(boundary.unexpectedDb).not.toHaveBeenCalled();
    expect(boundary.unexpectedFetch).not.toHaveBeenCalled();
    expect(boundary.process).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

// 仅成功回调显式允许record-only Notion调用；其余测试保留默认fetch拒绝。
function recordNotionWrite() {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'synthetic-notion-page' }) }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function expectNotionWrite(fetch) {
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://api.notion.com/v1/pages');
  expect(options).toMatchObject({ method: 'POST', headers: {
    Authorization: `Bearer ${SYNTHETIC_NOTION_KEY}`,
    'Notion-Version': '2022-06-28', 'Content-Type': 'application/json',
  } });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toEqual({
    parent: { database_id: SYNTHETIC_DB },
    properties: {
      '标题': { title: [{ text: { content: 'Test Video' } }] },
      '链接': { url: 'https://example.invalid/synthetic-clip' },
      '日期': { date: { start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } },
      '状态': { status: { name: '未使用' } },
      '平台': { select: { name: 'douyin' } },
    },
    children: [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '转写文案' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'hello world' } }] } },
    ],
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('clips router — exports', () => {
  it('exports an express router function', async () => {
    const { default: router } = await import('../clips.js');
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});

describe('POST /api/brain/clips — create clip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 201 with id and status=pending on success', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', status: 'pending', created_at: '2026-05-20T00:00:00Z' }],
    });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips')
      .send({ url: 'https://v.douyin.com/xxx' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('uuid-1');
    expect(res.body.status).toBe('pending');
    expect(extractClip).toHaveBeenCalledOnce();
    expect(extractClip).toHaveBeenCalledWith('uuid-1', 'https://v.douyin.com/xxx');
  });

  it('returns 400 if url is missing', async () => {
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app).post('/api/brain/clips').send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 if url already exists (unique constraint)', async () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    pool.query
      .mockRejectedValueOnce(err)  // first call: INSERT throws 23505
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid', status: 'done' }] }); // second call: SELECT existing
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips')
      .send({ url: 'https://v.douyin.com/duplicate' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_exists');
  });
});

describe('GET /api/brain/clips — list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with data array', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-1', url: 'https://v.douyin.com/xxx', platform: 'douyin', status: 'done' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app).get('/api/brain/clips');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });
});

describe('POST /api/brain/clips/:id/callback — content-service result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLIPS_WEBHOOK_SECRET;
  });

  it('updates clip to done and returns 200', async () => {
    const notionFetch = recordNotionWrite();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', status: 'done', url: 'https://example.invalid/synthetic-clip', platform: 'douyin' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips/uuid-1/callback')
      .send({ success: true, title: 'Test Video', transcript: 'hello world', platform: 'douyin' });

    expect(res.status).toBe(200);
    expectNotionWrite(notionFetch);
  });

  it('returns 401 when CLIPS_WEBHOOK_SECRET set and header missing', async () => {
    process.env.CLIPS_WEBHOOK_SECRET = 'test-secret';
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips/uuid-1/callback')
      .send({ success: true, title: 'Test Video' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns 401 when CLIPS_WEBHOOK_SECRET set and header wrong', async () => {
    process.env.CLIPS_WEBHOOK_SECRET = 'test-secret';
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips/uuid-1/callback')
      .set('x-webhook-secret', 'wrong-secret')
      .send({ success: true, title: 'Test Video' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('passes auth and updates clip when correct secret provided', async () => {
    const notionFetch = recordNotionWrite();
    process.env.CLIPS_WEBHOOK_SECRET = 'test-secret';
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', status: 'done', url: 'https://example.invalid/synthetic-clip', platform: 'douyin' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);

    const res = await request(app)
      .post('/api/brain/clips/uuid-1/callback')
      .set('x-webhook-secret', 'test-secret')
      .send({ success: true, title: 'Test Video', transcript: 'hello world' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expectNotionWrite(notionFetch);
  });
});

// 失败/未配置token分支不能借“成功HTTP”隐式访问Notion。
describe('clips callback 无Notion写入分支', () => {
  it('内容服务失败仍记录failed，不调用Notion或重启提取', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);
    const res = await request(app).post('/api/brain/clips/uuid-1/callback')
      .send({ success: false, error: 'synthetic extraction failure' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'failed' });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status='failed'"),
      ['uuid-1', 'synthetic extraction failure']);
    expect(extractClip).not.toHaveBeenCalled();
  });

  it('未配置Notion token仍按原合同完成callback，不请求Notion', async () => {
    vi.stubEnv('NOTION_API_KEY', '');
    delete process.env.NOTION_API_KEY;
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1', status: 'done' }] });
    const { default: router } = await import('../clips.js');
    const app = makeApp();
    app.use('/api/brain/clips', router);
    const res = await request(app).post('/api/brain/clips/uuid-1/callback')
      .send({ success: true, title: 'Test Video', transcript: 'hello world' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'done' });
    expect(extractClip).not.toHaveBeenCalled();
  });
});
