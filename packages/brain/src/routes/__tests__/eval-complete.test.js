import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  client: { query: vi.fn(), release: vi.fn() },
  relay: vi.fn(), effects: [], forbidden: [],
  deny(kind) { this.forbidden.push(kind); throw Error("forbidden " + kind); },
}));
vi.mock('../../db.js', () => ({ default: boundary.pool }));
vi.mock('../../actions.js', () => ({ createTask: () => boundary.deny('createTask') }));
vi.mock('../../lib/relay-baton.js', () => ({ relayOnComplete: boundary.relay }));
vi.mock('fs', () => ({ default: { promises: new Proxy({}, {
  get: () => () => boundary.deny('filesystem'),
}) } }));
vi.mock('child_process', () => ({
  spawn: () => boundary.deny('spawn'),
  execFile: () => boundary.deny('execFile'),
  execFileSync: () => boundary.deny('execFileSync'),
}));
import router from '../eval.js';

const taskId = '11111111-1111-4111-8111-111111111111';
const reportUrl = 'https://reports.invalid/owned-fixture';
let server;
let evaluationRows;
let terminalRows;
let failAt;
function commands() { return boundary.effects.map(x => x.command); }
async function query(sql, params) {
  const text = sql.trim();
  const command = text.startsWith('UPDATE skill_evals') ? 'eval' :
    text.startsWith('UPDATE tasks') ? 'terminal' : text;
  boundary.effects.push({ command, sql, params });
  if (command === failAt) throw Error('owned db failure');
  if (command === 'eval') return { rowCount: evaluationRows, rows: [] };
  if (command === 'terminal') return { rowCount: terminalRows,
    rows: terminalRows ? [{ id: taskId, status: 'completed' }] : [] };
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(command)) return { rowCount: null, rows: [] };
  throw Error('unexpected SQL');
}
async function complete(body = { task_id: taskId, report_url: reportUrl }) {
  return request(server).post('/api/skill-eval/complete')
    .set('X-Eval-Proxy-Token', 'owned-eval-token').send(body);
}
beforeEach(async () => {
  vi.clearAllMocks();
  boundary.effects.length = 0; boundary.forbidden.length = 0;
  evaluationRows = 1; terminalRows = 1; failAt = undefined;
  boundary.pool.query.mockImplementation(query);
  boundary.client.query.mockImplementation(query);
  boundary.pool.connect.mockResolvedValue(boundary.client);
  boundary.relay.mockImplementation(async pool => {
    expect(pool).toBe(boundary.pool);
    expect(boundary.client.release).toHaveBeenCalled();
    boundary.effects.push({ command: 'relay' });
    return null;
  });
  vi.stubEnv('EVAL_PROXY_TOKEN', 'owned-eval-token');
  vi.stubGlobal('fetch', () => boundary.deny('fetch'));
  const app = express(); app.use(express.json()); app.use('/api/skill-eval', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
});
afterEach(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  expect(boundary.forbidden).toEqual([]);
});

describe('真实 /skill-eval/complete 与真实 task-terminal 的写入回执', () => {
  it('评估记录零行：404、回滚且不完成其它任务', async () => {
    evaluationRows = 0;
    const res = await complete();
    expect(res.status).toBe(404);
    expect(res.body.ok).not.toBe(true);
    expect(commands()).toEqual(['BEGIN', 'eval', 'ROLLBACK']);
    expect(boundary.client.release).toHaveBeenCalledOnce();
    expect(boundary.relay).not.toHaveBeenCalled();
  });
  it('任务终态被缺失/权限门拒绝：409、回滚评估，不接棒', async () => {
    terminalRows = 0;
    const res = await complete();
    expect(res.status).toBe(409);
    expect(res.body.ok).not.toBe(true);
    expect(commands()).toEqual(['BEGIN', 'eval', 'terminal', 'ROLLBACK']);
    expect(boundary.client.release).toHaveBeenCalledOnce();
    expect(boundary.relay).not.toHaveBeenCalled();
  });
  it('正常完成：提交后才接棒，保留原200封套和真实写入参数', async () => {
    const res = await complete({ task_id: taskId, report_url: reportUrl, report_data: { score: 75 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, task_id: taskId, report_url: reportUrl });
    expect(commands()).toEqual(['BEGIN', 'eval', 'terminal', 'COMMIT', 'relay']);
    expect(boundary.effects[1].params).toEqual([reportUrl, '{"score":75}', taskId]);
    expect(boundary.effects[2].params).toEqual([taskId, JSON.stringify({ report_url: reportUrl })]);
    expect(boundary.effects[2].sql).toContain('RETURNING id, status');
    expect(boundary.effects[2].sql).toContain("commander_protocol");
    expect(boundary.pool.query).not.toHaveBeenCalled();
    expect(boundary.client.release).toHaveBeenCalledOnce();
  });
  it('同一已存在记录重复回调仍200；不新增状态CAS或绕过终态权限', async () => {
    expect((await complete()).status).toBe(200);
    expect((await complete()).status).toBe(200);
    expect(commands()).toEqual(['BEGIN', 'eval', 'terminal', 'COMMIT', 'relay',
      'BEGIN', 'eval', 'terminal', 'COMMIT', 'relay']);
    expect(boundary.client.release).toHaveBeenCalledTimes(2);
  });
  it.each(['eval', 'terminal', 'COMMIT'])('%s异常：500、回滚、释放连接且不接棒', async phase => {
    failAt = phase;
    const res = await complete();
    expect(res.status).toBe(500);
    expect(res.body.ok).not.toBe(true);
    expect(commands().at(-1)).toBe('ROLLBACK');
    expect(boundary.client.release).toHaveBeenCalledOnce();
    expect(boundary.relay).not.toHaveBeenCalled();
  });
  it('缺失更新行数也是未知，不可声明成功', async () => {
    evaluationRows = undefined;
    expect((await complete()).status).toBe(404);
    expect(commands()).toEqual(['BEGIN', 'eval', 'ROLLBACK']);
    expect(boundary.relay).not.toHaveBeenCalled();
  });
  it('同task关联多条历史评估记录仍保原批量更新合同', async () => {
    evaluationRows = 2;
    expect((await complete()).status).toBe(200);
    expect(commands()).toEqual(['BEGIN', 'eval', 'terminal', 'COMMIT', 'relay']);
  });
  it('未传report_data使用null保留原报告字段', async () => {
    expect((await complete()).status).toBe(200);
    expect(boundary.effects.find(x => x.command === 'eval').params).toEqual([reportUrl, null, taskId]);
  });
  it('缺参数400，无DB操作', async () => {
    expect((await complete({ task_id: taskId })).status).toBe(400);
    expect(commands()).toEqual([]);
    expect(boundary.pool.connect).not.toHaveBeenCalled();
  });
  it('错误token403，无DB操作', async () => {
    const res = await request(server).post('/api/skill-eval/complete')
      .set('X-Eval-Proxy-Token', 'wrong-owned-token')
      .send({ task_id: taskId, report_url: reportUrl });
    expect(res.status).toBe(403);
    expect(commands()).toEqual([]);
    expect(boundary.pool.connect).not.toHaveBeenCalled();
  });
});
