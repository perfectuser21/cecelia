/**
 * Legacy POST /orchestrator/relay-runs/:initiative_id compatibility adapter.
 *
 * It may remain during the PR2 migration window, but it must never infer a
 * task identity or create an identity-less v2 run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockPool,
  mockCreateKernelRun,
} = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
  mockCreateKernelRun: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  createKernelRun: mockCreateKernelRun,
  loadKernelRunById: vi.fn(),
  patchLegacyKernelRunByInitiative: vi.fn(),
  patchKernelRunById: vi.fn(),
}));

const INITIATIVE_ID = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const RUN_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const app = express();
  app.use(express.json());
  app.use('/api/brain/orchestrator', router);
  return app;
}

describe('legacy POST新建入口退役，不能推断身份或重播已有run',()=>{
 beforeEach(()=>{mockPool.query.mockReset();mockPool.connect.mockReset();mockCreateKernelRun.mockReset();});
 it.each([{}, {phase:'invalid'}, {current_task_id:TASK_ID,created_source:'foreground_handoff'}, {current_task_id:TASK_ID,created_source:'foreground_handoff',run_id:RUN_ID}])('input%j明确410，零数据库和控制器调用',async body=>{
  const app=await buildApp();const response=await request(app).post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`).send(body);
  expect(response.status).toBe(410);expect(response.body.error).toBe('kernel_runtime_retired');expect(mockCreateKernelRun).not.toHaveBeenCalled();expect(mockPool.connect).not.toHaveBeenCalled();expect(mockPool.query).not.toHaveBeenCalled();
 });
});
