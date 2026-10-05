/**
 * Migration 492 steps / enablers / enabler_calls + sync-steps-from-workspace（真 PostgreSQL）。
 *
 * 决策 3e867cad（13 张表）第一批：Step 进 Brain、Enabler 注册表、活动↔使能件调用关系。
 * 真身在 zenithjoy-workspace 的 step-dod.json（43 步），本仓 fixture 是其快照；Brain 只做投影。
 * 每个用例独立 schema，只建迁移依赖的最小 journey_steps / schema_version，不碰 public。
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { parseStepDod, syncSteps } from '../../../scripts/sync-steps-from-workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '../../../migrations/492_steps_enablers.sql'),
  'utf8'
);
const fixturePath = path.resolve(__dirname, '../fixtures/step-dod.keyword-acquisition.json');
const fixtureJson = fs.readFileSync(fixturePath, 'utf8');

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(
    `migration 492 integration test requires a test database, got ${DB_DEFAULTS.database}`
  );
}

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
let client;
let schemaName;

const ACTIVITIES = [
  'preflight', 'discovery', 'qualification', 'collection',
  'scoring', 'delivery', 'outreach', 'cleanup',
];

function q(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function createParentTables() {
  await client.query(`
    CREATE TABLE schema_version (version VARCHAR(10) PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE journey_steps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      journey_id UUID NOT NULL,
      name TEXT NOT NULL,
      step_number INT NOT NULL,
      backbone_version TEXT NOT NULL DEFAULT '1.0',
      capability_key TEXT,
      activity_key TEXT
    );
  `);
}

async function seedActivities({ withBackboneV2Shadow = false } = {}) {
  const journeyId = randomUUID();
  for (const [i, key] of ACTIVITIES.entries()) {
    await client.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, backbone_version, capability_key, activity_key)
       VALUES ($1, $2, $3, '3.0', 'keyword_acquisition', $4)`,
      [journeyId, key, i + 1, key]
    );
  }
  if (withBackboneV2Shadow) {
    // 旧骨干版本同名活动：sync 必须挑最新 backbone_version，不能挂到旧格子
    await client.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, backbone_version, capability_key, activity_key)
       VALUES ($1, 'collection-old', 99, '2.0', 'keyword_acquisition', 'collection')`,
      [journeyId]
    );
  }
  return journeyId;
}

afterAll(async () => {
  await pool.end();
});

async function runMigration() {
  await client.query('BEGIN');
  try {
    await client.query(migrationSql);
    // 492 按旧名 journey_steps 建外键；重放后对齐生产形状（522 起 activities 是物理表，旧名是视图），sync 脚本读标准名
    // 重放幂等：第二次 journey_steps 已是视图，不再换名。
    const kind = (await client.query("SELECT relkind FROM pg_class WHERE relname = 'journey_steps' AND relnamespace = current_schema()::regnamespace")).rows[0]?.relkind;
    if (kind === 'r') {
      await client.query('ALTER TABLE journey_steps RENAME TO activities');
      await client.query('CREATE VIEW journey_steps AS SELECT * FROM activities');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe('migration 492 — steps / enablers / enabler_calls', () => {
  beforeEach(async () => {
    schemaName = `migration_492_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`SET search_path TO ${q(schemaName)}, public`);
    await createParentTables();
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
    client.release();
  });

  it('建三表 + 写 schema_version 492，重放幂等', async () => {
    await seedActivities();
    await runMigration();
    await runMigration();
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name IN ('steps','enablers','enabler_calls')
        ORDER BY table_name`,
      [schemaName]
    );
    expect(rows.map((r) => r.table_name)).toEqual(['enabler_calls', 'enablers', 'steps']);
    const ver = await client.query(`SELECT version FROM schema_version WHERE version = '492'`);
    expect(ver.rowCount).toBe(1);
  });

  it('种子 enabler return_to_results 并挂到 collection 活动，重放不翻倍', async () => {
    await seedActivities();
    await runMigration();
    await runMigration();
    const en = await client.query(`SELECT key, name, kind, impl_ref FROM enablers WHERE key = 'return_to_results'`);
    expect(en.rowCount).toBe(1);
    expect(en.rows[0].kind).toBe('code');
    expect(en.rows[0].impl_ref).toContain('back_to_results');
    const calls = await client.query(
      `SELECT c.caller_type, js.activity_key
         FROM enabler_calls c
         JOIN enablers e ON e.id = c.enabler_id
         JOIN journey_steps js ON js.id = c.caller_id
        WHERE e.key = 'return_to_results'`
    );
    expect(calls.rows).toEqual([{ caller_type: 'activity', activity_key: 'collection' }]);
  });

  it('enablers.kind 与 enabler_calls.caller_type 受 CHECK 约束', async () => {
    await seedActivities();
    await runMigration();
    await expect(
      client.query(`INSERT INTO enablers (key, name, kind) VALUES ('x', 'x', 'human')`)
    ).rejects.toThrow(/enablers_kind_check/);
    const en = await client.query(`SELECT id FROM enablers WHERE key = 'return_to_results'`);
    await expect(
      client.query(
        `INSERT INTO enabler_calls (caller_type, caller_id, enabler_id) VALUES ('workflow', $1, $2)`,
        [randomUUID(), en.rows[0].id]
      )
    ).rejects.toThrow(/enabler_calls_caller_type_check/);
  });
});

describe('sync-steps-from-workspace — 43 步投影', () => {
  beforeEach(async () => {
    schemaName = `sync_steps_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`SET search_path TO ${q(schemaName)}, public`);
    await createParentTables();
  });

  afterEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
    client.release();
  });

  it('parseStepDod：43 步、capability=keyword_acquisition、每步带 activity 与 key', () => {
    const spec = parseStepDod(fixtureJson);
    expect(spec.capability).toBe('keyword_acquisition');
    expect(spec.steps).toHaveLength(43);
    for (const s of spec.steps) {
      expect(s.key).toMatch(/^keyword_acquisition\./);
      expect(ACTIVITIES).toContain(s.activity);
    }
  });

  it('43 步全部落库并挂到 8 个活动之一，顺序按契约内序号', async () => {
    await seedActivities();
    await runMigration();
    const spec = parseStepDod(fixtureJson);
    const result = await syncSteps(client, spec);
    expect(result).toMatchObject({ inserted: 43, updated: 0, total: 43 });
    const { rows } = await client.query(
      `SELECT s.key, s.step_order, s.activity_key, js.activity_key AS parent_activity
         FROM steps s JOIN journey_steps js ON js.id = s.activity_id
        ORDER BY s.step_order`
    );
    expect(rows).toHaveLength(43);
    expect(rows[0].key).toBe('keyword_acquisition.preflight.acquire_device_lock');
    expect(rows[42].key).toBe('keyword_acquisition.cleanup.finalize_run');
    for (const r of rows) expect(r.activity_key).toBe(r.parent_activity);
    const perActivity = await client.query(
      `SELECT activity_key, count(*)::int AS n FROM steps GROUP BY activity_key ORDER BY activity_key`
    );
    expect(perActivity.rows).toEqual([
      { activity_key: 'cleanup', n: 4 },
      { activity_key: 'collection', n: 5 },
      { activity_key: 'delivery', n: 3 },
      { activity_key: 'discovery', n: 8 },
      { activity_key: 'outreach', n: 7 },
      { activity_key: 'preflight', n: 6 },
      { activity_key: 'qualification', n: 6 },
      { activity_key: 'scoring', n: 4 },
    ]);
  });

  it('幂等：跑两次行数不变；readback 改了则 updated 计数且 source_sha256 跟着变', async () => {
    await seedActivities();
    await runMigration();
    const spec = parseStepDod(fixtureJson);
    await syncSteps(client, spec);
    const again = await syncSteps(client, spec);
    expect(again).toMatchObject({ inserted: 0, updated: 0, total: 43 });
    const before = await client.query(`SELECT source_sha256 FROM steps WHERE key = $1`, [spec.steps[0].key]);

    const mutated = parseStepDod(fixtureJson);
    mutated.steps[0].readback = { type: 'metric', ref: 'metrics.lock_acquired', expect: { op: '==', value: 2 } };
    const third = await syncSteps(client, mutated);
    expect(third).toMatchObject({ inserted: 0, updated: 1, total: 43 });
    const count = await client.query(`SELECT count(*)::int AS n FROM steps`);
    expect(count.rows[0].n).toBe(43);
    const after = await client.query(`SELECT source_sha256, readback FROM steps WHERE key = $1`, [spec.steps[0].key]);
    expect(after.rows[0].source_sha256).not.toBe(before.rows[0].source_sha256);
    expect(after.rows[0].readback.expect.value).toBe(2);
  });

  it('带名字/动作/进出/失败处理的 Step（合同来源）：新列落库、重跑不变、只改动作算更新；只带读回的旧来源不会把新列清空', async () => {
    await seedActivities();
    await runMigration();
    await client.query('ALTER TABLE steps ADD COLUMN name text, ADD COLUMN action text, ADD COLUMN inputs jsonb, ADD COLUMN outputs jsonb, ADD COLUMN on_fail text');
    const spec = parseStepDod(fixtureJson);
    const rich = { ...spec, steps: spec.steps.map((st, i) => (i === 0
      ? { ...st, name: '拿设备锁', action: 'harvest-cron.sh preflight_lock_acquire', inputs: ['Device.serial'], outputs: ['Device.lock_holder'], on_fail: 'retry:3' }
      : st)) };
    await syncSteps(client, rich);
    const first = (await client.query('SELECT name, action, inputs, outputs, on_fail FROM steps WHERE key = $1', [spec.steps[0].key])).rows[0];
    expect(first).toEqual({ name: '拿设备锁', action: 'harvest-cron.sh preflight_lock_acquire', inputs: ['Device.serial'], outputs: ['Device.lock_holder'], on_fail: 'retry:3' });

    expect(await syncSteps(client, rich)).toMatchObject({ inserted: 0, updated: 0 });

    const changed = { ...rich, steps: rich.steps.map((st, i) => (i === 0 ? { ...st, action: 'douyin-phone-adb lock-acquire' } : st)) };
    expect(await syncSteps(client, changed)).toMatchObject({ updated: 1 });
    expect((await client.query('SELECT action FROM steps WHERE key = $1', [spec.steps[0].key])).rows[0].action).toBe('douyin-phone-adb lock-acquire');

    await syncSteps(client, spec); // step-dod.json 旧来源只带读回：新列保持，不被置空
    const kept = (await client.query('SELECT name, on_fail FROM steps WHERE key = $1', [spec.steps[0].key])).rows[0];
    expect(kept).toEqual({ name: '拿设备锁', on_fail: 'retry:3' });
  });

  it('同名活动有旧骨干版本时挂到最新 backbone_version', async () => {
    await seedActivities({ withBackboneV2Shadow: true });
    await runMigration();
    await syncSteps(client, parseStepDod(fixtureJson));
    const { rows } = await client.query(
      `SELECT DISTINCT js.backbone_version FROM steps s JOIN journey_steps js ON js.id = s.activity_id
        WHERE s.activity_key = 'collection'`
    );
    expect(rows).toEqual([{ backbone_version: '3.0' }]);
  });

  it('找不到活动的步骤：报错列出全部缺失 key，不落任何一行', async () => {
    await seedActivities();
    await runMigration();
    await client.query(`DELETE FROM journey_steps WHERE activity_key IN ('outreach','cleanup')`);
    await expect(syncSteps(client, parseStepDod(fixtureJson))).rejects.toThrow(
      /activity_not_found.*outreach.*cleanup|activity_not_found.*cleanup.*outreach/s
    );
    const count = await client.query(`SELECT count(*)::int AS n FROM steps`);
    expect(count.rows[0].n).toBe(0);
  });
});
