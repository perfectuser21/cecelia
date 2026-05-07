import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

// @ts-ignore — WS1 完成后此 import 解析到含 /health handler 的 router
import harnessRoutes from '../../../../packages/brain/src/routes/harness.js';

const HARNESS_NODES = [
  'prep',
  'planner',
  'parsePrd',
  'ganLoop',
  'inferTaskPlan',
  'dbUpsert',
  'pick_sub_task',
  'run_sub_task',
  'evaluate',
  'advance',
  'retry',
  'terminal_fail',
  'final_evaluate',
  'report',
];

describe('Workstream 2 — health endpoint integration [BEHAVIOR]', () => {
  it('真实 Express 实例挂载 router 后 GET /api/brain/harness/health 返回 200 + 14 nodes', async () => {
    const app = express();
    app.use('/api/brain/harness', harnessRoutes);

    const res = await request(app).get('/api/brain/harness/health');

    expect(res.status).toBe(200);
    expect(typeof res.body.langgraph_version).toBe('string');
    expect((res.body.langgraph_version as string).length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(res.body.nodes).toHaveLength(14);
    for (const n of HARNESS_NODES) {
      expect(res.body.nodes).toContain(n);
    }
  });

  it('last_attempt_at 字段存在（null 或 ISO 8601）', async () => {
    const app = express();
    app.use('/api/brain/harness', harnessRoutes);

    const res = await request(app).get('/api/brain/harness/health');
    const v = res.body.last_attempt_at;
    const ok = v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v));
    expect(ok).toBe(true);
  });

  it('重复请求返回相同 nodes 列表（idempotent shape）', async () => {
    const app = express();
    app.use('/api/brain/harness', harnessRoutes);

    const res1 = await request(app).get('/api/brain/harness/health');
    const res2 = await request(app).get('/api/brain/harness/health');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.nodes).toEqual(res1.body.nodes);
  });
});
