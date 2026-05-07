import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

// @ts-ignore — handler 由 WS1 实现后导出
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

function makeApp() {
  const app = express();
  app.use('/api/brain/harness', harnessRoutes);
  return app;
}

describe('Workstream 1 — GET /api/brain/harness/health [BEHAVIOR]', () => {
  it('返回 status 200', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/harness/health');
    expect(res.status).toBe(200);
  });

  it('body.langgraph_version 是非空字符串', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/harness/health');
    expect(typeof res.body.langgraph_version).toBe('string');
    expect((res.body.langgraph_version as string).length).toBeGreaterThan(0);
  });

  it('body.last_attempt_at 是 null 或 ISO 8601 字符串', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/harness/health');
    const v = res.body.last_attempt_at;
    expect(v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v))).toBe(true);
  });

  it('body.nodes 数组长度 = 14 且覆盖 14 节点名', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/harness/health');
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(res.body.nodes).toHaveLength(14);
    for (const n of HARNESS_NODES) {
      expect(res.body.nodes).toContain(n);
    }
  });

  it('Content-Type 头部含 application/json', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/harness/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
