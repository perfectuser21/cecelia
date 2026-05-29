/**
 * Regression test: POST /api/brain/notion/task
 *
 * Bug: TASKS_DB = AI_NOTES_DB，AI Notes DB 无 Status property，
 *      handler 往 Notion properties 写 Status → Notion 400 → API 502
 * Fix: 从 properties 移除 Status，写入 page children body 段落
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 必须在 import router 前 mock notionReq
const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'test-notion-token');

vi.mock('../../recurring-notion-sync.js', () => ({
  notionReq: (...args) => mockNotionReq(...args),
  getToken: () => mockGetToken(),
}));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/notes.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('POST /notion/task', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockNotionReq.mockResolvedValue({ id: 'page-123', url: 'https://notion.so/page-123' });
  });

  it('不带 status 时返回 201', async () => {
    const res = await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('page-123');
  });

  it('带 status 时 Notion properties 中不含 Status 字段（Bug 2 回归）', async () => {
    await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature', status: 'Done' });

    expect(mockNotionReq).toHaveBeenCalledOnce();
    const callArgs = mockNotionReq.mock.calls[0];
    // callArgs = [token, '/pages', 'POST', body]
    const notionBody = callArgs[3];
    // properties 中不能有 Status（AI Notes DB 无此 property）
    expect(notionBody.properties).not.toHaveProperty('Status');
  });

  it('带 status 时 status 值出现在 children paragraph 中', async () => {
    await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature', status: 'Done' });

    const callArgs = mockNotionReq.mock.calls[0];
    const notionBody = callArgs[3];
    // children 应包含含有 status 文本的段落
    const children = notionBody.children || [];
    const allText = children
      .map(b => b.paragraph?.rich_text?.map(rt => rt.text?.content).join('') || '')
      .join(' ');
    expect(allText).toContain('Done');
  });

  it('缺少 title 返回 400', async () => {
    const res = await request(app)
      .post('/notion/task')
      .send({ status: 'Done' });
    expect(res.status).toBe(400);
  });
});
