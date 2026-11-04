import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { seedActiveF1 } from '../fixtures/work-routing-fixture.js';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
vi.mock('../../openai-client.js', () => ({ generateEmbedding: vi.fn(() => { throw new Error('external embedding forbidden'); }) }));
vi.mock('../../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(() => { throw new Error('external model forbidden'); }) }));
vi.mock('../../db.js', () => ({ default: { query: (sql, ...args) => client.query(({ BEGIN: 'SAVEPOINT learning_route', COMMIT: 'RELEASE SAVEPOINT learning_route', ROLLBACK: 'ROLLBACK TO SAVEPOINT learning_route' })[sql] || sql, ...args) } }));
let client;
let learning;
beforeAll(async () => {
  client = new pg.Client(privatePgConfig());
  await client.connect();
  await verifyPrivatePg(client);
  await client.query('BEGIN');
  learning = await import('../../learning.js');
});
afterAll(async () => { if (client) { await client.query('ROLLBACK'); await client.end(); } });
it('最小旧schema迁移幂等保全key/value与既有metadata', async () => {
  const migration = readFileSync(new URL('../../../migrations/557_brain_config_metadata.sql', import.meta.url), 'utf8');
  await client.query('SAVEPOINT minimum_schema');
  try {
    await client.query('CREATE TEMP TABLE brain_config(key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())');
    await client.query("INSERT INTO brain_config(key,value) VALUES ('legacy','0.9')");
    await client.query(migration);
    expect((await client.query("SELECT key,value,metadata FROM brain_config WHERE key='legacy'")).rows[0]).toEqual({ key: 'legacy', value: '0.9', metadata: {} });
    await client.query(`UPDATE brain_config SET metadata='{"previous_audit":"preserved"}'`);
    await client.query(migration);
    expect((await client.query('SELECT metadata FROM brain_config')).rows[0].metadata).toEqual({ previous_audit: 'preserved' });
  } finally { await client.query('ROLLBACK TO SAVEPOINT minimum_schema'); await client.query('RELEASE SAVEPOINT minimum_schema'); }
});
it('完整正式迁移支持策略写入，真实读回值及审计', async () => {
  const id = (await client.query("INSERT INTO learnings(title,content) VALUES ('strategy regression','regression') RETURNING id")).rows[0].id;
  const result = await learning.applyStrategyAdjustments([{ params: { param: 'retry.max_attempts', new_value: 4, old_value: 2, reason: '真实审计' } }], id);
  expect(result).toEqual({ applied: 1, skipped: 0, errors: [] });
  const row = (await client.query("SELECT value,metadata FROM brain_config WHERE key='retry.max_attempts'")).rows[0];
  expect(JSON.parse(row.value)).toBe(4);
  expect(row.metadata).toMatchObject({ learning_id: id, old_value: 2, reason: '真实审计' });
  expect((await client.query('SELECT applied FROM learnings WHERE id=$1', [id])).rows[0].applied).toBe(true);
});
it('真实RCA建单走当前路由收据，未知来源拒绝自动修复', async () => {
  await seedActiveF1(client);
  const sourceId = (await client.query(`INSERT INTO tasks(title,payload) VALUES ('source ' || gen_random_uuid(), '{"repo":"cecelia","map_scope":["F1"]}') RETURNING id`)).rows[0].id;
  const result = await learning.recordLearning({ task_id: sourceId, analysis: { root_cause: `routing ${randomUUID()}` }, confidence: .9, learnings: [], recommended_actions: [] });
  const { rows } = await client.query("SELECT id,task_type,payload FROM tasks WHERE payload->>'insight_learning_id'=$1", [result.id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].task_type).toBe('coding_workflow');
  expect(rows[0].payload).toMatchObject({ repo: 'cecelia', map_scope: ['F1'], change_kind: 'bugfix' });
  expect((await client.query('SELECT repo,map_scope FROM work_routing_receipts WHERE task_id=$1', [rows[0].id])).rows).toEqual([{ repo: 'cecelia', map_scope: ['F1'] }]);
  const unknownId = (await client.query("INSERT INTO tasks(title) VALUES ('unknown ' || gen_random_uuid()) RETURNING id")).rows[0].id;
  const blocked = await learning.recordLearning({ task_id: unknownId, analysis: { root_cause: `unknown ${randomUUID()}` }, confidence: .9, learnings: [], recommended_actions: [] });
  expect((await client.query('SELECT applied,metadata FROM learnings WHERE id=$1', [blocked.id])).rows[0]).toMatchObject({ applied: false, metadata: { insight_task_status: 'blocked', insight_task_reason: 'source_route_context_missing' } });
  expect((await client.query("SELECT id FROM tasks WHERE payload->>'insight_learning_id'=$1", [blocked.id])).rows).toHaveLength(0);
});

it.each([
  ['missing-repository', ['F1'], 'repo_unknown'],
  ['cecelia', ['missing-scope'], 'routing_map_scope_unresolved'],
])('真实路由拒绝非法仓库或范围 %s %j，不虚标applied', async (repo, mapScope, reason) => {
  const source = (await client.query('INSERT INTO tasks(title,payload) VALUES ($1,$2) RETURNING id', [`invalid ${randomUUID()}`, { repo, map_scope: mapScope }])).rows[0];
  const result = await learning.recordLearning({ task_id: source.id, analysis: { root_cause: `invalid ${randomUUID()}` }, confidence: .9, learnings: [], recommended_actions: [] });
  expect((await client.query('SELECT applied,metadata FROM learnings WHERE id=$1', [result.id])).rows[0]).toMatchObject({ applied: false, metadata: { insight_task_status: 'blocked', insight_task_reason: reason } });
  expect((await client.query("SELECT id FROM tasks WHERE payload->>'insight_learning_id'=$1", [result.id])).rows).toHaveLength(0);
});

it.each([
  ['cecelia', ['F1'], null],
  ['missing-repository', ['F1'], 'repo_unknown'],
  ['cecelia', ['missing-scope'], 'routing_map_scope_unresolved'],
])('同标题的不同Learning不能复用任务或绕过来源路由 %s %j', async (repo, mapScope, reason) => {
  await seedActiveF1(client);
  const cause = `shared-title-${randomUUID()}`;
  const sourceA = (await client.query('INSERT INTO tasks(title,payload) VALUES ($1,$2) RETURNING id', [`source A ${randomUUID()}`, { repo: 'cecelia', map_scope: ['F1'] }])).rows[0].id;
  const first = await learning.recordLearning({ task_id: sourceA, analysis: { root_cause: cause }, confidence: .9, learnings: ['first'], recommended_actions: [] });
  const sourceB = (await client.query('INSERT INTO tasks(title,payload) VALUES ($1,$2) RETURNING id', [`source B ${randomUUID()}`, { repo, map_scope: mapScope }])).rows[0].id;
  const analysis = { task_id: sourceB, analysis: { root_cause: cause }, confidence: .9, learnings: ['second'], recommended_actions: [] };
  const second = await learning.recordLearning(analysis);
  expect(second.id).not.toBe(first.id);
  const secondRow = (await client.query('SELECT applied,metadata FROM learnings WHERE id=$1', [second.id])).rows[0];
  const tasks = (await client.query("SELECT id,payload FROM tasks WHERE payload->>'insight_learning_id'=$1", [second.id])).rows;
  if (reason) {
    expect(secondRow).toMatchObject({ applied: false, metadata: { insight_task_status: 'blocked', insight_task_reason: reason } });
    expect(tasks).toHaveLength(0);
  } else {
    expect(secondRow.applied).toBe(true);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].payload).toMatchObject({ insight_learning_id: second.id, repo, map_scope: mapScope });
    expect((await client.query('SELECT repo,map_scope FROM work_routing_receipts WHERE task_id=$1', [tasks[0].id])).rows).toEqual([{ repo, map_scope: mapScope }]);
    // 同一分析重放仍只对应一条修复任务。
    expect((await learning.recordLearning(analysis)).id).toBe(second.id);
    expect((await client.query("SELECT id FROM tasks WHERE payload->>'insight_learning_id'=$1", [second.id])).rows).toHaveLength(1);
  }
});
