import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createKernelRun } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
import { fixture } from '../../../packages/brain/src/orchestrator/__tests__/recovery-rebase.fixture.js';

// 仅替换连接传输；入口、Controller/收据事务和原有 preflight 调用都是真模块。
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: db }));
afterEach(() => vi.unstubAllEnvs());

it('F1接单：受鉴权的显式恢复重新进planning并返回新Controller和收据，原失败记录不变', async () => {
  const f = fixture();
  db.connect.mockImplementation(f.pool.connect);
  const { default: router } = await import('../../../packages/brain/src/routes/initiatives.js');
  const app = express(); app.use(express.json());
  app.set('kernelRunStoreDeps', f.deps);
  app.use('/api/brain/orchestrator', router);
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'synthetic-recovery-token');
  const body = { initiative_id: f.input.initiativeId, current_task_id: f.input.taskId,
    created_source: f.input.createdSource, phase: 'planning', predecessor_run_id: f.input.predecessorRunId,
    recovery_rebase: f.request };
  const denied = await request(app).post('/api/brain/orchestrator/relay-runs').send(body);
  expect(denied.status).toBe(401); expect(f.calls).toHaveLength(0);
  const accepted = await request(app).post('/api/brain/orchestrator/relay-runs')
    .set('X-Internal-Token', 'synthetic-recovery-token').send(body);
  expect(accepted.status).toBe(201);
  expect(accepted.body.run.phase).toBe('planning');
  expect(accepted.body.run.controller_session_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(accepted.body.routing_receipt_id).not.toBe(body.recovery_rebase.expected_receipt_id);
  expect(accepted.body.base_sha).toBe(body.recovery_rebase.base_sha);
  expect(f.calls.some(c => /UPDATE (initiative_runs|work_routing_receipts)/.test(c.sql))).toBe(false);
  expect(f.calls.at(-1).sql).toBe('COMMIT');
  const unchanged = fixture(); delete unchanged.input.recoveryRebase;
  await expect(createKernelRun(unchanged.pool, unchanged.input, unchanged.deps))
    .rejects.toThrow('explicit recovery predecessor is invalid');
});
