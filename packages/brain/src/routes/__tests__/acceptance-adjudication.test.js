import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../actions.js', () => ({ createTask: vi.fn() }));
vi.mock('../../system-coding-route.js', () => ({ buildCeceliaMutationRoute: () => ({}) }));
import { createTask } from '../../actions.js';
import { createAcceptanceInternalRouter } from '../acceptance.js';

const servers = new Set();
afterEach(async () => {
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))));
  servers.clear();
});
beforeEach(() => {
  createTask.mockReset().mockImplementation(async input => ({ task: { id: 'fixture-task', payload: input.payload } }));
});

// 只替换外部存储和任务写入。所有状态守卫、裁决与分流均运行真实 router。
async function fixture({ status = 'human_complete', aiStatus = 'ok', checks } = {}) {
  const run = { id: 'run-id', run_key: 'fixture-run', title: 'fixture', gp_id: 'gp-id', status, detail: { ai_status: aiStatus } };
  const rows = checks ?? [{ id: 'check-id', check_key: 'S1-c1', is_hard: false, adjudication: null }];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, params) => {
      if (sql.includes('FROM acceptance_runs WHERE run_key')) return { rows: [run] };
      if (sql.includes('FROM acceptance_checks WHERE run_id')) {
        return { rows: sql.includes('AND check_key') ? rows.filter(row => row.check_key === params[1]) : rows };
      }
      if (sql.startsWith('UPDATE acceptance_checks SET adjudication')) {
        rows.find(row => row.id === params[1]).adjudication = JSON.parse(params[0]);
      }
      return { rows: [] };
    }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool: { connect: async () => client } }));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  servers.add(server);
  return { client, run, rows, http: request(server) };
}
const root = '/api/brain/acceptance/runs/fixture-run';
const decision = { verdict: '绿', by: 'fixture-owner', reason: 'observed evidence' };
const greenChecks = () => Array.from({ length: 36 }, (_, index) => ({
  id: `check-${index}`, check_key: `S1-c${index + 1}`, adjudication: { verdict: '绿' },
}));

describe('人工验收裁决的真实路由行为', () => {
  it.each(['adjudicated', 'stale'])('%s 不能被 abandon 覆盖且零写入', async status => {
    const { http, client } = await fixture({ status });
    const response = await http.patch(`${root}/abandon`).send({ by: 'fixture-owner', reason: 'request' });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'cannot_abandon', current_status: status });
    expect(client.query.mock.calls.some(([sql]) => /^UPDATE|^INSERT/.test(sql))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('裁决四字段由服务端保存并返回，全部裁决后更新 gate', async () => {
    const { http, client } = await fixture();
    const response = await http.patch(`${root}/checks/S1-c1/adjudicate`).send(decision);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ adjudication: decision, gate_verdict: '绿', check_key: 'S1-c1' });
    expect(Number.isFinite(Date.parse(response.body.adjudication.at))).toBe(true);
    const write = client.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE acceptance_checks'));
    expect(JSON.parse(write[1][0])).toEqual(response.body.adjudication);
    expect(write[1][1]).toBe('check-id');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('本版不可验证的 hard 绿格只写注记，不误建 P0', async () => {
    const { http, client } = await fixture({ checks: [{ id: 'hard', check_key: 'S1-c1', is_hard: true, scenario_class: 'unverifiable_this_version' }] });
    const response = await http.patch(`${root}/checks/S1-c1/adjudicate`).send(decision);
    expect(response.status).toBe(200);
    expect(createTask).not.toHaveBeenCalled();
    const writes = client.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE acceptance_runs'));
    expect(writes.map(([, params]) => JSON.parse(params[0]))).toContainEqual({ unverifiable_adjudicated: ['S1-c1'] });
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('普通 hard 绿格创建 P0；重复任务冲突不丢弃裁决事务', async () => {
    const { http, client } = await fixture({ checks: [{ id: 'hard', check_key: 'S1-c1', is_hard: true }] });
    createTask.mockRejectedValueOnce(Object.assign(new Error('fixture duplicate task'), { code: '23505' }));
    const response = await http.patch(`${root}/checks/S1-c1/adjudicate`).send(decision);
    expect(response.status).toBe(200);
    expect(createTask).toHaveBeenCalledOnce();
    expect(createTask.mock.calls[0][0]).toMatchObject({ priority: 'P0', db: client, payload: { acceptance_bucket: 'hard_green_p0', check_key: 'S1-c1' } });
    const commands = client.query.mock.calls.map(([sql]) => sql);
    expect(commands.indexOf('SAVEPOINT hard_green_p0_insert')).toBeLessThan(commands.indexOf('ROLLBACK TO SAVEPOINT hard_green_p0_insert'));
    expect(commands.at(-1)).toBe('COMMIT');
    expect(response.body.adjudication).toMatchObject(decision);
    expect(commands).not.toContain('ROLLBACK');
  });

  it.each([
    ['dumb', 0, ['infra_error']],
    ['ok', 13, ['fission']],
    ['ok', 2, ['bug', 'trace']],
    ['ok', 0, []],
  ])('整单分流 ai=%s 红格=%i → %j', async (aiStatus, redCount, buckets) => {
    const checks = greenChecks();
    for (const check of checks.slice(0, redCount)) {
      check.adjudication = { verdict: '红' };
      check.scenario_class = 'trace_q4';
    }
    const { http, client } = await fixture({ aiStatus, checks });
    const response = await http.patch(`${root}/adjudicate-run`).send({});
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('adjudicated');
    expect(createTask.mock.calls.map(([input]) => input.payload.acceptance_bucket)).toEqual(buckets);
    expect(response.body.tasks).toHaveLength(buckets.length);
    for (const [input] of createTask.mock.calls) {
      expect(input.db).toBe(client);
      expect(input.payload.acceptance_run_key).toBe('fixture-run');
    }
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('整单聚合任务冲突仅回滚 savepoint，仍提交定案', async () => {
    const checks = greenChecks();
    checks[0].adjudication = { verdict: '红' };
    const { http, client } = await fixture({ checks });
    createTask.mockRejectedValueOnce(Object.assign(new Error('fixture duplicate'), { code: '23505' }));
    const response = await http.patch(`${root}/adjudicate-run`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'adjudicated', tasks: [] });
    expect(client.query).toHaveBeenCalledWith('SAVEPOINT task_insert_bug');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT task_insert_bug');
    expect(client.query.mock.calls.some(([sql]) => sql.includes("SET status = 'adjudicated'"))).toBe(true);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK');
  });
});
