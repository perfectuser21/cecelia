import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
vi.mock('../../openai-client.js', () => ({ generateEmbedding: vi.fn(() => { throw new Error('external embedding forbidden'); }) }));
vi.mock('../../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(() => { throw new Error('external model forbidden'); }) }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => client.query(...args) } }));
let client;
let learning;
beforeAll(async () => {
  if (process.env.DB_NAME !== 'cecelia_scratch' || process.env.DB_HOST !== '127.0.0.1' || !process.env.DB_PORT || process.env.DB_PORT === '5432') throw new Error('explicit private scratch required');
  client = new pg.Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME });
  await client.connect();
  const { rows: [identity] } = await client.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  expect(identity).toEqual({ db: 'cecelia_scratch', host: '127.0.0.1', port: +process.env.DB_PORT });
  learning = await import('../../learning.js');
});
afterAll(async () => { await client?.end(); });
it('最小旧schema迁移幂等保全key/value与既有metadata', async () => {
  const migration = readFileSync(new URL('../../../migrations/557_brain_config_metadata.sql', import.meta.url), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query('CREATE TEMP TABLE brain_config(key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())');
    await client.query("INSERT INTO brain_config(key,value) VALUES ('legacy','0.9')");
    await client.query(migration);
    expect((await client.query("SELECT key,value,metadata FROM brain_config WHERE key='legacy'")).rows[0]).toEqual({ key: 'legacy', value: '0.9', metadata: {} });
    await client.query(`UPDATE brain_config SET metadata='{"previous_audit":"preserved"}'`);
    await client.query(migration);
    expect((await client.query('SELECT metadata FROM brain_config')).rows[0].metadata).toEqual({ previous_audit: 'preserved' });
  } finally { await client.query('ROLLBACK'); }
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
  const sourceId = (await client.query(`INSERT INTO tasks(title,payload) VALUES ('source', '{"repo":"cecelia","map_scope":["F1"]}') RETURNING id`)).rows[0].id;
  const result = await learning.recordLearning({ task_id: sourceId, analysis: { root_cause: `routing ${randomUUID()}` }, confidence: .9, learnings: [], recommended_actions: [] });
  const { rows } = await client.query("SELECT id,task_type,payload FROM tasks WHERE payload->>'insight_learning_id'=$1", [result.id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].task_type).toBe('coding_workflow');
  expect(rows[0].payload).toMatchObject({ repo: 'cecelia', map_scope: ['F1'], change_kind: 'bugfix' });
  expect((await client.query('SELECT repo,map_scope FROM work_routing_receipts WHERE task_id=$1', [rows[0].id])).rows).toEqual([{ repo: 'cecelia', map_scope: ['F1'] }]);
  const unknownId = (await client.query("INSERT INTO tasks(title) VALUES ('unknown') RETURNING id")).rows[0].id;
  const blocked = await learning.recordLearning({ task_id: unknownId, analysis: { root_cause: `unknown ${randomUUID()}` }, confidence: .9, learnings: [], recommended_actions: [] });
  expect((await client.query('SELECT applied,metadata FROM learnings WHERE id=$1', [blocked.id])).rows[0]).toMatchObject({ applied: false, metadata: { insight_task_status: 'blocked', insight_task_reason: 'source_route_context_missing' } });
  expect((await client.query("SELECT id FROM tasks WHERE payload->>'insight_learning_id'=$1", [blocked.id])).rows).toHaveLength(0);
});
