/**
 * 回归：内容流水线别名挂载（/api/brain）的 /:id/{stats|stages|output|publish-status}
 * 曾把 /api/brain/runs/stats 等接走，id='runs' 当 uuid 查 PG → 500 回显 PG 错误。
 * 修复后：别名挂载下非 UUID 放行给后续 runs 读路由；/pipelines 下非 UUID 返回 400。
 * 挂载顺序与 server.js 一致：pipelines → 别名 /api/brain → /api/brain/runs。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn(),
  getContentType: vi.fn(),
  getContentTypeFromYaml: vi.fn(),
  listContentTypesFromYaml: vi.fn(),
}));

import { listContentTypes, getContentTypeFromYaml, getContentType } from '../content-types/content-type-registry.js';
import contentPipelineRouter from '../routes/content-pipeline.js';
import { createRunsReadRouter } from '../routes/runs-read.js';

const SUFFIXES = ['stats', 'stages', 'output', 'publish-status'];
const PIPELINE_SQL = /pipeline_publish_stats|parent_pipeline_id|publish_results|FROM tasks WHERE id/;
const UUID = '11111111-1111-4111-8111-111111111111';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/pipelines', contentPipelineRouter);
  app.use('/api/brain', contentPipelineRouter);
  app.use('/api/brain/runs', createRunsReadRouter({ pool: mockPool }));
  return app;
}

function pipelineSqlCalls() {
  return mockPool.query.mock.calls.filter(([sql]) => PIPELINE_SQL.test(String(sql)));
}

describe('别名挂载不再吞掉 /api/brain/runs/<段>', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    delete process.env.CECELIA_INTERNAL_TOKEN;
  });

  it.each(SUFFIXES)('GET /api/brain/runs/%s 由 runs 读路由按 run_id 处理，404', async (seg) => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get(`/api/brain/runs/${seg}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe(`run not found: ${seg}`);
    expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM runs WHERE run_id = $1', [seg]);
    expect(pipelineSqlCalls()).toHaveLength(0);
  });

  it('coding-workflow:<uuid> 编码 run_id 走 runs 读路由，200 返回行', async () => {
    const rid = `coding-workflow:${UUID}`;
    mockPool.query.mockResolvedValue({ rows: [{ run_id: rid, outcome: 'pass' }] });
    const res = await request(makeApp()).get(`/api/brain/runs/${encodeURIComponent(rid)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run_id: rid, outcome: 'pass' });
    expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM runs WHERE run_id = $1', [rid]);
  });

  it('?include=spans 走 pool.connect 事务分支，返回带 spans 的 200', async () => {
    const rid = `coding-workflow:${UUID}`;
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.startsWith('SELECT * FROM runs')) return { rows: [{ run_id: rid }] };
        if (sql.startsWith('SELECT * FROM spans')) return { rows: [{ occurrence_key: 'qa/a' }, { occurrence_key: 'qa/b' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(client);
    const res = await request(makeApp()).get(`/api/brain/runs/${encodeURIComponent(rid)}?include=spans`);
    expect(res.status).toBe(200);
    expect(res.body.spans.map(s => s.occurrence_key)).toEqual(['qa/a', 'qa/b']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// Q-2 鉴权分支：配了 token 时 /api/brain/runs/<段> 必须先过 runs 读路由的鉴权，
// 不带 token → 401，证明没被不鉴权的内容流水线接走（预览环境未配 token 时由此兜底）。
describe('配置 CECELIA_INTERNAL_TOKEN 时 /api/brain/runs/<段> 先过鉴权', () => {
  const TOKEN = 'test-internal-token';

  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    process.env.CECELIA_INTERNAL_TOKEN = TOKEN;
  });

  afterEach(() => {
    delete process.env.CECELIA_INTERNAL_TOKEN;
  });

  it.each(SUFFIXES)('不带 token GET /api/brain/runs/%s → 401 UNAUTHORIZED，不查库', async (seg) => {
    const res = await request(makeApp()).get(`/api/brain/runs/${seg}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('带正确 token GET /api/brain/runs/stats → runs 读路由 404', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/runs/stats').set('x-internal-token', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('run not found: stats');
    expect(pipelineSqlCalls()).toHaveLength(0);
  });
});

describe('/api/brain/pipelines 下非 UUID id 返回 400，不进 PG', () => {
  beforeEach(() => mockPool.query.mockReset());

  it.each(SUFFIXES)('GET /api/brain/pipelines/not-a-uuid/%s → 400', async (seg) => {
    const res = await request(makeApp()).get(`/api/brain/pipelines/not-a-uuid/${seg}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid pipeline id: must be a UUID' });
    expect(JSON.stringify(res.body)).not.toContain('invalid input syntax');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('SQL 片段与超长串同样 400', async () => {
    for (const id of [encodeURIComponent("1' OR '1'='1"), 'a'.repeat(300)]) {
      const res = await request(makeApp()).get(`/api/brain/pipelines/${id}/stats`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid pipeline id: must be a UUID');
    }
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

describe('合法 UUID 与 content-types 别名原有行为不变', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    vi.mocked(listContentTypes).mockReset();
  });

  it('GET /api/brain/pipelines/<uuid>/stats → 200，pipeline_id 回显', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ platform: 'douyin', views: '10', likes: '2', comments: '1', shares: '0', last_scraped_at: null, scrape_count: '1' }],
    });
    const res = await request(makeApp()).get(`/api/brain/pipelines/${UUID}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.pipeline_id).toBe(UUID);
    expect(res.body.stats[0]).toMatchObject({ platform: 'douyin', views: 10, likes: 2 });
  });

  it('大写 UUID 视为合法', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const upper = UUID.toUpperCase();
    const res = await request(makeApp()).get(`/api/brain/pipelines/${upper}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pipeline_id: upper, stats: [] });
  });

  it('别名挂载下 GET /api/brain/<uuid>/stages 仍由内容流水线返回 200', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ task_type: 'content-research', status: 'completed', started_at: null, completed_at: null, summary: null, review_issues: null, review_passed: null, rule_scores: null, llm_reviewed: null }] });
    const res = await request(makeApp()).get(`/api/brain/${UUID}/stages`);
    expect(res.status).toBe(200);
    expect(res.body.pipeline_id).toBe(UUID);
    expect(res.body.stages['content-research'].status).toBe('completed');
  });

  it('GET /api/brain/content-types 走别名挂载 200', async () => {
    vi.mocked(listContentTypes).mockResolvedValue(['solo-company-case']);
    const res = await request(makeApp()).get('/api/brain/content-types');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['solo-company-case']);
  });

  it('GET /api/brain/content-types/<type>/config 不被 guard 拦截', async () => {
    vi.mocked(getContentType).mockResolvedValue({ content_type: 'solo-company-case' });
    vi.mocked(getContentTypeFromYaml).mockResolvedValue({ content_type: 'solo-company-case' });
    mockPool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/content-types/solo-company-case/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ content_type: 'solo-company-case', source: 'yaml' });
  });
});
