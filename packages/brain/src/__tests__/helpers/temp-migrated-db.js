/**
 * temp-migrated-db.js —— 真 PG 集成测试的临时库助手：建库 → 跑全量 migrate.js → 用完即删。
 *
 * 只连本机/CI 的 PG 服务器，永远新建一个随机名临时库，绝不碰共享库（cecelia_test）或生产库。
 * 手法照 task-kind-column.pg.integration.test.js，抽成助手供 executor=script 的两份集成测试共用。
 *
 * 用法：
 *   const db = await createTempMigratedDb('scriptexec');
 *   db.pool.query(...);
 *   await db.drop();
 *
 * 需要让被测模块（dispatcher / executor 等直接 import db.js 的默认池）也连到临时库时，
 * 在 import 它们之前 `process.env.DB_NAME = db.name`（db-config 在 import 时读 env）。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export async function createTempMigratedDb(prefix = 'tmpdb') {
  if (!/^[a-z][a-z0-9]{1,15}$/.test(prefix)) throw new Error('unsafe temp db prefix');
  const name = `${prefix}_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${name}"`;
  const adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoted}`);
  try {
    execFileSync(process.execPath, ['src/migrate.js'], {
      cwd: BRAIN_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_HOST: DB_DEFAULTS.host,
        DB_PORT: String(DB_DEFAULTS.port),
        DB_USER: DB_DEFAULTS.user,
        DB_PASSWORD: DB_DEFAULTS.password,
        DB_NAME: name,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoted}`).catch(() => {});
    await adminPool.end().catch(() => {});
    throw err;
  }
  const pool = new Pool({ ...DB_DEFAULTS, database: name, max: 6 });
  return {
    name,
    pool,
    async drop() {
      await pool.end().catch(() => {});
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`).catch(() => {});
      await adminPool.end().catch(() => {});
    },
  };
}
