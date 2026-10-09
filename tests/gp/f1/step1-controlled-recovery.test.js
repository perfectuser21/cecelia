import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createKernelRun } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
import { fixture } from '../../../packages/brain/src/orchestrator/__tests__/recovery-rebase.fixture.js';
import { executionProfileHash } from '../../../packages/brain/src/orchestrator/recovery-execution-profile.js';
import { seedExecutionDirectoryFixture } from '../../../packages/brain/src/__tests__/helpers/execution-directory-fixture.js';

// 仅替换连接传输；入口、Controller/收据事务和原有 preflight 调用都是真模块。
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: db }));
afterEach(() => vi.unstubAllEnvs());

it.each([false,true])('F1接单：受鉴权恢复含可选目标(%s)重新进planning，原失败记录不变', async withTarget => {
  const f = fixture();
  if (withTarget) {
    const snapshot = await seedExecutionDirectoryFixture();
    const node = snapshot.nodes.find(n=>n.canonical_id==='xian-mac-m4');
    const grant = node.grants.find(g=>g.surface==='harness'&&g.account_id==='team2');
    Object.assign(f.request,{ expected_profile_hash:executionProfileHash({}),
      execution_target:{machine:node.canonical_id,provider:'codex',account:'team2'} });
    const client = await f.pool.connect(), query = client.query;
    client.query = async (sql,params)=>{
      if (/SELECT v\.\*,n.canonical_id/.test(sql)) return {rows:[node]};
      if (/SELECT \* FROM execution_grants/.test(sql)) return {rows:[grant]};
      return query(sql,params);
    };
  }
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
  if (withTarget) {
    const receipt = f.calls.find(c=>/INSERT INTO work_routing_receipts/.test(c.sql));
    expect(JSON.parse(receipt.params[15]).recovery_rebase.execution_profile.target).toEqual(f.request.execution_target);
  }
  const unchanged = fixture(); delete unchanged.input.recoveryRebase;
  await expect(createKernelRun(unchanged.pool, unchanged.input, unchanged.deps))
    .rejects.toThrow('explicit recovery predecessor is invalid');
});
