import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';

let pool, testDatabase;
const prefix = `intake-test-${randomUUID()}`;
let createTaskIntake, createTaskIntakeRouter;
const baseCandidate = (text, patch = {}) => ({ intent: 'research', title: text,
  objective: text, mutation_intent: 'read_only', change_kind: null, repo: null,
  map_scope: [], confidence: 0.98, evidence: [text], questions: [], ...patch });
function fixture(candidate, db = pool) {
  const callLLM = vi.fn(async () => ({ text: JSON.stringify(candidate) }));
  const intake = createTaskIntake({ db, callLLM });
  const app = express().use(express.json()).use('/api/brain/task-intake', createTaskIntakeRouter({ intake }));
  return { app, intake, callLLM };
}
async function countTasks(sourceId) {
  return Number((await pool.query(
    "SELECT count(*) FROM tasks WHERE payload->'intake'->>'source_id'=$1", [sourceId],
  )).rows[0].count);
}
beforeAll(async () => {
  ({ createTaskIntake } = await import('../../task-intake.js').catch(() => ({})));
  ({ createTaskIntakeRouter } = await import('../../routes/task-intake.js').catch(() => ({})));
  expect(createTaskIntake, '需实现真实交办服务').toBeTypeOf('function');
  testDatabase = await createIntakeTestDatabase();
  pool = testDatabase.pool;
});
afterAll(async () => { await testDatabase?.close(); });

describe('真实HTTP与PostgreSQL收据', () => {
  it.each([
    ['research', '调研任务接单的设计方案'],
    ['code_review', '审查 Cecelia 接单代码，仅给建议'],
  ])('%s落入真实tasks与work_routing_receipts并可重放', async (intent, text) => {
    const f = fixture(baseCandidate(text, { intent }));
    const source_id = `${prefix}-${intent}`;
    const response = await request(f.app).post('/api/brain/task-intake').send({ text, source_id });
    expect(response.status).toBe(201);
    const row = (await pool.query(`SELECT t.*, r.id AS receipt_id, r.canonical_task_type
      FROM tasks t JOIN work_routing_receipts r ON r.task_id=t.id WHERE t.id=$1`, [response.body.task_id])).rows[0];
    expect(row.task_type).toBe(intent);
    expect(row.payload.routing_receipt_id).toBe(row.receipt_id);
    expect(row.description).toContain(text);
    expect(row.payload.intake.source_id).toBe(source_id);
    const repeat = await request(f.app).post('/api/brain/task-intake').send({ text, source_id });
    expect(repeat.status).toBe(200);
    expect(repeat.body.task_id).toBe(row.id);
    expect(f.callLLM).toHaveBeenCalledOnce();
  });

  it('并发请求只创建一个真实task和receipt', async () => {
    const text = '调研任务并发接单的设计方案';
    const f = fixture(baseCandidate(text));
    const source_id = `${prefix}-concurrent`;
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      request(f.app).post('/api/brain/task-intake').send({ text, source_id })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.task_id)).size).toBe(1);
    expect(await countTasks(source_id)).toBe(1);
    expect(Number((await pool.query('SELECT count(*) FROM work_routing_receipts WHERE task_id=$1',
      [results[0].body.task_id])).rows[0].count)).toBe(1);
  });

  it('明确代码修改经过真实active地图门禁落harness任务及完整收据', async () => {
    const text = '修复 Cecelia 接单重复创建任务的问题';
    const f = fixture(baseCandidate(text, { intent: 'coding_change', mutation_intent: 'write',
      change_kind: 'bugfix', repo: 'cecelia', map_scope: ['F1'] }));
    const response = await request(f.app).post('/api/brain/task-intake')
      .send({ text, source_id: `${prefix}-coding` });
    expect(response.status).toBe(201);
    const row = (await pool.query(`SELECT t.task_type,t.payload,r.* FROM tasks t
      JOIN work_routing_receipts r ON r.task_id=t.id WHERE t.id=$1`, [response.body.task_id])).rows[0];
    expect(row.task_type).toBe('harness_initiative');
    expect(row).toMatchObject({ repo: 'cecelia', map_scope: ['F1'], change_kind: 'bugfix',
      pipeline: 'harness', work_kind: 'coding_mutation', default_execution_profile: 'hotfix-v1' });
    expect(row.payload.routing_receipt_id).toBe(row.id);
    expect(row.evidence.base_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(row.map_scope_validation_version).toBeTruthy();
  });

  it('同key异内容并发冲突不会创建第二张task', async () => {
    const text = '调研接单设计方案';
    const source_id = `${prefix}-conflict`;
    const f = fixture(baseCandidate(text));
    expect((await f.intake({ text, source_id })).status).toBe(201);
    expect((await f.intake({ text: '另一个任务', source_id })).status).toBe(409);
    expect(await countTasks(source_id)).toBe(1);
  });

  it('租户相同source_id分别建单且禁止body伪造租户', async () => {
    const text = '调研租户接单方案';
    const source_id = `${prefix}-tenant`;
    const f = fixture(baseCandidate(text));
    const first = await request(f.app).post('/api/brain/task-intake').set('x-tenant-id', 'a').send({ text, source_id });
    const second = await request(f.app).post('/api/brain/task-intake').set('x-tenant-id', 'b').send({ text, source_id });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.task_id).not.toBe(second.body.task_id);
    expect((await request(f.app).post('/api/brain/task-intake').send({ text, source_id, tenant_id: 'a' })).status).toBe(400);
  });

  it('真实task INSERT后收据失败时回滚，不留下半张任务', async () => {
    const source_id = `${prefix}-rollback`;
    const text = '调研收据事务方案';
    let reachedReceipt = false;
    const failingPool = { query: pool.query.bind(pool), connect: async () => {
      const client = await pool.connect();
      return { release: client.release.bind(client), query: async (sql, args) => {
        if (String(sql).includes('INSERT INTO work_routing_receipts')) {
          reachedReceipt = true;
          await client.query('SELECT 1 / 0');
        }
        return client.query(sql, args);
      } };
    } };
    const f = fixture(baseCandidate(text), failingPool);
    const result = await request(f.app).post('/api/brain/task-intake').send({ text, source_id });
    expect(reachedReceipt).toBe(true);
    expect(result.status).toBe(503);
    expect(result.body.task_id).toBeNull();
    expect(await countTasks(source_id)).toBe(0);
    expect(pool.waitingCount).toBe(0);
  });
});
