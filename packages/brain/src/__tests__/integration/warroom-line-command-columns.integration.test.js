/** 真库验收指挥页的能力分组、当前任务和近 30 天任务健康度。 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../../db.js';
import routes from '../../routes/warroom.js';

const JOURNEY_ID = 'beefbeef-0001-4000-8000-000000000001';
const JF_ABILITY_ID = 'beefbeef-0002-4000-8000-000000000002';
const JF_FEATURE_ID = 'beefbeef-0003-4000-8000-000000000003';
const RUN_DONE_ID = 'beefbeef-0004-4000-8000-000000000004';
const RUN_FAILED_ID = 'beefbeef-0005-4000-8000-000000000005';
const ACTIVE_TASK_ID = 'beefbeef-0006-4000-8000-000000000006';

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
  return layers[0].route.stack.at(-1).handle;
}

async function cleanup() {
  await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [[RUN_DONE_ID, RUN_FAILED_ID, ACTIVE_TASK_ID]]);
  await pool.query('DELETE FROM journey_features WHERE id = ANY($1)', [[JF_ABILITY_ID, JF_FEATURE_ID]]);
  await pool.query('DELETE FROM value_streams WHERE id = $1', [JOURNEY_ID]);
}

beforeAll(async () => {
  await cleanup();
  await pool.query(
    `INSERT INTO value_streams (id, name, status) VALUES ($1, '[test] warroom 列名回归线', 'active')`,
    [JOURNEY_ID]
  );
  await pool.query(
    `INSERT INTO journey_features (id, journey_id, name, kind, status, "group")
     VALUES ($1, $2, '[test] 能力A', 'ability', 'working', '测试组'),
            ($3, $2, '[test] 使能件B', 'feature', 'planned', NULL)`,
    [JF_ABILITY_ID, JOURNEY_ID, JF_FEATURE_ID]
  );
  await pool.query(
    `INSERT INTO tasks (id,title,task_type,status,payload)
     VALUES ($1,'已完成','dev','completed',$4::jsonb),
            ($2,'失败','dev','failed',$4::jsonb),
            ($3,'正在实施','dev','in_progress',$4::jsonb)`,
    [RUN_DONE_ID, RUN_FAILED_ID, ACTIVE_TASK_ID, JSON.stringify({journey_id:JOURNEY_ID})]
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

  it('active_tasks 只返回该价值流进行中的开发任务', async () => {
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({ id: JOURNEY_ID });
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._data.connections.active_tasks).toMatchObject([
      {id: ACTIVE_TASK_ID, status: 'in_progress', task_type: 'dev'},
    ]);
  });

  it('health 统计该价值流的开发任务及已完成数', async () => {
    const handler = getHandler('get', '/line/:id/command');
    const { req, res } = mockReqRes({ id: JOURNEY_ID });
    await handler(req, res);

    expect(res._status).toBe(200);
    const { health } = res._data;
    expect(health.run_total).toBe(3);
    expect(health.run_success).toBe(1);
    expect(health.success_rate).toBe(33);
  });
});
