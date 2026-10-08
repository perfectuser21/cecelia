// 真 PG：迁移 535 + 认领端点对 coding-workflow-runner 强制写 kind（覆盖历史 headed-session 残留），
// 其他 kind 保持 COALESCE；rollback 535 去掉该 kind 且保留原有约束。
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

const state = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => state.pool.query(...args) } }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: () => ({ domain: 'growth' }) }));
vi.mock('../../task-updater.js', () => ({ blockTask: vi.fn() }));

const options = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : DB_DEFAULTS;
const database = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) : DB_DEFAULTS.database;
if (database !== 'cecelia_scratch' && !(process.env.CI && database === 'cecelia_test')) throw Error('local scratch only');
const schema = `cw_runner_claim_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client(options);
const pool = new pg.Pool({ ...options, options: `-c search_path=${schema}` });
state.pool = pool;
const sql = (rel) => readFileSync(new URL(`../../../migrations/${rel}`, import.meta.url), 'utf8');
let claim;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE tasks(id UUID PRIMARY KEY, claimed_by TEXT, claimed_at TIMESTAMPTZ,
    executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK (executor_kind IN ('headed-session','brain-local')))`);
  await pool.query(sql('535_coding_workflow_runner_executor_kind.sql'));
  const { default: router } = await import('../../routes/task-tasks.js');
  claim = router.stack.find((l) => l.route?.path === '/:id/claim' && l.route.methods.post).route.stack[0].handle;
});

afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function claimAs(id, body) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await claim({ params: { id }, body }, res);
  return res;
}

const kindOf = async (id) => (await pool.query('SELECT executor_kind FROM tasks WHERE id=$1', [id])).rows[0].executor_kind;

it('预置 headed-session 的 queued 任务被 coding-workflow-runner 认领后 kind 变为 coding-workflow-runner', async () => {
  const id = randomUUID();
  await pool.query("INSERT INTO tasks(id, executor_kind) VALUES($1, 'headed-session')", [id]);
  const res = await claimAs(id, { claimer: 'coding-workflow-runner@h', executor_kind: 'coding-workflow-runner' });
  expect(res.code).toBe(200);
  expect(res.body.executor_kind).toBe('coding-workflow-runner');
  expect(await kindOf(id)).toBe('coding-workflow-runner');
});

it('其他 kind 认领行为不变：已有 kind 不覆盖，空 kind 写入请求值或缺省 headed-session', async () => {
  const kept = randomUUID();
  const filled = randomUUID();
  const defaulted = randomUUID();
  await pool.query("INSERT INTO tasks(id, executor_kind) VALUES($1, 'headed-session'), ($2, NULL), ($3, NULL)", [kept, filled, defaulted]);
  await claimAs(kept, { claimer: 'r', executor_kind: 'brain-local' });
  await claimAs(filled, { claimer: 'r', executor_kind: 'brain-local' });
  await claimAs(defaulted, { claimer: 'r' });
  expect(await kindOf(kept)).toBe('headed-session');
  expect(await kindOf(filled)).toBe('brain-local');
  expect(await kindOf(defaulted)).toBe('headed-session');
});

it('rollback 535：coding-workflow-runner 行回落 headed-session，约束去掉该 kind、保留原有值', async () => {
  await pool.query(sql('rollback/535_coding_workflow_runner_executor_kind.down.sql'));
  await expect(pool.query("INSERT INTO tasks(id, executor_kind) VALUES($1, 'coding-workflow-runner')", [randomUUID()]))
    .rejects.toThrow('tasks_executor_kind_check');
  await pool.query("INSERT INTO tasks(id, executor_kind) VALUES($1, 'brain-local')", [randomUUID()]);
  const left = await pool.query("SELECT count(*)::int AS n FROM tasks WHERE executor_kind = 'coding-workflow-runner'");
  expect(left.rows[0].n).toBe(0);
});
