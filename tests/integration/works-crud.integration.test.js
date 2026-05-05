/**
 * Works CRUD Integration Test
 *
 * 链路：content_publish_jobs 完整 CRUD 生命周期
 *   POST 创建 → GET 列表查询 → DB 直查 payload → retry 重置失败 → 参数校验
 *
 * 路由：packages/brain/src/routes/publish-jobs.js
 *   POST   /api/brain/publish-jobs
 *   GET    /api/brain/publish-jobs
 *   POST   /api/brain/publish-jobs/retry/:id
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../packages/brain/src/db-config.js';

// publish-monitor 只在 tick 中使用，这里只需 getPublishStats（publish-jobs /stats 子路由依赖）
vi.mock('../../packages/brain/src/publish-monitor.js', () => ({
  monitorPublishQueue: vi.fn().mockResolvedValue(undefined),
  getPublishStats: vi.fn().mockResolvedValue({ today_total: 0, cached: true }),
}));

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const createdIds = [];

let app;

beforeAll(async () => {
  const { default: publishJobsRouter } = await import(
    '../../packages/brain/src/routes/publish-jobs.js'
  );
  app = express();
  app.use(express.json());
  app.use('/api/brain', publishJobsRouter);
});

afterAll(async () => {
  if (createdIds.length) {
    await pool.query(
      'DELETE FROM content_publish_jobs WHERE id = ANY($1::uuid[])',
      [createdIds]
    );
  }
  await pool.end();
});

// ─── C: Create ────────────────────────────────────────────────────────────────

describe('Works CRUD — Create', () => {
  let workId;

  it('POST /publish-jobs — 创建 wechat article work，返回 201 + pending 状态', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({
        platform: 'wechat',
        content_type: 'article',
        payload: {
          title: '[integration-test] 公众号测试文章',
          keyword: 'test-keyword',
          cover_path: '/tmp/cover.jpg',
        },
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.platform).toBe('wechat');
    expect(res.body.status).toBe('pending');
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-/);
    workId = res.body.id;
    createdIds.push(workId);
  });

  it('POST /publish-jobs — 缺少 platform → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ content_type: 'article' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('POST /publish-jobs — 缺少 content_type → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'wechat' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/content_type/i);
  });

  it('POST /publish-jobs — 非法 status → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'wechat', content_type: 'article', status: 'unknown' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── R: Read ──────────────────────────────────────────────────────────────────

describe('Works CRUD — Read', () => {
  let workId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'douyin', content_type: 'video', payload: { title: '[integration-test] 抖音视频' } });
    workId = res.body.id;
    createdIds.push(workId);
  });

  it('GET /publish-jobs — 列表包含刚创建的 work', async () => {
    const res = await request(app).get('/api/brain/publish-jobs').expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    const found = res.body.jobs.find((j) => j.id === workId);
    expect(found).toBeDefined();
    expect(found.platform).toBe('douyin');
  });

  it('GET /publish-jobs?platform=douyin — platform 过滤正确', async () => {
    const res = await request(app)
      .get('/api/brain/publish-jobs?platform=douyin')
      .expect(200);
    const found = res.body.jobs.find((j) => j.id === workId);
    expect(found).toBeDefined();
    // 过滤后的结果不含其他 platform
    const foreign = res.body.jobs.find((j) => j.platform !== 'douyin');
    expect(foreign).toBeUndefined();
  });

  it('DB 直查 — payload JSONB 字段正确持久化', async () => {
    const { rows } = await pool.query(
      'SELECT payload FROM content_publish_jobs WHERE id = $1',
      [workId]
    );
    expect(rows[0].payload.title).toBe('[integration-test] 抖音视频');
  });
});

// ─── U: Update（via retry）───────────────────────────────────────────────────

describe('Works CRUD — Update（retry 重置失败 work）', () => {
  let workId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'kuaishou', content_type: 'video' });
    workId = res.body.id;
    createdIds.push(workId);
    // 直接将 work 标为 failed
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'failed', error_message = 'mock network error'
       WHERE id = $1`,
      [workId]
    );
  });

  it('POST /publish-jobs/retry/:id — failed work 重置为 pending', async () => {
    const res = await request(app)
      .post(`/api/brain/publish-jobs/retry/${workId}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('pending');
  });

  it('DB 直查 — retry 后 error_message 已清空', async () => {
    const { rows } = await pool.query(
      'SELECT status, error_message, started_at FROM content_publish_jobs WHERE id = $1',
      [workId]
    );
    expect(rows[0].status).toBe('pending');
    expect(rows[0].error_message).toBeNull();
    expect(rows[0].started_at).toBeNull();
  });

  it('POST /publish-jobs/retry/:id — 不存在的 ID → 404', async () => {
    await request(app)
      .post('/api/brain/publish-jobs/retry/00000000-0000-0000-0000-000000000000')
      .expect(404);
  });
});

// ─── D: Delete（通过 status=pending 过滤验证隔离）────────────────────────────

describe('Works CRUD — 状态过滤隔离', () => {
  it('GET /publish-jobs?status=pending — 只返回 pending works', async () => {
    const res = await request(app)
      .get('/api/brain/publish-jobs?status=pending')
      .expect(200);
    expect(res.body.jobs.every((j) => j.status === 'pending')).toBe(true);
  });
});
