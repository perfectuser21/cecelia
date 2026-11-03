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

it.each([false,true])('F1接单：受鉴权恢复含可选目标(%s)仍拒绝退役Kernel新建，原失败记录不变', async withTarget => {
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
  expect(accepted.status).toBe(410);
  expect(accepted.body.error).toBe('kernel_runtime_retired');
  expect(f.calls).toHaveLength(0); // 不改旧run/receipt，不建立新controller/run。
  const unchanged = fixture(); delete unchanged.input.recoveryRebase;
  await expect(createKernelRun(unchanged.pool, unchanged.input, unchanged.deps))
    .rejects.toMatchObject({code:'kernel_runtime_retired'});
  expect(unchanged.calls).toHaveLength(0);
});
