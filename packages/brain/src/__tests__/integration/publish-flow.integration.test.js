/**
 * Publish Flow Integration Test
 *
 * 链路：端到端发布流程
 *   POST publish-job (pending)
 *   → DB 直写 running（模拟 worker 启动）
 *   → POST publish-results（N8N 回写结果）
 *   → GET publish-results（验证结果可查）
 *   → DB 直写 success + completed_at（模拟 worker 完成）
 *
 * 路由：
 *   packages/brain/src/routes/publish-jobs.js   → /api/brain/publish-jobs
 *   packages/brain/src/routes/publish-results.js → /api/brain/publish-results
 *
 * 运行环境：CI integration-core job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

vi.mock('../publish-monitor.js', () => ({
  monitorPublishQueue: vi.fn().mockResolvedValue(undefined),
  getPublishStats: vi.fn().mockResolvedValue({ today_total: 0, cached: true }),
}));

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });
const jobIds = [];
const resultIds = [];

let app;

beforeAll(async () => {
  const [jobsMod, resultsMod] = await Promise.all([
    import('../routes/publish-jobs.js'),
    import('../routes/publish-results.js'),
  ]);
  app = express();
  app.use(express.json());
  app.use('/api/brain', jobsMod.default);
  app.use('/api/brain', resultsMod.default);
});

afterAll(async () => {
  if (jobIds.length) {
    await pool.query(
      'DELETE FROM content_publish_jobs WHERE id = ANY($1::uuid[])',
      [jobIds]
    );
  }
  if (resultIds.length) {
    await pool.query(
      'DELETE FROM publish_results WHERE id = ANY($1::bigint[])',
      [resultIds]
    );
  }
  await pool.end();
});

// ─── 正常发布流程（happy path）────────────────────────────────────────────────

describe('Publish Flow: 成功路径（pending → running → success）', () => {
  let jobId;
  let resultId;

  it('Step 1 — POST publish-job，初始状态 pending', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({
        platform: 'wechat',
        content_type: 'article',
        payload: { title: '[integration-test] 发布流程测试文章' },
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('pending');
    jobId = res.body.id;
    jobIds.push(jobId);
  });

  it('Step 2 — worker 启动（DB 直写 running + started_at）', async () => {
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'running', started_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    const { rows } = await pool.query(
      'SELECT status, started_at FROM content_publish_jobs WHERE id = $1',
      [jobId]
    );
    expect(rows[0].status).toBe('running');
    expect(rows[0].started_at).not.toBeNull();
  });

  it('Step 3 — POST publish-results（N8N 回写成功结果）', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({
        platform: 'wechat',
        contentType: 'article',
        success: true,
        workId: 'wechat_article_test_001',
        url: 'https://mp.weixin.qq.com/s/test001',
        title: '[integration-test] 发布流程测试文章',
        taskId: jobId,
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    resultId = res.body.id;
    resultIds.push(resultId);
  });

  it('Step 4 — GET publish-results 可查到刚写入的结果', async () => {
    const res = await request(app)
      .get('/api/brain/publish-results?platform=wechat')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    const found = res.body.results.find((r) => r.task_id === jobId);
    expect(found).toBeDefined();
    expect(found.success).toBe(true);
    expect(found.work_id).toBe('wechat_article_test_001');
  });

  it('Step 5 — worker 完成（DB 直写 success + completed_at）', async () => {
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'success', completed_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
    const { rows } = await pool.query(
      'SELECT status, started_at, completed_at FROM content_publish_jobs WHERE id = $1',
      [jobId]
    );
    expect(rows[0].status).toBe('success');
    expect(rows[0].started_at).not.toBeNull();
    expect(rows[0].completed_at).not.toBeNull();
    // completed_at >= started_at
    expect(new Date(rows[0].completed_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[0].started_at).getTime()
    );
  });
});

// ─── 失败路径（failed → retry）────────────────────────────────────────────────

describe('Publish Flow: 失败路径（failed → retry → pending）', () => {
  let jobId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'douyin', content_type: 'video' });
    jobId = res.body.id;
    jobIds.push(jobId);
    // 模拟失败
    await pool.query(
      `UPDATE content_publish_jobs
       SET status = 'failed', error_message = 'upload timeout', started_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
  });

  it('GET publish-results — 写入失败结果', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({
        platform: 'douyin',
        contentType: 'video',
        success: false,
        error: 'upload timeout',
        taskId: jobId,
      })
      .expect(200);
    resultIds.push(res.body.id);
    expect(res.body.success).toBe(true);
  });

  it('retry — 重置 failed job 为 pending', async () => {
    const res = await request(app)
      .post(`/api/brain/publish-jobs/retry/${jobId}`)
      .expect(200);
    expect(res.body.status).toBe('pending');
  });
});

// ─── 参数校验 ─────────────────────────────────────────────────────────────────

describe('Publish Flow: 参数校验', () => {
  it('POST publish-results — 缺少 platform → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({ success: true })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/platform/i);
  });

  it('POST publish-results — success 为字符串 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-results')
      .send({ platform: 'wechat', success: 'yes' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it('POST publish-jobs — 非法 status 值 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/publish-jobs')
      .send({ platform: 'wechat', content_type: 'article', status: 'launched' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});
