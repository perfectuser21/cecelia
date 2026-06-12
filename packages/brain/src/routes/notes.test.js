import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../recurring-notion-sync.js', () => ({
  getToken: vi.fn(() => 'test-token'),
  notionReq: vi.fn(),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { notionReq } from '../recurring-notion-sync.js';
import pool from '../db.js';
import notesRouter from './notes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', notesRouter);
  return app;
}

// 帮助函数：为 POST /notes 设置 notionReq mock（schema GET + page POST 各一次）
function mockNotesReq({ schemaProperties = {}, page = { id: 'page-id', url: 'https://notion.so/page-id' } } = {}) {
  notionReq.mockResolvedValueOnce({ properties: schemaProperties }); // schema GET
  notionReq.mockResolvedValueOnce(page);                             // page POST
}

// 帮助函数：找 POST /pages 调用
function findPageCreateCall() {
  return notionReq.mock.calls.find(c => c[2] === 'POST' && c[1] === '/pages');
}

describe('notes routes', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/brain/notes', () => {
    it('returns 400 if title missing', async () => {
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ content: 'c', type: 'Note' });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    });

    it('returns 400 if content missing', async () => {
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 't', type: 'Note' });
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    });

    it('returns 201 with {id, url, title, warnings} on success', async () => {
      mockNotesReq();
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 'My Note', content: 'body', type: 'Note' });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['id', 'title', 'url', 'warnings']);
      expect(res.body.title).toBe('My Note');
    });

    it('passes initiative_id to Notion properties and DB when in schema', async () => {
      const iid = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb';
      // schema 包含 'Initiative ID' → 写入 Notion properties
      mockNotesReq({ schemaProperties: { 'Initiative ID': { type: 'rich_text' } } });
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 'Sprint Note', content: 'body', type: 'Report', initiative_id: iid });
      expect(res.status).toBe(201);
      // Notion 调用携带 Initiative ID 属性（在 POST /pages 调用中）
      const notionBody = findPageCreateCall()[3];
      expect(notionBody.properties['Initiative ID']).toBeDefined();
      expect(notionBody.properties['Initiative ID'].rich_text[0].text.content).toBe(iid);
      // DB 调用带 initiative_id 参数
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('initiative_id'),
        [res.body.title, 'body', 'Report', iid],
      );
    });

    it('omits Initiative ID property when initiative_id not provided', async () => {
      mockNotesReq();
      await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 'Plain Note', content: 'body', type: 'Note' });
      const notionBody = findPageCreateCall()[3];
      expect(notionBody.properties['Initiative ID']).toBeUndefined();
      // DB 调用时 initiative_id 为 null
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('initiative_id'),
        ['Plain Note', 'body', 'Note', null],
      );
    });

    it('returns 201 even when DB insert fails', async () => {
      mockNotesReq();
      pool.query.mockRejectedValueOnce(new Error('db down'));
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 't', content: 'c', type: 'Note' });
      expect(res.status).toBe(201);
    });

    it('returns 502 if notion API throws', async () => {
      // 第一次调用（schema GET）抛出 → getDbSchemaProperties 捕获，返回 {}
      // 第二次调用（page POST）返回 undefined（无 mock）→ page.id 抛出 → 502
      notionReq.mockRejectedValueOnce(new Error('timeout'));
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 't', content: 'c', type: 'Note' });
      expect(res.status).toBe(502);
      expect(typeof res.body.error).toBe('string');
    });
  });

  describe('POST /api/brain/notion/project', () => {
    it('returns 400 if title missing', async () => {
      const res = await request(makeApp()).post('/api/brain/notion/project').send({});
      expect(res.status).toBe(400);
    });

    it('prefixes title with [Sprint] and returns {id, url, title}', async () => {
      notionReq.mockResolvedValueOnce({ id: 'proj-id', url: 'https://notion.so/proj-id' });
      const res = await request(makeApp())
        .post('/api/brain/notion/project')
        .send({ title: 'MyRun' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('[Sprint] MyRun');
      expect(Object.keys(res.body).sort()).toEqual(['id', 'title', 'url']);
    });
  });

  describe('POST /api/brain/notion/task', () => {
    it('returns 400 if title missing', async () => {
      const res = await request(makeApp()).post('/api/brain/notion/task').send({});
      expect(res.status).toBe(400);
    });

    it('prefixes title with [WS{n}] when ws_number provided', async () => {
      // notion/task: schema GET + page POST
      notionReq.mockResolvedValueOnce({ properties: { Name: { type: 'title' } } });
      notionReq.mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
      const res = await request(makeApp())
        .post('/api/brain/notion/task')
        .send({ title: '实现功能X', ws_number: 2 });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('[WS2] 实现功能X');
      expect(Object.keys(res.body).sort()).toEqual(['id', 'title', 'url']);
    });

    it('skips prefix if title already contains [WSn]', async () => {
      notionReq.mockResolvedValueOnce({ properties: { Name: { type: 'title' } } });
      notionReq.mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
      const res = await request(makeApp())
        .post('/api/brain/notion/task')
        .send({ title: '[WS3] already prefixed', ws_number: 3 });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('[WS3] already prefixed');
    });
  });
});

describe('notes.js TASKS_DB env var 注入', () => {
  it('notes.js 文件包含 NOTION_TASKS_DB_ID env var 引用', async () => {
    // 覆盖 notes.js TASKS_DB 修复：确认代码已改用 env var
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.default.readFileSync(
      path.default.resolve(path.default.dirname(new URL(import.meta.url).pathname), './notes.js'),
      'utf8'
    );
    expect(src).toContain('NOTION_TASKS_DB_ID');
    expect(src).toContain('process.env');
  });

  it('notes.js TASKS_DB fallback 为正确的 Notion Tasks DB ID（非 TODO 占位）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.default.readFileSync(
      path.default.resolve(path.default.dirname(new URL(import.meta.url).pathname), './notes.js'),
      'utf8'
    );
    // 确认 fallback 已从 TODO_SET_CORRECT_DB_ID 改为正确 DB ID
    expect(src).not.toContain('TODO_SET_CORRECT_DB_ID');
    expect(src).toContain('d5bc40c2-ba63-82ef-965a-8153b7ad81a0');
  });
});
