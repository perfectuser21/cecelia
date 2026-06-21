/**
 * daily-report-durable 崩溃恢复 + exactly-once 测试。
 *
 * 需真 Postgres：用 TEST_PG=1 守卫（CI 无 DB 时整组 skip，本地带 TEST_PG 验真）。
 * 形态固化自已验证 spike（/tmp/cecelia-orchestrator-spike/daily-report-durable.ts）：
 *   - step_trace 计数证 recover 后已完成 step 不重跑
 *   - feishu_sends 计数=1 证副作用 exactly-once
 *
 * 流程：
 *   1. 建测试库 dbos_durable_test（cecelia 业务表骨架 + step_trace + feishu_sends + dbos schema）
 *   2. spawn MODE=start：跑到 saveReport 前经 beforeSave seam process.exit137（I1：注入而非烤进 step）
 *   3. spawn MODE=recover：DBOS.launch 自动恢复，从断点续，跑完 save+feishu
 *   4. 断言：generateReport 仅 trace 1 次（不重跑）；feishu_sends 恰好 1 行
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const RUN = process.env.TEST_PG === '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(__dirname, 'durable-runner.mjs');

const ADMIN_URL =
  process.env.TEST_ADMIN_URL || 'postgresql://cecelia:cecelia@localhost:5432/postgres';
const TEST_DB = 'dbos_durable_test';
const TEST_DB_URL =
  process.env.TEST_DB_URL ||
  `postgresql://cecelia:cecelia@localhost:5432/${TEST_DB}`;
const WF_ID = `durable-daily-report-${Date.now()}`;

function runRunner(mode, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], {
      env: {
        ...process.env,
        MODE: mode,
        WF_ID,
        TEST_DB_URL,
        NODE_OPTIONS: '--max-old-space-size=2048',
        ...extraEnv,
      },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code));
  });
}

describe.skipIf(!RUN)('daily-report durable 崩溃恢复 + exactly-once', () => {
  beforeAll(async () => {
    // 1. (重)建测试库
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();

    // 2. 建表：cecelia 业务表骨架（step 函数查询用）+ trace/feishu 计数表 + dbos schema
    const db = new pg.Client({ connectionString: TEST_DB_URL });
    await db.connect();
    await db.query(`CREATE SCHEMA IF NOT EXISTS dbos`);
    await db.query(`
      CREATE TABLE tasks (
        id text, task_type text, status text, payload jsonb,
        completed_at timestamptz, created_at timestamptz
      );
      CREATE TABLE content_publish_jobs (
        platform text, status text, created_at timestamptz
      );
      CREATE TABLE working_memory (
        key text PRIMARY KEY, value_json jsonb, updated_at timestamptz
      );
      CREATE TABLE step_trace (
        id serial PRIMARY KEY, step text, pid int, at timestamptz DEFAULT now()
      );
      CREATE TABLE feishu_sends (
        id serial PRIMARY KEY, pid int, note text, at timestamptz DEFAULT now()
      );
    `);
    await db.end();
  }, 60_000);

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('崩溃 recover 后 step 不重跑 + 飞书 exactly-once', async () => {
    // 阶段1：start + 崩溃（beforeSave seam 在 saveReport 前 exit137）
    const startCode = await runRunner('start');
    expect(startCode).toBe(137); // 确认确实崩溃在 save 前

    const db = new pg.Client({ connectionString: TEST_DB_URL });
    await db.connect();

    // 崩溃时：fetch×4 + generate 已执行（trace 各 1），save/feishu 未执行
    const genBefore = (await db.query(`SELECT COUNT(*)::int c FROM step_trace WHERE step='generateReport'`)).rows[0].c;
    const feishuBefore = (await db.query(`SELECT COUNT(*)::int c FROM feishu_sends`)).rows[0].c;
    expect(genBefore).toBe(1);
    expect(feishuBefore).toBe(0);

    // 阶段2：recover（不再崩溃）→ 从断点续，跑完 save+feishu
    const recoverCode = await runRunner('recover');
    expect(recoverCode).toBe(0);

    // 断言①：generateReport step body 仍只执行过 1 次（recover 不重跑已完成 step）
    const genAfter = (await db.query(`SELECT COUNT(*)::int c FROM step_trace WHERE step='generateReport'`)).rows[0].c;
    expect(genAfter).toBe(1);

    // 断言②：feishu 副作用 exactly-once（恢复后恰好补发 1 次，全程 1 行）
    const feishuAfter = (await db.query(`SELECT COUNT(*)::int c FROM feishu_sends`)).rows[0].c;
    expect(feishuAfter).toBe(1);

    await db.end();
  }, 90_000);
});
