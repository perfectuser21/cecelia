import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_DEFAULTS } from '../../db-config.js';

/**
 * 统一领单租约 + 设备池（任务 c5f6e683）的私有 PG fixture：独立 schema，只建用到的表，
 * 真跑 065/448/490/553 四个迁移（553 的 SQL 形状随测试一起被钉住）。不跑全量 migrate、不写 public。
 */
export async function taskLeaseFixture() {
  if (DB_DEFAULTS.database !== 'cecelia_scratch' && !(process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) {
    throw Error('local scratch / exact CI test only');
  }
  const schema = 'task_lease_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client(DB_DEFAULTS);
  const pool = new pg.Pool({ ...DB_DEFAULTS, max: 8, options: `-c search_path=${schema} -c statement_timeout=3000` });
  await admin.connect();
  if ((await admin.query('SELECT current_database() AS db')).rows[0].db !== DB_DEFAULTS.database) throw Error('database identity mismatch');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const close = async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); };
  try {
    await pool.query(`CREATE TABLE tasks(
        id UUID PRIMARY KEY, title TEXT, status TEXT DEFAULT 'queued', task_type TEXT DEFAULT 'data',
        executor_kind TEXT, claimed_by TEXT, claimed_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT now(), retry_count INT DEFAULT 0, max_retries INT DEFAULT 3,
        error_message TEXT, payload JSONB DEFAULT '{}', result JSONB, metadata JSONB, custom_props JSONB,
        summary TEXT, assigned_to TEXT, priority TEXT, pr_url TEXT, pr_status TEXT, pr_merged_at TIMESTAMPTZ, blocked_detail JSONB);
      CREATE TABLE schema_version(version TEXT PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE task_events(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID, event_type TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT now());`);
    for (const name of ['065_device_locks.sql', '448_device_locks_phones.sql', '490_phone_registry.sql', '553_task_leases_device_pools.sql']) {
      await pool.query(readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8'));
    }
    return { pool, schema, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function seedTask(pool, fields = {}) {
  const id = fields.id ?? randomUUID();
  const f = { status: 'queued', task_type: 'data', executor_kind: null, claimed_by: null, retry_count: 0, max_retries: 3, payload: {}, ...fields };
  await pool.query(
    `INSERT INTO tasks (id, title, status, task_type, executor_kind, claimed_by, claimed_at, retry_count, max_retries, payload, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END, $7, $8, $9::jsonb,
             CASE WHEN $3 = 'in_progress' THEN NOW() ELSE NULL END)`,
    [id, `lease test ${id}`, f.status, f.task_type, f.executor_kind, f.claimed_by, f.retry_count, f.max_retries, JSON.stringify(f.payload)],
  );
  return id;
}
