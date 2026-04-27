import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 一个最小的 in-memory pool stub — 真实路由会读 ../db.js，这里 vi.doMock 替换。
function buildPoolStub(initialInitiatives: Record<string, any>) {
  const records: any[] = [];

  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (/SELECT.*FROM\s+initiatives/i.test(sql)) {
      const id = params[0];
      const ini = initialInitiatives[id];
      return { rows: ini ? [ini] : [] };
    }
    if (/INSERT\s+INTO\s+initiative_preflight_results/i.test(sql)) {
      const row = {
        initiative_id: params[0],
        status: params[1],
        reasons: params[2],
        checked_at: new Date(),
      };
      records.push(row);
      return { rows: [row] };
    }
    if (/SELECT.*FROM\s+initiative_preflight_results/i.test(sql)) {
      const id = params[0];
      const matched = records
        .filter((r) => r.initiative_id === id)
        .sort((a, b) => b.checked_at.getTime() - a.checked_at.getTime());
      return { rows: matched.length ? [matched[0]] : [] };
    }
    return { rows: [] };
  });

  return { pool: { query }, records };
}

async function buildApp(initialInitiatives: Record<string, any>) {
  const { pool, records } = buildPoolStub(initialInitiatives);
  vi.resetModules();
  vi.doMock('../../../../packages/brain/src/db.js', () => ({ default: pool }));
  const router = (await import('../../../../packages/brain/src/routes/preflight.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/initiatives', router);
  return { app, records };
}

const COMPLIANT_INITIATIVE = {
  id: 'init-good',
  description:
    '本 Initiative 实现 Initiative 级 pre-flight check 流水线最小闭环，覆盖 PRD/task-plan/DAG 校验。',
  prd: `## OKR 对齐\nKR\n## 背景\nbg\n## 目标\ngoal\n## User Stories\nU\n## 验收场景\nGWT\n## 功能需求\nFR\n## 成功标准\nSC-001 通过\n## 假设\nA\n## 边界情况\nE\n## 范围限定\nR\n## 预期受影响文件\nF`,
  task_plan: {
    initiative_id: 'init-good',
    tasks: [
      { task_id: 'a', title: 't1', estimated_minutes: 30, depends_on: [] },
      { task_id: 'b', title: 't2', estimated_minutes: 40, depends_on: ['a'] },
    ],
  },
};

const REJECTED_INITIATIVE = {
  id: 'init-bad',
  description: 'short',
  prd: '## OKR 对齐\nx\n## 目标\ny',
  task_plan: { initiative_id: 'init-bad', tasks: [] },
};

describe('Workstream 3 — preflight HTTP API [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('POST on a compliant initiative returns 200 with status=passed and persists one row', async () => {
    const { app, records } = await buildApp({ 'init-good': COMPLIANT_INITIATIVE });
    const resp = await request(app).post('/api/brain/initiatives/init-good/preflight');
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('passed');
    expect(records.length).toBe(1);
    expect(records[0].initiative_id).toBe('init-good');
    expect(records[0].status).toBe('passed');
  });

  it('GET after two POSTs returns the latest record by checked_at', async () => {
    const { app, records } = await buildApp({ 'init-good': COMPLIANT_INITIATIVE });
    await request(app).post('/api/brain/initiatives/init-good/preflight');
    await new Promise((r) => setTimeout(r, 5));
    await request(app).post('/api/brain/initiatives/init-good/preflight');
    expect(records.length).toBe(2);

    const resp = await request(app).get('/api/brain/initiatives/init-good/preflight');
    expect(resp.status).toBe(200);
    const latest = records.sort(
      (a, b) => b.checked_at.getTime() - a.checked_at.getTime(),
    )[0];
    expect(new Date(resp.body.checked_at).getTime()).toBe(latest.checked_at.getTime());
  });

  it('POST on a non-compliant initiative returns 200 with status=rejected and non-empty reasons', async () => {
    const { app } = await buildApp({ 'init-bad': REJECTED_INITIATIVE });
    const resp = await request(app).post('/api/brain/initiatives/init-bad/preflight');
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe('rejected');
    expect(Array.isArray(resp.body.reasons)).toBe(true);
    expect(resp.body.reasons.length).toBeGreaterThan(0);
  });

  it('POST with unknown initiative_id returns HTTP 404', async () => {
    const { app } = await buildApp({});
    const resp = await request(app).post('/api/brain/initiatives/init-missing/preflight');
    expect(resp.status).toBe(404);
  });
});
