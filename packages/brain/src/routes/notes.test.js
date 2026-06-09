import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../recurring-notion-sync.js', () => ({
  getToken: vi.fn(() => 'test-token'),
  notionReq: vi.fn(),
}));

import { notionReq } from '../recurring-notion-sync.js';
import notesRouter from './notes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', notesRouter);
  return app;
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

    it('returns 201 with {id, url, title} on success', async () => {
      notionReq.mockResolvedValueOnce({ id: 'page-id', url: 'https://notion.so/page-id' });
      const res = await request(makeApp())
        .post('/api/brain/notes')
        .send({ title: 'My Note', content: 'body', type: 'Note' });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['id', 'title', 'url']);
      expect(res.body.title).toBe('My Note');
    });

    it('returns 502 if notion API throws', async () => {
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
      notionReq.mockResolvedValueOnce({ id: 'task-id', url: 'https://notion.so/task-id' });
      const res = await request(makeApp())
        .post('/api/brain/notion/task')
        .send({ title: '实现功能X', ws_number: 2 });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('[WS2] 实现功能X');
      expect(Object.keys(res.body).sort()).toEqual(['id', 'title', 'url']);
    });

    it('skips prefix if title already contains [WSn]', async () => {
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
      path.default.resolve(path.default.dirname(new URL(import.meta.url).pathname), '../notes.js'),
      'utf8'
    );
    expect(src).toContain('NOTION_TASKS_DB_ID');
    expect(src).toContain('process.env');
  });
});
