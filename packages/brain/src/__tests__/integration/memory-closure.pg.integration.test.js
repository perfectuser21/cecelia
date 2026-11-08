import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const boundary = vi.hoisted(() => ({ forbidden: [],
  deny(kind) { this.forbidden.push(kind); throw Error('forbidden ' + kind); },
}));
vi.mock('../../db.js', () => ({ default: { query: () => boundary.deny('canonical DB') } }));
vi.mock('../../llm-caller.js', () => ({ callLLM: () => boundary.deny('LLM') }));
import { resolveRelatedFailureMemories } from '../../routes/shared.js';

let db, schema;
const taskId = '11111111-1111-4111-8111-111111111111';
const oldTaskId = '99999999-9999-4999-8999-999999999999';
beforeAll(async () => {
  const local = DB_DEFAULTS.database === 'cecelia_scratch'
    && DB_DEFAULTS.host === '127.0.0.1' && DB_DEFAULTS.port !== 5432
    && /^\/tmp\/cimc-[a-zA-Z0-9_-]+\/data$/.test(process.env.MEMORY_CLOSURE_PGDATA || '');
  const ci = process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true'
    && ['cecelia_test', 'cecelia_scratch'].includes(DB_DEFAULTS.database)
    && ['localhost', '127.0.0.1'].includes(DB_DEFAULTS.host) && DB_DEFAULTS.port === 5432;
  if (process.env.POSTGRES_INTEGRATION !== '1' || !(local || ci)) {
    throw Error('memory closure requires explicit owned scratch or isolated GitHub CI PG');
  }
  if (local) {
    const marker = JSON.parse(await readFile(path.join(process.env.MEMORY_CLOSURE_PGDATA, '../owner.json'), 'utf8'));
    expect(marker.owner).toBe('memory-closure-regression');
  }
  db = new pg.Client({ ...DB_DEFAULTS, statement_timeout: 5000 });
  await db.connect();
  expect((await db.query('SELECT current_database() AS db')).rows[0].db).toBe(DB_DEFAULTS.database);
  if (local) {
    const actual = (await db.query("SELECT current_setting('data_directory') AS dir,current_setting('listen_addresses') AS listen")).rows[0];
    expect(await realpath(actual.dir)).toBe(await realpath(process.env.MEMORY_CLOSURE_PGDATA));
    expect(actual.listen).toBe('127.0.0.1');
  }
  schema = `memory_closure_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await db.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text);
    CREATE TABLE memory_stream(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now());
    CREATE TABLE learnings(id uuid PRIMARY KEY,title text,content text,category text,archived boolean DEFAULT false);`);
  // Apply the real column types/FK from the closure migration to the private minimal tables.
  const migration = await readFile(new URL('../../../migrations/090_memory_closure_chain.sql', import.meta.url), 'utf8');
  await db.query(migration);
  vi.stubGlobal('fetch', () => boundary.deny('fetch'));
});
beforeEach(async () => {
  boundary.forbidden.length = 0;
  await db.query('TRUNCATE learnings,memory_stream,tasks');
  await db.query("INSERT INTO tasks VALUES($1,'fix watchdog memory leak')", [taskId]);
});
afterEach(() => expect(boundary.forbidden).toEqual([]));
afterAll(async () => {
  try { if (db && schema) await db.query(`DROP SCHEMA ${schema} CASCADE`); }
  finally { if (db) await db.end(); vi.unstubAllGlobals(); }
});
async function memory({ title = 'watchdog incident', content = '', category = 'failure_pattern',
  archived = false, status = 'active' } = {}) {
  const id = randomUUID();
  await db.query('INSERT INTO memory_stream(id,status,resolved_by_task_id) VALUES($1,$2,$3)',
    [id, status, status === 'resolved' ? oldTaskId : null]);
  await db.query('INSERT INTO learnings(id,title,content,category,archived,source_memory_id) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), title, content, category, archived, id]);
  return id;
}
async function state(id) {
  return (await db.query('SELECT status,resolved_by_task_id,resolved_at FROM memory_stream WHERE id=$1', [id])).rows[0];
}
it('real SELECT/UPDATE resolve multiple title/content matches and preserve nonmatches/filters', async () => {
  const titleMatch = await memory();
  const contentMatch = await memory({ title: 'other incident', content: 'memory pressure' });
  const untouched = [await memory({ title: 'unrelated' }), await memory({ archived: true }),
    await memory({ category: 'best_practice' })];
  const resolved = await memory({ status: 'resolved' });
  await expect(resolveRelatedFailureMemories(taskId, db)).resolves.toBeUndefined();
  for (const id of [titleMatch, contentMatch]) {
    expect(await state(id)).toEqual({ status: 'resolved', resolved_by_task_id: taskId,
      resolved_at: expect.any(Date) });
  }
  for (const id of untouched) expect(await state(id)).toEqual({ status: 'active', resolved_by_task_id: null, resolved_at: null });
  expect(await state(resolved)).toEqual({ status: 'resolved', resolved_by_task_id: oldTaskId, resolved_at: null });
});
it('no matching learning is a real SQL no-op', async () => {
  const id = await memory({ title: 'unrelated' });
  await expect(resolveRelatedFailureMemories(taskId, db)).resolves.toBeUndefined();
  expect((await state(id)).status).toBe('active');
});
it('missing task is a no-op', async () => {
  const id = await memory();
  await expect(resolveRelatedFailureMemories(randomUUID(), db)).resolves.toBeUndefined();
  expect((await state(id)).status).toBe('active');
});
it('stopwords-only title is a no-op', async () => {
  const id = await memory();
  await db.query("UPDATE tasks SET title='fix the a an' WHERE id=$1", [taskId]);
  await expect(resolveRelatedFailureMemories(taskId, db)).resolves.toBeUndefined();
  expect((await state(id)).status).toBe('active');
});
it('actual PG UPDATE error rejects without resolving any memory', async () => {
  const id = await memory();
  await db.query(`CREATE FUNCTION reject_closure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned closure rejection'; END $$;
    CREATE TRIGGER reject_closure BEFORE UPDATE ON memory_stream FOR EACH ROW EXECUTE FUNCTION reject_closure();`);
  try {
    await expect(resolveRelatedFailureMemories(taskId, db)).rejects.toMatchObject({ code: 'P0001' });
    expect(await state(id)).toEqual({ status: 'active', resolved_by_task_id: null, resolved_at: null });
  } finally {
    await db.query('DROP TRIGGER reject_closure ON memory_stream; DROP FUNCTION reject_closure()');
  }
});
