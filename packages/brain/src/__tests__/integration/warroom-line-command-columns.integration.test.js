/**
 * warroom-line-command-columns.test.js
 *
 * 回归测试：GET /warroom/line/:id/command 三处列名错位（真库集成，禁 mock pool）
 *
 * Sprint: 08041820-warroom-line-command-columns
 * Task:   9eae3edd-a4a4-43b1-a28f-daae6a12dd32 · 决策 af0d0818 / 13660836
 *
 * 历史 bug：三条查询列名与真库不符，且被 try/catch 静默吞，页面三块恒空：
 *   1. journey_features 查 group_name → 真列名 "group"
 *   2. initiative_runs 查 status → 真列名 phase（值域 done/failed/…）
 *   3. initiative_runs 查 result → 列不存在
 * 既有 mock-pool 测试拦不住列名漂移（mock 不知道真 schema）——本测试必须真库。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../../db.js';
import routes from '../../routes/warroom.js';

const JOURNEY_ID = 'beefbeef-0001-4000-8000-000000000001';
const JF_ABILITY_ID = 'beefbeef-0002-4000-8000-000000000002';
const JF_FEATURE_ID = 'beefbeef-0003-4000-8000-000000000003';
const RUN_DONE_ID = 'beefbeef-0004-4000-8000-000000000004';
const RUN_FAILED_ID = 'beefbeef-0005-4000-8000-000000000005';
const INITIATIVE_ID = 'beefbeef-0006-4000-8000-000000000006';

function mockReqRes(params = {}) {
  const req = { body: {}, params, query: {} };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

function getHandler(method, path) {
  const layers = routes.stack.filter(
    (l) => l.route && l.route.methods[method] && l.route.path === path
  );
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

async function cleanup() {
  await pool.query('DELETE FROM initiative_runs WHERE id = ANY($1)', [[RUN_DONE_ID, RUN_FAILED_ID]]);
  await pool.query('DELETE FROM journey_features WHERE id = ANY($1)', [[JF_ABILITY_ID, JF_FEATURE_ID]]);
  await pool.query('DELETE FROM journeys WHERE id = $1', [JOURNEY_ID]);
}

beforeAll(async () => {
  await cleanup();
  await pool.query(
    `INSERT INTO journeys (id, name, status) VALUES ($1, '[test] warroom 列名回归线', 'active')`,
    [JOURNEY_ID]
  );
  await pool.query(
    `INSERT INTO journey_features (id, journey_id, name, kind, status, "group")
     VALUES ($1, $2, '[test] 能力A', 'ability', 'working', '测试组'),
            ($3, $2, '[test] 使能件B', 'feature', 'planned', NULL)`,
    [JF_ABILITY_ID, JOURNEY_ID, JF_FEATURE_ID]
  );
  await pool.query(
    `INSERT INTO initiative_runs (id, initiative_id, journey_id, phase, started_at, completed_at)
     VALUES ($1, $3, $4, 'done',   NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour'),
            ($2, $3, $4, 'failed', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours')`,
    [RUN_DONE_ID, RUN_FAILED_ID, INITIATIVE_ID, JOURNEY_ID]
  );
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('GET /warroom/line/:id/command — 真库列名回归（禁 mock pool）', () => {
  it('abilities/features 非空且携带 group_name（真列名 "group" 的别名）', async () => {
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({ id: JOURNEY_ID });
    await handler(req, res);

    expect(res._status).toBe(200);
    const { connections } = res._data;
    expect(connections.abilities).toHaveLength(1);
    expect(connections.abilities[0].name).toBe('[test] 能力A');
    expect(connections.abilities[0].group_name).toBe('测试组');
    expect(connections.features).toHaveLength(1);
  });

  it('recent_runs 非空且 phase 正确映射为前端 status（done→completed / failed→failed）', async () => {
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({ id: JOURNEY_ID });
    await handler(req, res);

    expect(res._status).toBe(200);
    const runs = res._data.connections.recent_runs;
    expect(runs).toHaveLength(2);
    const statuses = runs.map((r) => r.status).sort();
    expect(statuses).toEqual(['completed', 'failed']);
    for (const r of runs) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('started_at');
      expect(r).toHaveProperty('completed_at');
      expect(r).toHaveProperty('created_at');
    }
  });

  it('health 按 phase=done 计成功：run_total=2, run_success=1, success_rate=50', async () => {
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({ id: JOURNEY_ID });
    await handler(req, res);

    expect(res._status).toBe(200);
    const { health } = res._data;
    expect(health.run_total).toBe(2);
    expect(health.run_success).toBe(1);
    expect(health.success_rate).toBe(50);
  });
});
