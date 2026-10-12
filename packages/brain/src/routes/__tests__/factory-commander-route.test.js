import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
import router from '../factory-ledger.js';

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
  it.each([{ enabled: 'false', actor: 'operator', reason: '关闭' }, { enabled: false, actor: 'operator', reason: '关闭', key: 'arbitrary_config' }])('严格输入在进库前拒绝 %j', async body => {
    const response = await request(app).put(path).set('Authorization', 'Bearer fixture-internal-token').send(body);
    expect(response.status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
});
