/**
 * 测试数据库辅助函数
 * 使用隔离的测试 schema 避免污染生产数据
 */

import pgPromise from 'pg-promise';

const pgp = pgPromise();

const TEST_DB_URL = process.env.TEST_DATABASE_URL ||
  'postgresql://cecelia:cecelia@localhost:5432/cecelia_test';

export async function createTestDb() {
  const db = pgp(TEST_DB_URL);

  // 建立测试所需的表结构（如不存在）
  await db.none(`
    CREATE TABLE IF NOT EXISTS skill_eval_tasks (
      task_id        TEXT PRIMARY KEY,
      zip_hash       TEXT NOT NULL,
      skill_name     TEXT NOT NULL,
      platform       TEXT DEFAULT 'unknown',
      submitter      TEXT,
      status         TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','completed','failed')),
      failure_reason TEXT,
      report_url     TEXT,
      container_id   TEXT,
      pending_reason TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at     TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  return db;
}

export async function cleanupTestDb(db) {
  await db.none('TRUNCATE TABLE skill_eval_tasks CASCADE');
  pgp.end();
}
