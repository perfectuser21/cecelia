import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
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
it.each([
  ['cecelia', ['F1']], ['zenithjoy-workspace', ['F1']],
  ['missing-repository', ['F1']], ['cecelia', ['missing-scope']],
])('高置信RCA保留真实学习和记忆，无自动开发记录 %s %j', async (repo, mapScope) => {
  const source = (await client.query('INSERT INTO tasks(title,payload) VALUES ($1,$2) RETURNING id', [`source ${randomUUID()}`, { repo, map_scope: mapScope }])).rows[0];
  const analysis = { task_id: source.id, analysis: { root_cause: `record ${randomUUID()}` }, confidence: .99, learnings: [], recommended_actions: [] };
  const result = await learning.recordLearning(analysis);
  expect((await client.query('SELECT applied,source_memory_id,task_id FROM learnings WHERE id=$1', [result.id])).rows[0])
    .toMatchObject({ applied: false, source_memory_id: result.source_memory_id, task_id: source.id });
  expect((await client.query('SELECT id FROM memory_stream WHERE id=$1', [result.source_memory_id])).rows).toHaveLength(1);
  expect((await client.query("SELECT id FROM tasks WHERE payload->>'insight_learning_id'=$1", [result.id])).rows).toHaveLength(0);
  expect((await learning.recordLearning(analysis)).id).toBe(result.id);
  expect((await client.query("SELECT id FROM tasks WHERE payload->>'insight_learning_id'=$1", [result.id])).rows).toHaveLength(0);
});
