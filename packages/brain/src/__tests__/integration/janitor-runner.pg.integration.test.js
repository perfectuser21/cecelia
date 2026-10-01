import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJanitor } from '../../janitor.js';
import { DB_DEFAULTS } from '../../db-config.js';

const options = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : DB_DEFAULTS;
const database = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) : DB_DEFAULTS.database;
if (!/_(scratch|test)$/.test(database)) throw new Error('isolated scratch/test database required');
const schema = `janitor_runner_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const pool = new pg.Pool({ ...options, max: 5, options: `-c search_path=${schema},public` });
const admin = new pg.Client(options);
const id = 'owned-cache';
const actor = 'janitor-fixture';
const gate = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
function service(run) { return createJanitor([{ JOB_ID: id, JOB_NAME: '专属缓存', run }]); }
async function enable(api) { await api.setJobConfig(pool, id, { enabled: true }); }
async function recordAction() {
  await pool.query('INSERT INTO action_evidence(actor) VALUES($1)', [actor]);
  return { status: 'success', freed_bytes: 0 };
}
async function actionCount() { return Number((await pool.query('SELECT count(*) FROM action_evidence')).rows[0].count); }

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(readFileSync(new URL('../../../migrations/272_janitor.sql', import.meta.url), 'utf8'));
  await pool.query('CREATE TABLE action_evidence(actor TEXT NOT NULL)');
});
beforeEach(async () => {
  await pool.query('TRUNCATE janitor_runs,janitor_config,action_evidence');
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe('Janitor 真实数据库受控执行', () => {
  it('未配置和停用均无动作、无running，明确启用后才写真实动作及终态', async () => {
    const api = service(recordAction);
    await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_DISABLED' });
    await api.setJobConfig(pool, id, { enabled: false });
    await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_DISABLED' });
    expect(await actionCount()).toBe(0);
    expect((await pool.query('SELECT * FROM janitor_runs')).rows).toHaveLength(0);
    await enable(api);
    const result = await api.runJob(pool, id);
    expect(await actionCount()).toBe(1);
    const { rows: [receipt] } = await pool.query('SELECT * FROM janitor_runs WHERE id=$1', [result.run_id]);
    expect(receipt.status).toBe('success');
    expect(receipt.finished_at).not.toBeNull();
  });

  it('并发第二次执行与修改配置都不能越过同一个锁', async () => {
    const entered = gate(); const release = gate();
    const api = service(async () => { entered.resolve(); await release.promise; return recordAction(); });
    await enable(api);
    const first = api.runJob(pool, id);
    await entered.promise;
    try {
      await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_BUSY' });
      await expect(api.setJobConfig(pool, id, { enabled: false })).rejects.toMatchObject({ code: 'JANITOR_BUSY' });
    } finally { release.resolve(); }
    await first;
    expect(await actionCount()).toBe(1);
    await api.setJobConfig(pool, id, { enabled: false });
  });

  it('异常持久固定失败码，不将凭据或堆栈写入回执', async () => {
    const api = service(async () => { throw new Error('private-secret'); });
    await enable(api);
    await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_ACTION_FAILED' });
    const { rows: [receipt] } = await pool.query('SELECT * FROM janitor_runs');
    expect(receipt.status).toBe('failed');
    expect(receipt.output).toBe('JANITOR_ACTION_FAILED');
    expect(receipt.finished_at).not.toBeNull();
  });

  it('终态写入失败保留running，重试不重复动作', async () => {
    const api = service(recordAction);
    await enable(api);
    await pool.query(`CREATE FUNCTION reject_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture-write-failure'; END $$;
      CREATE TRIGGER reject_terminal BEFORE UPDATE ON janitor_runs FOR EACH ROW EXECUTE FUNCTION reject_terminal()`);
    try {
      await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
      expect(await actionCount()).toBe(1);
      expect((await pool.query('SELECT status FROM janitor_runs')).rows[0].status).toBe('running');
      await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
      expect(await actionCount()).toBe(1);
    } finally { await pool.query('DROP TRIGGER reject_terminal ON janitor_runs; DROP FUNCTION reject_terminal()'); }
  });

  it('专属连接真实断开后保留不确定状态，后续调用仍拒绝动作', async () => {
    const entered = gate(); const release = gate();
    let aborted;
    const api = service(async ({ signal }) => {
      aborted = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      entered.resolve(); await release.promise; return { status: 'success' };
    });
    await enable(api);
    let acquired;
    const trackingPool = { connect: async () => { acquired = await pool.connect(); return acquired; } };
    const first = api.runJob(trackingPool, id);
    // Attach rejection immediately so connection termination cannot become unhandled.
    const rejected = expect(first).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
    await entered.promise;
    await admin.query('SELECT pg_terminate_backend($1)', [acquired.processID]);
    await aborted;
    release.resolve();
    await rejected;
    await expect(api.runJob(pool, id)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
    expect((await pool.query('SELECT status FROM janitor_runs')).rows[0].status).toBe('running');
    expect(await actionCount()).toBe(0);
  });
});
