import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), notionReq: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: mocks.query, connect: mocks.connect } }));

vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: (...args) => mocks.notionReq(...args) }));

import projectionsRouter from '../projections.js';

describe('projections routes', () => {
  it('returns the canonical Workbench summary from Brain tables', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ waiting: 3, ready: 1, ide: 1, pipeline: 1, in_progress: 1, blocked: 0, done: 3, dropped: 0 }] })
      .mockResolvedValueOnce({ rows: [{ captured: 4, clarified: 1 }] })
      .mockResolvedValueOnce({ rows: [{ pending: 2, dead: 0 }] });
    const app = express();
    app.use('/api/brain', projectionsRouter);

    const response = await request(app).get('/api/brain/workbench/summary');

    expect(response.status).toBe(200);
    const taskSummarySql = mocks.query.mock.calls[0][0];
    expect(taskSummarySql).toContain('AS ready');
    expect(taskSummarySql).toContain('AS ide');
    expect(taskSummarySql).toContain('AS pipeline');
    expect(taskSummarySql).toContain("payload->>'headed_manual'");
    expect(taskSummarySql).toContain("task_type IN ('content-pipeline'");
    expect(response.body).toEqual({
      tasks: { waiting: 3, ready: 1, ide: 1, pipeline: 1, in_progress: 1, blocked: 0, done: 3, dropped: 0 },
      captures: { captured: 4, clarified: 1 },
      projection: { pending: 2, dead: 0 },
    });
  });

  it('对数据库投影端点统一限流，避免无界查询压垮 Brain', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const app = express();
    app.use('/api/brain', projectionsRouter);
    const server = await new Promise((resolve) => {
      const listeningServer = app.listen(0, () => resolve(listeningServer));
    });

    let response;
    try {
      const client = request(server);
      for (let requestIndex = 0; requestIndex < 301; requestIndex += 1) {
        response = await client.get('/api/brain/projections/status');
      }
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(response.status).toBe(429);
  });
});

describe('KR配置API真实路由挂接', () => {
  it('无database_id必须返回400，已路由到窄配置校验', async () => {
    const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/api/brain', projectionsRouter);
    const response = await request(app).post('/api/brain/projections/notion/key-results/configure').set('X-Forwarded-For', '192.0.2.71').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('UUID');
  });
});


it('KR配置API成功返回规范库ID并调用事务登记', async () => {
  const tokenBefore = process.env.NOTION_API_KEY;
  process.env.NOTION_API_KEY = 'fake';
  mocks.notionReq.mockResolvedValue({ title: [{ plain_text: 'Brain Key Results' }], properties: Object.fromEntries(Object.entries({Name:'title','Brain ID':'rich_text',Status:'select',Progress:'number',Current:'number',Target:'number',Unit:'rich_text',Source:'rich_text','Brain Updated At':'date'}).map(([name,type]) => [name,{type}])) });
  const query = vi.fn(async () => ({ rows: [], rowCount: 1 })), release = vi.fn();
  mocks.connect.mockResolvedValue({ query, release });
  const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/api/brain', projectionsRouter);
  try {
    const response = await request(app).post('/api/brain/projections/notion/key-results/configure').set('X-Forwarded-For', '192.0.2.72').send({ database_id: '11111111111141118111111111111111' });
    expect(response.status).toBe(200);
    expect(response.body.database_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  } finally {
    if (tokenBefore === undefined) delete process.env.NOTION_API_KEY; else process.env.NOTION_API_KEY = tokenBefore;
  }
});
