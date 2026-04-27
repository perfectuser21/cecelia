/**
 * content-pipeline 路由单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock content-type-registry
vi.mock('../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn(),
  getContentType: vi.fn(),
  getContentTypeFromYaml: vi.fn(),
  listContentTypesFromYaml: vi.fn(),
}));

import pool from '../db.js';
import { listContentTypes, getContentType } from '../content-types/content-type-registry.js';
import contentPipelineRouter from '../routes/content-pipeline.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/pipelines', contentPipelineRouter);
  app.use('/api/brain', contentPipelineRouter);
  return app;
}

describe('GET /api/brain/content-types', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回内容类型数组', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case', 'short-video']);
    const res = await request(makeApp()).get('/api/brain/content-types');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['solo-company-case', 'short-video']);
  });

  it('registry 异常时返回 500', async () => {
    listContentTypes.mockRejectedValue(new Error('目录读取失败'));
    const res = await request(makeApp()).get('/api/brain/content-types');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('目录读取失败');
  });
});

describe('GET /api/brain/pipelines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 content-pipeline 任务列表', async () => {
    const rows = [
      { id: 'abc-1', title: '[内容工厂] 字节跳动', status: 'queued', priority: 'P1', payload: {}, created_at: new Date() },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toContain('字节跳动');
  });

  it('DB 异常时返回 500', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(500);
  });

  it('响应包含 error_message 字段（成功时为 null，失败时为字符串）', async () => {
    const rows = [
      { id: 'ok-1', title: '[内容工厂] 字节跳动', status: 'completed', priority: 'P1', payload: {}, created_at: new Date(), started_at: null, completed_at: new Date(), error_message: null },
      { id: 'fail-1', title: '[内容工厂] 美团', status: 'failed', priority: 'P1', payload: {}, created_at: new Date(), started_at: null, completed_at: new Date(), error_message: 'content_type "bad-type" 不存在于注册表' },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(Object.prototype.hasOwnProperty.call(res.body[0], 'error_message')).toBe(true);
    expect(res.body[0].error_message).toBeNull();
    expect(res.body[1].error_message).toContain('不存在于注册表');
  });
});

describe('POST /api/brain/pipelines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('成功创建 content-pipeline 任务', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const newRow = {
      id: 'new-id', title: '[内容工厂] 字节跳动 (solo-company-case)',
      status: 'queued', priority: 'P1', payload: {}, created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动', content_type: 'solo-company-case' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('queued');
  });

  it('缺少 keyword 时返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ content_type: 'solo-company-case' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('keyword');
  });

  it('缺少 content_type 时返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('content_type');
  });

  it('content_type 不存在时返回 400', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动', content_type: 'unknown-type' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unknown-type');
  });

  it('priority 非法时返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '字节跳动', content_type: 'solo-company-case', priority: 'P9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('priority');
  });
});

describe('POST /api/brain/pipelines/batch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('批量创建 5 条 pipeline 返回 201 + 5 条记录', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const mockRow = { id: 'mock-id', title: '[内容工厂] test', status: 'queued', priority: 'P1', payload: {}, created_at: new Date() };
    pool.query.mockResolvedValue({ rows: [mockRow] });

    const items = [
      { keyword: '字节跳动', content_type: 'solo-company-case' },
      { keyword: '美团', content_type: 'solo-company-case' },
      { keyword: '拼多多', content_type: 'solo-company-case' },
      { keyword: '滴滴', content_type: 'solo-company-case' },
      { keyword: '快手', content_type: 'solo-company-case' },
    ];
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(5);
    expect(res.body.pipelines).toHaveLength(5);
  });

  it('items 少于 2 返回 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items: [{ keyword: '字节跳动', content_type: 'solo-company-case' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('至少 2 项');
  });

  it('items 超过 20 返回 400', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ keyword: `关键词${i}`, content_type: 'solo-company-case' }));
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('不超过 20 项');
  });

  it('非法 content_type 返回 400', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({ items: [
        { keyword: '字节跳动', content_type: 'solo-company-case' },
        { keyword: '美团', content_type: 'unknown-type' },
      ]});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unknown-type');
  });

  it('使用 default_content_type 批量创建', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    const mockRow = { id: 'mock-id', title: '[内容工厂] test', status: 'queued', priority: 'P1', payload: {}, created_at: new Date() };
    pool.query.mockResolvedValue({ rows: [mockRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines/batch')
      .send({
        items: [{ keyword: '字节跳动' }, { keyword: '美团' }],
        default_content_type: 'solo-company-case',
      });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
  });
});

describe('GET /api/brain/pipelines/:id/stages — rule_scores & llm_reviewed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stages 响应包含 review_passed 字段（true）', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          task_type: 'content-copy-review',
          status: 'completed',
          started_at: new Date(),
          completed_at: new Date(),
          result: null,
          review_passed: 'true',
          rule_scores: null,
          llm_reviewed: null,
        },
      ],
    });
    const res = await request(makeApp()).get('/api/brain/pipelines/pipe-1/stages');
    expect(res.status).toBe(200);
    expect(res.body.stages['content-copy-review'].review_passed).toBe(true);
  });

  it('stages 响应包含 rule_scores 数组（当 DB 有值时）', async () => {
    const scores = [{ id: 'tone', score: 8, pass: true }, { id: 'length', score: 5, pass: false }];
    pool.query.mockResolvedValue({
      rows: [
        {
          task_type: 'content-copy-review',
          status: 'completed',
          started_at: new Date(),
          completed_at: new Date(),
          result: null,
          review_passed: 'true',
          rule_scores: scores,
          llm_reviewed: 'true',
        },
      ],
    });
    const res = await request(makeApp()).get('/api/brain/pipelines/pipe-1/stages');
    expect(res.status).toBe(200);
    const stage = res.body.stages['content-copy-review'];
    expect(stage.rule_scores).toEqual(scores);
    expect(stage.llm_reviewed).toBe(true);
  });

  it('stages 响应不包含 rule_scores 字段（当 DB 值为 null 时）', async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          task_type: 'content-copy-review',
          status: 'completed',
          started_at: new Date(),
          completed_at: new Date(),
          result: null,
          review_passed: null,
          rule_scores: null,
          llm_reviewed: null,
        },
      ],
    });
    const res = await request(makeApp()).get('/api/brain/pipelines/pipe-1/stages');
    expect(res.status).toBe(200);
    const stage = res.body.stages['content-copy-review'];
    expect(stage).not.toHaveProperty('rule_scores');
    expect(stage).not.toHaveProperty('llm_reviewed');
    expect(stage).not.toHaveProperty('review_passed');
  });
});

describe('POST /api/brain/pipelines/:id/run — 编排已搬走，只负责重置 + 202', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completed pipeline → 重置为 queued + 返回 202', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'pipe-1', status: 'completed', payload: {} }] })  // SELECT
      .mockResolvedValueOnce({ rows: [] });  // UPDATE 重置

    const res = await request(makeApp()).post('/api/brain/pipelines/pipe-1/run');
    expect(res.status).toBe(202);
    expect(res.body.pipeline_id).toBe('pipe-1');
    // 不应再调 orchestrate（in-Brain 编排已搬走）
    // 验证只调了 SELECT + UPDATE 两次 query，没有后续 orchestrate 调用
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('queued pipeline → 不重置，直接 202', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'pipe-2', status: 'queued', payload: {} }] });

    const res = await request(makeApp()).post('/api/brain/pipelines/pipe-2/run');
    expect(res.status).toBe(202);
    // 仅 SELECT 一次（不需要 UPDATE）
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('pipeline 不存在 → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).post('/api/brain/pipelines/missing/run');
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/run-langgraph — endpoint 已删除', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 404（路由已删）', async () => {
    const res = await request(makeApp()).post('/api/brain/pipelines/pipe-1/run-langgraph');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/brain/pipelines/e2e-trigger — 编排搬走后只创 task', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 200 + pipeline_id（不再同步 orchestrate）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'pipe-e2e-1' }] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines/e2e-trigger')
      .send({ keyword: 'cursor', skip_topic_selection: true });

    expect(res.status).toBe(200);
    expect(res.body.pipeline_id).toBe('pipe-e2e-1');
    // 只 INSERT 一次（不再 orchestrate / executeQueued）
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/brain/pipelines — notebook_id 自动读取 + fail-fast 记录', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未传 notebook_id 时从 content-type 配置自动读取', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({ notebook_id: 'nb-auto-123', content_type: 'solo-company-case' });
    const newRow = {
      id: 'nb-auto-id',
      title: '[内容工厂] 测试关键词 (solo-company-case)',
      status: 'queued',
      priority: 'P1',
      payload: { keyword: '测试关键词', content_type: 'solo-company-case', notebook_id: 'nb-auto-123' },
      created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '测试关键词', content_type: 'solo-company-case' });

    expect(res.status).toBe(201);
    // 验证 pool.query 被调用时 payload 包含自动读取的 notebook_id
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT'));
    expect(insertCall).toBeDefined();
    const payloadArg = JSON.parse(insertCall[1][6]);
    expect(payloadArg.notebook_id).toBe('nb-auto-123');
  });

  it('请求中传入 notebook_id 时优先使用请求值', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({ notebook_id: 'nb-from-yaml', content_type: 'solo-company-case' });
    const newRow = {
      id: 'nb-req-id',
      title: '[内容工厂] 测试关键词 (solo-company-case)',
      status: 'queued',
      priority: 'P1',
      payload: { keyword: '测试关键词', content_type: 'solo-company-case', notebook_id: 'nb-from-request' },
      created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '测试关键词', content_type: 'solo-company-case', notebook_id: 'nb-from-request' });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT'));
    const payloadArg = JSON.parse(insertCall[1][6]);
    expect(payloadArg.notebook_id).toBe('nb-from-request');
  });

  it('content-type 配置无 notebook_id 时 payload 不包含 notebook_id', async () => {
    listContentTypes.mockResolvedValue(['solo-company-case']);
    getContentType.mockResolvedValue({ notebook_id: '', content_type: 'solo-company-case' });
    const newRow = {
      id: 'no-nb-id',
      title: '[内容工厂] 无notebook (solo-company-case)',
      status: 'queued',
      priority: 'P1',
      payload: { keyword: '无notebook', content_type: 'solo-company-case' },
      created_at: new Date(),
    };
    pool.query.mockResolvedValue({ rows: [newRow] });

    const res = await request(makeApp())
      .post('/api/brain/pipelines')
      .send({ keyword: '无notebook', content_type: 'solo-company-case' });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT'));
    const payloadArg = JSON.parse(insertCall[1][6]);
    // 没有 notebook_id 时不应包含该字段（executeResearch 会在执行时 FAIL）
    expect(payloadArg).not.toHaveProperty('notebook_id');
  });
});

// ─── KR5-P1: PATCH 写回 + 状态机审批 + 入队列 ────────────────────────────────

describe('PATCH /api/brain/pipelines/:id (KR5-P1)', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockExisting(payload = {}) {
    pool.query.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('SELECT id, title, status, priority, payload') && s.includes("task_type = 'content-pipeline'")) {
        return Promise.resolve({
          rows: [{ id: 'pipe-1', title: '[内容工厂] 测试', status: 'completed', priority: 'P1', payload }],
        });
      }
      if (s.startsWith('UPDATE tasks SET payload')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM content_publish_jobs') && s.includes('SELECT platform')) {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes('INSERT INTO content_publish_jobs')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
  }

  it('写回 title/body 时把数据塞到 payload.edited_title / edited_body', async () => {
    mockExisting({ keyword: '测试', content_type: 'solo-company-case' });

    const res = await request(makeApp())
      .patch('/api/brain/pipelines/pipe-1')
      .send({ title: '新标题', body: '新正文 abc' });

    expect(res.status).toBe(200);
    expect(res.body.payload.edited_title).toBe('新标题');
    expect(res.body.payload.edited_body).toBe('新正文 abc');
    expect(res.body.approval_status).toBe('draft');
    expect(res.body.queued_platforms).toEqual([]);

    const updateCall = pool.query.mock.calls.find(c => String(c[0]).startsWith('UPDATE tasks SET payload'));
    expect(updateCall).toBeDefined();
    const writtenPayload = JSON.parse(updateCall[1][0]);
    expect(writtenPayload.edited_title).toBe('新标题');
    expect(writtenPayload.edited_body).toBe('新正文 abc');
  });

  it("approval_status='approved' 时同步插入 8 条 content_publish_jobs.pending", async () => {
    mockExisting({ keyword: '测试', content_type: 'solo-company-case' });

    const res = await request(makeApp())
      .patch('/api/brain/pipelines/pipe-1')
      .send({ approval_status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('approved');
    expect(res.body.queued_platforms).toEqual([
      'douyin', 'xiaohongshu', 'wechat', 'kuaishou', 'weibo', 'toutiao', 'zhihu', 'shipinhao',
    ]);

    const inserts = pool.query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO content_publish_jobs'));
    expect(inserts.length).toBe(8);
    // 每条 INSERT 第一参数是 platform，第四参数是 task_id (pipeline-1)
    expect(inserts[0][1][0]).toBe('douyin');
    expect(inserts[0][1][3]).toBe('pipe-1');
    // 状态参数固定 'pending'（在 SQL 里硬编码）
    expect(String(inserts[0][0])).toContain("'pending'");
  });

  it('幂等：已有 pending/running/success 的平台不重复入队', async () => {
    pool.query.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('SELECT id, title, status, priority, payload')) {
        return Promise.resolve({
          rows: [{ id: 'pipe-1', title: 't', status: 'completed', priority: 'P1', payload: { keyword: 'k', content_type: 'solo-company-case' } }],
        });
      }
      if (s.startsWith('UPDATE tasks SET payload')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM content_publish_jobs') && s.includes('SELECT platform')) {
        // 已存在 douyin / xiaohongshu 两条 pending
        return Promise.resolve({ rows: [{ platform: 'douyin' }, { platform: 'xiaohongshu' }] });
      }
      if (s.includes('INSERT INTO content_publish_jobs')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(makeApp())
      .patch('/api/brain/pipelines/pipe-1')
      .send({ approval_status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.queued_platforms).not.toContain('douyin');
    expect(res.body.queued_platforms).not.toContain('xiaohongshu');
    expect(res.body.queued_platforms.length).toBe(6);

    const inserts = pool.query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO content_publish_jobs'));
    expect(inserts.length).toBe(6);
  });

  it('approval_status 非法时返回 400', async () => {
    const res = await request(makeApp())
      .patch('/api/brain/pipelines/pipe-1')
      .send({ approval_status: 'queued' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('approval_status');
  });

  it('pipeline 不存在时返回 404', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp())
      .patch('/api/brain/pipelines/missing')
      .send({ title: 't' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/brain/pipelines/:id/approve (KR5-P1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('审批后返回 queued_platforms + approved_at 时间戳', async () => {
    pool.query.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('SELECT id, payload') && s.includes("task_type = 'content-pipeline'")) {
        return Promise.resolve({
          rows: [{ id: 'pipe-2', payload: { keyword: 'k', content_type: 'solo-company-case' } }],
        });
      }
      if (s.startsWith('UPDATE tasks SET payload')) return Promise.resolve({ rows: [] });
      if (s.includes('FROM content_publish_jobs') && s.includes('SELECT platform')) {
        return Promise.resolve({ rows: [] });
      }
      if (s.includes('INSERT INTO content_publish_jobs')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(makeApp())
      .post('/api/brain/pipelines/pipe-2/approve')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('approved');
    expect(typeof res.body.approved_at).toBe('string');
    expect(res.body.queued_platforms.length).toBe(8);
  });

  it('pipeline 不存在时返回 404', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp())
      .post('/api/brain/pipelines/missing/approve')
      .send({});
    expect(res.status).toBe(404);
  });
});
