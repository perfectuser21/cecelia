/**
 * 生产 boot 顺序测试（C1）：先 DBOS.launch() 再驱动 routeDailyReport，锁 ordering。
 *
 * 复现并防回归：daily-report-durable 的 registerStep/registerWorkflow 必须在 launch 之前发生。
 * 若它仅靠 router 的 lazy import() 在 launch 后首次加载 → DBOSConflictingRegistrationError。
 *
 * 需真 Postgres（TEST_PG=1 守卫）。子进程 prod-ordering-runner.mjs 忠实复现生产入口顺序。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const RUN = process.env.TEST_PG === '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(__dirname, 'prod-ordering-runner.mjs');

const ADMIN_URL = process.env.TEST_ADMIN_URL || 'postgresql://cecelia:cecelia@localhost:5432/postgres';
const TEST_DB = 'dbos_prod_ordering_test';
const TEST_DB_URL = `postgresql://cecelia:cecelia@localhost:5432/${TEST_DB}`;

function runRunner() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], {
      env: { ...process.env, TEST_DB_URL, NODE_OPTIONS: '--max-old-space-size=2048' },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code));
  });
}

describe.skipIf(!RUN)('生产 boot 顺序：launch 后驱动 route 不抛 ConflictingRegistration', () => {
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    const db = new pg.Client({ connectionString: TEST_DB_URL });
    await db.connect();
    await db.query(`CREATE SCHEMA IF NOT EXISTS dbos`);
    await db.query(`
      CREATE TABLE tasks (id text, task_type text, status text, payload jsonb, completed_at timestamptz, created_at timestamptz);
      CREATE TABLE content_publish_jobs (platform text, status text, created_at timestamptz);
      CREATE TABLE working_memory (key text PRIMARY KEY, value_json jsonb, updated_at timestamptz);
    `);
    await db.end();
  }, 60_000);

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('launch 后首次驱动 durable route → 0 退出（注册早于 launch）', async () => {
    const code = await runRunner();
    expect(code).toBe(0);
  }, 90_000);
});
