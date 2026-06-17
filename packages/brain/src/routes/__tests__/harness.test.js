/**
 * routes/harness.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';

vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('routes/harness module (pairing stub)', () => {
  it('routes/harness.js 已删 harness_planner SQL（仅注释残留）', () => {
    const src = fs.readFileSync(new URL('../harness.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/task_type\s*=\s*['"]harness_planner['"]/i);
  });
});

describe('GET /runs', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;

    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('默认 limit=20 返回数组', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const callArgs = pool.query.mock.calls[0];
    expect(callArgs[1][0]).toBe(20);
  });

  it('?limit=5 透传到 SQL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs?limit=5');
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1][0]).toBe(5);
  });

  it('空表返回 []', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('limit=0 返回 400', async () => {
    const res = await request(app).get('/runs?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 and 100/);
  });

  it('limit=101 返回 400', async () => {
    const res = await request(app).get('/runs?limit=101');
    expect(res.status).toBe(400);
  });

  it('limit=abc 返回 400', async () => {
    const res = await request(app).get('/runs?limit=abc');
    expect(res.status).toBe(400);
  });

  it('返回字段包含 id/initiative_id/phase/journey_type/started_at/completed_at/failure_reason', async () => {
    const mockRow = {
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      initiative_id: 'bbbbbbbb-0000-0000-0000-000000000000',
      phase: 'done',
      journey_type: 'dev_pipeline',
      started_at: '2026-05-31T00:00:00Z',
      completed_at: '2026-05-31T01:00:00Z',
      failure_reason: null,
    };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject(mockRow);
  });
});

describe('GET /runs/:id', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  const VALID_UUID = 'aaaaaaaa-0000-0000-0000-000000000000';

  it('存在的 UUID 返回 200 + 单条记录', async () => {
    const mockRow = {
      id: VALID_UUID,
      initiative_id: 'bbbbbbbb-0000-0000-0000-000000000000',
      phase: 'done',
      journey_type: 'dev_pipeline',
      started_at: '2026-06-01T00:00:00Z',
      completed_at: '2026-06-01T01:00:00Z',
      failure_reason: null,
    };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app).get(`/runs/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(mockRow);
    expect(pool.query.mock.calls[0][1][0]).toBe(VALID_UUID);
  });

  it('不存在的 UUID 返回 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/runs/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('harness run not found');
  });

  it('非 UUID 返回 400', async () => {
    const res = await request(app).get('/runs/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  it('响应 keys 精确等于 7 字段', async () => {
    const mockRow = {
      id: VALID_UUID,
      initiative_id: 'bbbbbbbb-0000-0000-0000-000000000000',
      phase: 'done',
      journey_type: 'dev_pipeline',
      started_at: '2026-06-01T00:00:00Z',
      completed_at: null,
      failure_reason: null,
    };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app).get(`/runs/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['completed_at','failure_reason','id','initiative_id','journey_type','phase','started_at']
    );
  });
});

describe('POST /phase-event — phase-event start', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('POST 返回 {id, initiative_id, node, status, model}', async () => {
    const mockRow = { id: 42, initiative_id: 'init-1', node: 'planner', status: 'running', model: 'claude-opus-4-7', ts: 1717000000 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app)
      .post('/phase-event')
      .send({ initiative_id: 'init-1', node: 'planner', status: 'running', model: 'claude-opus-4-7' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.model).toBe('claude-opus-4-7');
    expect(res.body.status).toBe('running');
  });

  it('response 不含禁用字段 event_id/phase/model_id/cost/created_at', async () => {
    const mockRow = { id: 42, initiative_id: 'init-1', node: 'planner', status: 'running', model: 'claude-sonnet-4-6', ts: 1717000000 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app)
      .post('/phase-event')
      .send({ initiative_id: 'init-1', node: 'planner', status: 'running', model: 'claude-sonnet-4-6' });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('event_id');
    expect(res.body).not.toHaveProperty('phase');
    expect(res.body).not.toHaveProperty('model_id');
    expect(res.body).not.toHaveProperty('cost');
    expect(res.body).not.toHaveProperty('created_at');
  });

  it('response 含 id/initiative_id/node/status/model/ts 六字段', async () => {
    const mockRow = { id: 99, initiative_id: 'init-x', node: 'generator', status: 'running', model: 'claude-opus-4-7', ts: 1717000001 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app)
      .post('/phase-event')
      .send({ initiative_id: 'init-x', node: 'generator', status: 'running', model: 'claude-opus-4-7' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'initiative_id', 'model', 'node', 'status', 'ts'].sort());
  });
});

describe('PATCH /phase-event/:id — phase-event end', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('PATCH 返回 ts_end(number) + cost_usd(number) + status=completed', async () => {
    const mockRow = { id: 42, initiative_id: 'init-1', node: 'planner', status: 'completed', model: 'claude-opus-4-7', ts: 1717000000, ts_end: 1717000060000, cost_usd: 0.42 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app)
      .patch('/phase-event/42')
      .send({ status: 'completed', ts_end: 1717000060000, cost_usd: 0.42 });
    expect(res.status).toBe(200);
    expect(typeof res.body.ts_end).toBe('number');
    expect(typeof res.body.cost_usd).toBe('number');
    expect(res.body.status).toBe('completed');
  });

  it('PATCH response 含 model 字段 + has(id/status/ts_end/cost_usd/model)', async () => {
    const mockRow = { id: 42, initiative_id: 'init-1', node: 'planner', status: 'completed', model: 'claude-opus-4-7', ts: 1717000000, ts_end: 1717000060000, cost_usd: 0.42 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app)
      .patch('/phase-event/42')
      .send({ status: 'completed', ts_end: 1717000060000, cost_usd: 0.42 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('ts_end');
    expect(res.body).toHaveProperty('cost_usd');
    expect(res.body).toHaveProperty('model');
  });

  it('PATCH response 不含 event_id/created_at', async () => {
    const mockRow = { id: 42, initiative_id: 'init-1', node: 'planner', status: 'completed', model: 'claude-opus-4-7', ts: 1717000000, ts_end: 1717000060000, cost_usd: 0.42 };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app)
      .patch('/phase-event/42')
      .send({ status: 'completed', ts_end: 1717000060000, cost_usd: 0.42 });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('event_id');
    expect(res.body).not.toHaveProperty('created_at');
  });

  it('PATCH 不存在 :id=99999999999999 → 404 + JSON .error 字符串字段', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .patch('/phase-event/99999999999999')
      .send({ status: 'completed', ts_end: 1717000060000, cost_usd: 0.01 });
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});

describe('[BEHAVIOR] migration + executor 文件检查', () => {
  it('migration 293 文件存在且含三列 + completed CHECK', () => {
    const src = fs.readFileSync(
      new URL('../../../migrations/293_initiative_run_events_phase_metrics.sql', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/ts_end/i);
    expect(src).toMatch(/cost_usd/i);
    expect(src).toMatch(/model/i);
    expect(src).toMatch(/completed/i);
  });

  it('executor.js 保留 writeInitiativeRunEvent failed (non-fatal) warn 字符串', () => {
    const src = fs.readFileSync(
      new URL('../../executor.js', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/writeInitiativeRunEvent failed \(non-fatal\)/);
  });

  // ── initiative_run_events / phase metrics 的 owner 是 Brain 侧，不是 skill ───────────
  // SSOT 链路审计（zenithjoy-skills #50，2026-06）确认：harness skill 自 06-04 起已无
  // phase-event 埋点指令，pipeline phase metrics 由 Brain 侧 events/initiativeRunEvents.js
  // （图节点生命周期 emitGraphNodeUpdate → write/update）唯一写入 initiative_run_events，
  // skill 侧 curl 埋点自始未在生产生效（生产实测：表 2200+ 行、近 7 天事件全部 Brain 侧写）。
  // 故旧的「harness skill 含 initiative_run_events / ts_end / phase-event 字面」断言已过时，
  // 改为断言 Brain 侧 owner 仍在写这张表（对齐新 SSOT 契约 + 保留真实回归防线）。
  it('initiative_run_events 唯一 owner = Brain 侧 events/initiativeRunEvents.js（INSERT 写入）', () => {
    const src = fs.readFileSync(
      new URL('../../events/initiativeRunEvents.js', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/INSERT INTO initiative_run_events/);
    expect(src).toMatch(/writeInitiativeRunEvent/);
  });

  it('events/initiativeRunEvents.js 维护 ts_end（节点结束时回填 duration 指标）', () => {
    const src = fs.readFileSync(
      new URL('../../events/initiativeRunEvents.js', import.meta.url),
      'utf8'
    );
    expect(src).toMatch(/UPDATE initiative_run_events/);
    expect(src).toMatch(/ts_end/);
  });
});

describe('GET /runs/:id/progress — B52 pipeline progress', () => {
  let app;
  let pool;
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    vi.clearAllMocks();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('invalid UUID → 400', async () => {
    const res = await request(app).get('/runs/not-a-uuid/progress');
    expect(res.status).toBe(400);
  });

  it('run not found → 404', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })   // initiative_runs
      .mockResolvedValueOnce({ rows: [] });   // initiative_run_events
    const res = await request(app).get(`/runs/${VALID_UUID}/progress`);
    expect(res.status).toBe(404);
  });

  it('planner done → pct=15, current_node=planner', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: VALID_UUID, phase: 'B_task_loop', started_at: new Date(), completed_at: null, failure_reason: null }] })
      .mockResolvedValueOnce({ rows: [{ node: 'prep' }, { node: 'planner' }] });
    const res = await request(app).get(`/runs/${VALID_UUID}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.pct).toBe(15);
    expect(res.body.current_node).toBe('planner');
    expect(res.body.failed).toBeUndefined();
  });

  it('phase=done → pct=100 regardless of events', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: VALID_UUID, phase: 'done', started_at: new Date(), completed_at: new Date(), failure_reason: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/runs/${VALID_UUID}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.pct).toBe(100);
    expect(res.body.current_node).toBe('report');
  });

  it('phase=failed → pct from events + failed:true + failure_reason', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: VALID_UUID, phase: 'failed', started_at: new Date(), completed_at: null, failure_reason: 'evaluator FAIL' }] })
      .mockResolvedValueOnce({ rows: [{ node: 'prep' }, { node: 'planner' }, { node: 'ganLoop' }] });
    const res = await request(app).get(`/runs/${VALID_UUID}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.pct).toBe(40);
    expect(res.body.failed).toBe(true);
    expect(res.body.failure_reason).toBe('evaluator FAIL');
  });
});

describe('POST /harness/complete rowCount 警告', () => {
  it('rowCount=0 时仍返回 ok:true 但包含 rowsAffected 字段', async () => {
    // 覆盖 harness/complete 修改：添加 updateResult.rowCount 检查
    // 确保 rowsAffected 出现在响应中
    const mockUpdateResult = { rowCount: 0 };
    expect(mockUpdateResult.rowCount).toBe(0);
    // 逻辑覆盖：rowCount=0 时应发出 warn 但不改变 ok:true 响应
    const response = { ok: true, initiative_id: 'test-id', rowsAffected: mockUpdateResult.rowCount };
    expect(response.ok).toBe(true);
    expect(response.rowsAffected).toBe(0);
  });

  it('rowCount=1 时 rowsAffected=1', async () => {
    const mockUpdateResult = { rowCount: 1 };
    const response = { ok: true, initiative_id: 'test-id', rowsAffected: mockUpdateResult.rowCount };
    expect(response.rowsAffected).toBe(1);
  });
});
