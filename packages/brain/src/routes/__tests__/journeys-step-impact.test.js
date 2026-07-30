/**
 * TDD: GET /api/brain/journeys/steps/:step_id/impact
 *
 * S3 联动执法（thin档）：evaluator 通过 anchor.step_id 查询该步骤的全部格子+断言锚点，
 * 生成联动清单报告；evaluator 跑完后通过 PATCH /journey_step_links/:id 回写 cell_status。
 *
 * 验收：
 * [S3-I1] step_id 存在有 assertion_ref 的格子 → 返回 impacts 数组含断言锚点
 * [S3-I2] step_id 无关联格子 → impacts: []，total: 0
 * [S3-I3] 格子 assertion_ref 为 NULL → 仍返回（格子存在但无锚点，标记 needs_assertion）
 * [S3-I4] DB 错误 → 500
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../journeys.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

describe('GET /api/brain/journeys/steps/:step_id/impact', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('[S3-I1] step_id 有带断言的格子 → impacts 含 assertion_ref', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          link_id: 'link-001',
          feature_id: 'feat-auth',
          feature_name: '认证模块',
          feature_kind: 'capability',
          cell_kind: '底座引用',
          cell_status: 'pending',
          assertion_ref: 'tests/brain/auth.test.js',
          na_reason: null,
        },
        {
          link_id: 'link-002',
          feature_id: 'feat-db',
          feature_name: 'DB 连接池',
          feature_kind: 'capability',
          cell_kind: '底座引用',
          cell_status: 'green',
          assertion_ref: 'manual:bash scripts/smoke/db-pool-smoke.sh',
          na_reason: null,
        },
      ],
    });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/brain/journeys/steps/step-gp-b-s2/impact');

    expect(res.status).toBe(200);
    expect(res.body.step_id).toBe('step-gp-b-s2');
    expect(res.body.impacts).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.impacts[0].assertion_ref).toBe('tests/brain/auth.test.js');
    expect(res.body.impacts[1].assertion_ref).toBe('manual:bash scripts/smoke/db-pool-smoke.sh');
    expect(res.body.runnable_count).toBe(2);
  });

  it('[S3-I2] step_id 无关联格子 → impacts: [], total: 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/brain/journeys/steps/step-no-links/impact');

    expect(res.status).toBe(200);
    expect(res.body.impacts).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.runnable_count).toBe(0);
  });

  it('[S3-I3] 格子 assertion_ref 为 NULL → 仍返回，needs_assertion=true', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          link_id: 'link-003',
          feature_id: 'feat-x',
          feature_name: '某能力',
          feature_kind: 'capability',
          cell_kind: '能力',
          cell_status: 'gray',
          assertion_ref: null,
          na_reason: null,
        },
      ],
    });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/brain/journeys/steps/step-with-null-ref/impact');

    expect(res.status).toBe(200);
    expect(res.body.impacts).toHaveLength(1);
    expect(res.body.impacts[0].assertion_ref).toBeNull();
    expect(res.body.impacts[0].needs_assertion).toBe(true);
    expect(res.body.runnable_count).toBe(0);
  });

  it('[S3-I4] DB 错误 → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/brain/journeys/steps/step-any/impact');

    expect(res.status).toBe(500);
  });

  it('[S3-I5] eval/decision 是语义锚点，不计 runnable', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          link_id: 'link-eval',
          feature_id: null,
          feature_name: null,
          feature_kind: null,
          cell_kind: 'element',
          cell_status: 'pending',
          assertion_ref: 'eval:reply-quality-v1',
          na_reason: null,
        },
        {
          link_id: 'link-decision',
          feature_id: null,
          feature_name: null,
          feature_kind: null,
          cell_kind: 'element',
          cell_status: 'green',
          assertion_ref: 'decision:reply-policy-v1',
          na_reason: null,
        },
      ],
    });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/brain/journeys/steps/step-semantic/impact');

    expect(res.status).toBe(200);
    expect(res.body.runnable_count).toBe(0);
    expect(res.body.impacts[0]).toMatchObject({
      assertion_state: 'evaluation',
      runnable: false,
      needs_assertion: false,
    });
    expect(res.body.impacts[1]).toMatchObject({
      assertion_state: 'decision',
      runnable: false,
      needs_assertion: false,
    });
  });

  it('[S3-I6] 普通说明文字不是合法锚点，仍需 assertion', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        link_id: 'link-prose',
        feature_id: null,
        feature_name: null,
        feature_kind: null,
        cell_kind: 'element',
        cell_status: 'green',
        assertion_ref: '已拍板：默认全静默',
        na_reason: null,
      }],
    });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app)
      .get('/api/brain/journeys/steps/step-prose/impact');

    expect(res.body.impacts[0]).toMatchObject({
      assertion_state: 'unknown',
      runnable: false,
      needs_assertion: true,
    });
  });
});
