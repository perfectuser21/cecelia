import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

import express from 'express';
import mainRouter from '../../routes.js';

describe('routes.js mounting', () => {
  it('mounts /skills router — GET /api/brain/skills returns 200 not 404', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mainRouter);

    // mock pool for this test
    const pool = (await import('../../db.js')).default;
    pool.query.mockResolvedValue({ rows: [] });

    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/brain/skills');
    // Before fix: 404. After fix: 200
    expect(res.status).toBe(200);
  });

  it('mounts /kernel-reviews router — POST /api/brain/kernel-reviews/:runId/approve reaches auth, not 404', async () => {
    // kernel 三修案卷(task 31b93fd4)：harness-kernel-approvals.js 的 approve/reject/context
    // 三个端点写好、单测好，但从未被 routes.js 引用/挂载——生产 Brain 上这条路由树
    // 全线 404，人审只能靠操作员 psql 直写 verdict:human_review 行绕过。
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mainRouter);

    delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/brain/kernel-reviews/11111111-1111-4111-8111-111111111111/approve')
      .send({});
    // Before fix: 404（未挂载）。After fix: 503（挂载了，走到 authenticateApprover
    // 的 fail-closed 分支——未配置 approver token）。两者都不是 404。
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(503);
  });
});
