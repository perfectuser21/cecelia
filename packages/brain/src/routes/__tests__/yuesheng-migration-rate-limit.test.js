import express, { Router } from 'express';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { TASK_MUTATION_RATE_LIMIT_OPTIONS } from '../task-mutation-rate-limit.js';
import { registerYueshengMigrationPendingAction } from '../yuesheng-migration-pending-action.js';

vi.mock('../../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));

afterEach(() => vi.unstubAllEnvs());

it.each(['pending-action', 'approval'])('%s 鉴权失败计入任务配额，超限后请求不会到达数据库', async operation => {
  const token = 'isolated-yuesheng-limiter-test';
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', token);
  const pool = { connect: vi.fn(), query: vi.fn() };
  const router = Router();
  registerYueshengMigrationPendingAction(router, pool);
  const app = express().use(express.json()).use(router);
  const endpoint = '/tasks/8f5f6442-540f-48b6-9577-c21cd848aa02/yuesheng-adb-migration/';

  const send = () => request(app).post(endpoint + operation).send({});
  for (let index = 0; index < TASK_MUTATION_RATE_LIMIT_OPTIONS.limit; index++) {
    expect((await send()).status).toBe(401);
  }
  const rejected = await send().set('X-Internal-Token', token);
  expect(rejected.status).toBe(429);
  expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0);
  expect(pool.connect).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
}, 15_000);
