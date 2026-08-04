/**
 * Regression: journey_step_links PATCH fail-closed
 * 决策 df1ccf5a §③: 无 assertion_ref 的点绿请求一律拒收（422）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// pool mock
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

const { default: pool } = await import('../db.js');

// 动态 import router（依赖 pool mock）
const { default: journeysRouter } = await import('../routes/journeys.js');

const app = express();
app.use(express.json());
app.use('/api/brain', journeysRouter);

describe('journey_step_links PATCH fail-closed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('cell_status=green 且无 assertion_ref 且行无锚点 → 422 拒收', async () => {
    // 模拟现有行没有 assertion_ref
    pool.query.mockResolvedValueOnce({
      rows: [{ assertion_ref: null }],
    });

    const res = await request(app)
      .patch('/api/brain/journey_step_links/link-aaa')
      .send({ cell_status: 'green' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/fail-closed/);
  });

  it('cell_status=green 且请求体带 assertion_ref → 允许写入', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'link-bbb', cell_status: 'green', assertion_ref: 'tests/foo.test.js' }],
    });

    const res = await request(app)
      .patch('/api/brain/journey_step_links/link-bbb')
      .send({ cell_status: 'green', assertion_ref: 'tests/foo.test.js' });

    expect(res.status).toBe(200);
  });

  it('cell_status=green 且行已有 assertion_ref → 允许写入', async () => {
    // 第一次 query = 检查现有行
    pool.query.mockResolvedValueOnce({
      rows: [{ assertion_ref: 'tests/existing.test.js' }],
    });
    // 第二次 query = UPDATE RETURNING
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'link-ccc', cell_status: 'green', assertion_ref: 'tests/existing.test.js' }],
    });

    const res = await request(app)
      .patch('/api/brain/journey_step_links/link-ccc')
      .send({ cell_status: 'green' });

    expect(res.status).toBe(200);
  });

  it('非 green 状态的 PATCH 不受 fail-closed 影响', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'link-ddd', cell_status: 'red', assertion_ref: null }],
    });

    const res = await request(app)
      .patch('/api/brain/journey_step_links/link-ddd')
      .send({ cell_status: 'red' });

    expect(res.status).toBe(200);
  });
});
