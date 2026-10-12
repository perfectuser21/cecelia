import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
import router from '../factory-ledger.js';
import { commanderProofFixture } from '../../__tests__/helpers/factory-commander-proof-fixture.js';

const app = express();
app.use(express.json());
app.use('/api/brain', router);
const path = '/api/brain/factory/commander-route';
beforeEach(() => {
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'fixture-internal-token');
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.connect.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('工厂开关 HTTP 入口', () => {
  it('GET 返回真实默认关闭', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
  });
  it('未经内部认证不可写', async () => {
    expect((await request(app).put(path).send({ enabled: false, actor: 'operator', reason: '关闭' })).status).toBe(401);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each([{ enabled: 'false', actor: 'operator', reason: '关闭' }, { enabled: true, actor: 'operator', reason: '开启', evidence_task_id: ['80000000-0000-4000-8000-000000000001'] }, { enabled: false, actor: 'operator', reason: '关闭', key: 'arbitrary_config' }])('严格输入在进库前拒绝 %j', async body => {
    const response = await request(app).put(path).set('Authorization', 'Bearer fixture-internal-token').send(body);
    expect(response.status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each(['success', 'judge-fail', 'audit-fail'])('HTTP %s 保留真实证据门禁、回读和错误状态', async mode => {
    const fixture = commanderProofFixture();
    if (mode === 'judge-fail') fixture.task.result.factory_judge.verdict = 'fail';
    let config;
    const client = { release: vi.fn(), query: vi.fn(async (sql, params = []) => {
      if (sql.startsWith('SELECT value')) return { rows: config ? [config] : [] };
      if (sql.includes('SELECT id,task_type')) return { rows: [fixture.task] };
      if (sql.includes('SELECT id,status,payload')) return { rows: [fixture.verificationTask] };
      if (sql.includes('SELECT payload FROM task_events')) return { rows: [{ payload: fixture.reaped }] };
      if (sql.includes('INSERT INTO brain_config')) config = { value: params[1], metadata: params[2] };
      if (sql.includes('INSERT INTO cecelia_events') && mode === 'audit-fail') throw new Error('audit storage unavailable');
      return { rows: [] };
    }) };
    db.connect.mockResolvedValue(client);
    const response = await request(app).put(path).set('Authorization', 'Bearer fixture-internal-token')
      .send({ enabled: true, actor: 'Codex/operator', reason: '核验通过', evidence_task_id: fixture.taskId });
    expect(response.status).toBe(mode === 'success' ? 200 : mode === 'judge-fail' ? 409 : 500);
    if (mode === 'success') expect(response.body).toMatchObject({ enabled: true, changed: true, metadata: { verification_task_id: fixture.verificationTask.id } });
    else expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
