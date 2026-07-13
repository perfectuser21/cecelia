/**
 * routes/content-pipeline.test.js — 刀1e 新端点 + 既有约束测试
 *
 * 覆盖：
 *   GET  /api/brain/pipelines/:id/events  (供 ZJ API 替代跨库直查 cecelia_events)
 *   HEAD /api/brain/pipelines/:id         (供 ZJ API 检查 content-pipeline 任务是否存在)
 *   GET  /api/brain/pipelines?with_last_event=1
 *
 * 其余路由（POST / batch / run / e2e-trigger / pre-publish-check 等）详见：
 *   packages/brain/src/__tests__/content-pipeline-routes.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn(),
  getContentType: vi.fn(),
  getContentTypeFromYaml: vi.fn(),
  listContentTypesFromYaml: vi.fn(),
}));

import pool from '../../db.js';
import contentPipelineRouter from '../content-pipeline.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/pipelines', contentPipelineRouter);
  return app;
}

describe('routes/content-pipeline module — 历史约束', () => {
  it('不再 import 已删除的 content-pipeline-* 实现模块', () => {
    const src = fs.readFileSync(new URL('../content-pipeline.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/content-pipeline-orchestrator/);
    expect(src).not.toMatch(/content-pipeline-graph-runner/);
    expect(src).not.toMatch(/content-pipeline-graph(?!-)/);
    expect(src).not.toMatch(/content-pipeline-executors/);
  });

  it('POST /:id/run-langgraph endpoint 已删（404 by Express）', () => {
    const src = fs.readFileSync(new URL('../content-pipeline.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/run-langgraph/);
  });
});

describe('GET /api/brain/pipelines/:id/events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 cecelia_events 数组（按 id 升序）', async () => {
    const rows = [
      { id: 1, payload: { node: 'research', step_index: 1 }, created_at: '2026-07-13T01:00:00Z' },
      { id: 2, payload: { node: 'copywrite', step_index: 2 }, created_at: '2026-07-13T01:30:00Z' },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = await request(makeApp())
      .get('/api/brain/pipelines/task-uuid-123/events');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].payload.node).toBe('research');
    expect(res.body[1].payload.node).toBe('copywrite');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/cecelia_events/);
    expect(sql).toMatch(/content_pipeline_step/);
    expect(params).toEqual(['task-uuid-123']);
  });

  it('无事件时返回空数组', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp())
      .get('/api/brain/pipelines/no-such-task/events');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('DB 异常时返回 500', async () => {
    pool.query.mockRejectedValue(new Error('connection refused'));
    const res = await request(makeApp())
      .get('/api/brain/pipelines/some-id/events');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('connection refused');
  });
});

describe('HEAD /api/brain/pipelines/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('任务存在时返回 200', async () => {
    pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await request(makeApp())
      .head('/api/brain/pipelines/existing-task-id');
    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/tasks/);
    expect(sql).toMatch(/content-pipeline/);
    expect(params).toEqual(['existing-task-id']);
  });

  it('任务不存在时返回 404', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp())
      .head('/api/brain/pipelines/non-existent-id');
    expect(res.status).toBe(404);
  });

  it('DB 异常时返回 500', async () => {
    pool.query.mockRejectedValue(new Error('db error'));
    const res = await request(makeApp())
      .head('/api/brain/pipelines/some-id');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/brain/pipelines?with_last_event=1', () => {
  beforeEach(() => vi.clearAllMocks());

  it('with_last_event=1 时 SQL 包含 cecelia_events LATERAL JOIN', async () => {
    const rows = [
      {
        id: 'uuid-1', title: '[内容工厂] 测试', status: 'running',
        priority: 'P1', payload: {}, created_at: new Date(),
        started_at: null, completed_at: null, error_message: null,
        updated_at: new Date(), last_node: 'research', last_error: null,
      },
    ];
    pool.query.mockResolvedValue({ rows });
    const res = await request(makeApp())
      .get('/api/brain/pipelines?with_last_event=1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].last_node).toBe('research');
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/cecelia_events/);
    expect(sql).toMatch(/LATERAL/);
  });

  it('不带 with_last_event 时 SQL 不含 cecelia_events', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/pipelines');
    expect(res.status).toBe(200);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/cecelia_events/);
  });
});
