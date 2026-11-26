import {afterEach, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {TASK_MUTATION_RATE_LIMIT_OPTIONS} from '../task-mutation-rate-limit.js';

const database = vi.hoisted(() => ({query: vi.fn(async () => ({rows: []})), connect: vi.fn()}));
vi.mock('../../db.js', () => ({default: database}));
import router from '../agent-ops.js';

afterEach(() => vi.unstubAllEnvs());

it('盘点导入的失败鉴权消耗既有写入口配额，超限不鉴权写库且不限制只读查询', async () => {
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'isolated-import-rate-limit');
  const app = express().use(express.json()).use('/agent-ops', router);
  const send = () => request(app).post('/agent-ops/alarms/import').send({items: []});
  // 合法鉴权仍由原入口校验请求；配额包含这次请求及其后的失败鉴权。
  const normal = await send().set('Authorization', 'Bearer isolated-import-rate-limit');
  expect(normal.status).toBe(400);
  for (let index = 1; index < TASK_MUTATION_RATE_LIMIT_OPTIONS.limit; index++) {
    expect((await send()).status).toBe(401);
  }
  const rejected = await send();
  expect(rejected.status).toBe(429);
  expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
  expect((await send().set('Authorization', 'Bearer isolated-import-rate-limit')).status).toBe(429);
  expect(database.query).not.toHaveBeenCalled();
  expect(database.connect).not.toHaveBeenCalled();
  // 配额只属于写入口；运维看板的只读查询继续工作。
  expect((await request(app).get('/agent-ops/alarms')).status).toBe(200);
  expect(database.query).toHaveBeenCalled();
}, 15000);
