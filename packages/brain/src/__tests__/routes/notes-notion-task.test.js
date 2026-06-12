/**
 * Regression test: POST /api/brain/notion/task + POST /api/brain/notes
 *
 * Bug 1: TASKS_DB = AI_NOTES_DB，AI Notes DB 无 Status property，
 *        handler 往 Notion properties 写 Status → Notion 400 → API 502
 * Fix 1: 从 properties 移除 Status，写入 page children body 段落
 *
 * Bug 2 (R4): notes.js 硬编码 'Initiative ID' 写入，DB schema 无该属性 → Notion 400
 * Fix 2 (R4): 查 schema → 属性缺失 → 跳过 + response.warnings 数组留痕
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 必须在 import router 前 mock notionReq
const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'test-notion-token');
const mockPoolQuery = vi.fn();

vi.mock('../../recurring-notion-sync.js', () => ({
  notionReq: (...args) => mockNotionReq(...args),
  getToken: () => mockGetToken(),
}));

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockPoolQuery(...args) },
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
    mockPoolQuery.mockResolvedValue({ rows: [] });
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

    // notionReq 被调两次：schema GET + pages POST
    expect(mockNotionReq).toHaveBeenCalledTimes(2);
    const callArgs = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
    const notionBody = callArgs[3];
    // properties 中不能有 Status（AI Notes DB 无此 property）
    expect(notionBody.properties).not.toHaveProperty('Status');
  });

  it('带 status 时 status 值出现在 children paragraph 中', async () => {
    await request(app)
      .post('/notion/task')
      .send({ title: 'WS1 — feat: some feature', status: 'Done' });

    const callArgs = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
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

describe('POST /notes — Initiative ID 降级回归 [ARTIFACT R4]', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it('Initiative ID 不在 schema 时 — properties 不含 Initiative ID + warnings 数组含说明', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Title: { type: 'title' }, Type: { type: 'select' } } })
      .mockResolvedValueOnce({ id: 'page-degrade', url: 'https://notion.so/page-degrade' });

    const res = await request(app).post('/notes').send({
      title: 'Regression note',
      content: 'content',
      initiative_id: 'test-init-degrade',
    });

    expect(res.status).toBe(201);
    const createCall = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
    expect(createCall[3].properties).not.toHaveProperty('Initiative ID');
    expect(res.body.warnings).toBeDefined();
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.some(w => w.includes('Initiative ID'))).toBe(true);
  });

  it('Initiative ID 在 schema 时 — properties 含 Initiative ID，warnings 为空', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Title: { type: 'title' }, 'Initiative ID': { type: 'rich_text' } } })
      .mockResolvedValueOnce({ id: 'page-has-init', url: 'https://notion.so/page-has-init' });

    const res = await request(app).post('/notes').send({
      title: 'Has init note',
      content: 'content',
      initiative_id: 'test-init-present',
    });

    expect(res.status).toBe(201);
    const createCall = mockNotionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
    expect(createCall[3].properties).toHaveProperty('Initiative ID');
    expect(res.body.warnings).toEqual([]);
  });
});
