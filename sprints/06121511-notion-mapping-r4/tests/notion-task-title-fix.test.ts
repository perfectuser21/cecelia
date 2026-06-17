/**
 * TDD Red: POST /api/brain/notion/task Title→Name 属性修复测试
 *
 * 当前 notes.js 硬编码 'Title' 写 TASKS_DB，但 Tasks DB 的 title property 实际名称为 'Name'。
 * 修复后应：查 schema 获取 title property 的真实名称，用该名称写入（不硬编码 'Title'）。
 *
 * 这些测试在修复前 FAIL，修复后 PASS。
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockNotionReq = vi.fn();
const mockGetToken = vi.fn(() => 'test-token');
const mockPoolQuery = vi.fn();

vi.mock('../../../packages/brain/src/recurring-notion-sync.js', () => ({
  notionReq: (...args: unknown[]) => mockNotionReq(...args),
  getToken: () => mockGetToken(),
}));

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

let router: express.Router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../../packages/brain/src/routes/notes.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('POST /notion/task — Title 属性名校准 [BEHAVIOR]', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it('Tasks DB schema title property 为 Name 时 — properties 使用 Name 而非 Title', async () => {
    // Schema 返回：Tasks DB 的 title property 名称是 "Name"（非 "Title"）
    mockNotionReq
      .mockResolvedValueOnce({
        properties: {
          Name: { type: 'title' },   // title property 真实名称
          Status: { type: 'select' },
        },
      })
      .mockResolvedValueOnce({ id: 'task-page-1', url: 'https://notion.so/task-page-1' });

    const res = await request(app).post('/notion/task').send({
      title: 'R4 task test',
      ws_number: 1,
    });

    expect(res.status).toBe(201);

    const createCall = mockNotionReq.mock.calls.find(
      (c) => c[2] === 'POST' && c[1] === '/pages'
    );
    expect(createCall).toBeDefined();

    const properties = createCall![3].properties;
    // 关键断言：使用 schema 返回的 title property 名称（Name），不硬编码 Title
    expect(properties).toHaveProperty('Name');
    expect(properties).not.toHaveProperty('Title');
  });

  it('Tasks DB schema title property 为 Title 时 — properties 仍使用 Title（向后兼容）', async () => {
    // 如果 DB schema 的 title property 确实叫 "Title"，也应正常工作
    mockNotionReq
      .mockResolvedValueOnce({
        properties: {
          Title: { type: 'title' },
        },
      })
      .mockResolvedValueOnce({ id: 'task-page-2', url: 'https://notion.so/task-page-2' });

    const res = await request(app).post('/notion/task').send({
      title: 'R4 task fallback',
    });

    expect(res.status).toBe(201);

    const createCall = mockNotionReq.mock.calls.find(
      (c) => c[2] === 'POST' && c[1] === '/pages'
    );
    expect(createCall).toBeDefined();
    expect(createCall![3].properties).toHaveProperty('Title');
  });

  it('response schema keys 完整性 — [id, title, url]，无 warnings', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ properties: { Name: { type: 'title' } } })
      .mockResolvedValueOnce({ id: 'task-page-3', url: 'https://notion.so/task-page-3' });

    const res = await request(app).post('/notion/task').send({ title: 'keys check' });

    expect(res.status).toBe(201);
    // notion/task 响应不含 warnings
    expect(res.body).not.toHaveProperty('warnings');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('url');
    expect(res.body).toHaveProperty('title');
    // keys 完整性
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['id', 'title', 'url']);
  });

  it('error path — 缺少 title → 400 + error 字段', async () => {
    const res = await request(app).post('/notion/task').send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });
});
