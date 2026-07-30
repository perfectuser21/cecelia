import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { runMigrations } from '../../migrate.js';

const migrationsUrl = new URL('../../../migrations/', import.meta.url);
const migration357 = readFileSync(
  new URL('../../../migrations/357_harness_provider_attempts.sql', import.meta.url),
  'utf8',
);
const migration362 = readFileSync(
  new URL('../../../migrations/362_kernel_attempt_telemetry_reconcile.sql', import.meta.url),
  'utf8',
);
const schemaName = `kernel_naming_364_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;

let adminPool;
let migrationPool;
let client;

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  client = await adminPool.connect();
  await client.query(`SET search_path TO ${quotedSchema}`);
  await client.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'planning',
      orchestrator_version TEXT NOT NULL DEFAULT 'v1'
        CHECK (orchestrator_version IN ('v1','v2'))
    );
  `);
  await client.query(migration357);
  await client.query(migration362);
  await client.query(`
    ALTER TABLE harness_attempts
      ADD COLUMN requested_machine_id TEXT,
      ADD COLUMN actual_machine_id TEXT,
      ADD COLUMN execution_transport TEXT,
      ADD COLUMN remote_job_id TEXT,
      ADD COLUMN machine_attestation_status TEXT,
      ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0;
  `);

  // 本 fixture 只建了 schema_version / initiative_runs / harness_attempts 三张表，
  // 跑不了任何别的 migration。所以把「除 364 外的全部版本」标成已应用，
  // 让 runMigrations 恰好只剩 364 待跑。
  // 不能写成 `<= 363`——那样每加一条 ≥365 的新 migration 都会被这个 fixture 拖下水
  // （2026-07-27 实证：migration 365 在这里炸 relation "tasks" does not exist）。
  const versionsExcept364 = readdirSync(migrationsUrl)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .map((file) => file.split('_')[0])
    .filter((version) => Number(version) !== 364);
  await client.query(
    `INSERT INTO schema_version (version, description)
     SELECT version, 'pre-364 fixture'
       FROM UNNEST($1::text[]) AS version
     ON CONFLICT (version) DO NOTHING`,
    [versionsExcept364],
  );

  migrationPool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schemaName}`,
    max: 2,
  });
}, 15_000);

afterAll(async () => {
  if (client) client.release();
  if (migrationPool) await migrationPool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('migration 364 through the real migration runner', () => {
  it('upgrades an applied-363 database once and enables modern attempt creation', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(runMigrations(migrationPool)).resolves.toEqual(['364']);

      const provenance = await migrationPool.query(
        `SELECT column_default, is_nullable
           FROM information_schema.columns
          WHERE table_schema=$1
            AND table_name='harness_attempts'
            AND column_name='local_container_naming'`,
        [schemaName],
      );
      expect(provenance.rows).toEqual([{
        column_default: "'legacy-unsuffixed'::text",
        is_nullable: 'NO',
      }]);

      const constraint = await migrationPool.query(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conname='harness_attempts_local_container_naming_check'
            AND conrelid=$1::regclass`,
        [`${schemaName}.harness_attempts`],
      );
      expect(constraint.rows[0]?.definition).toContain('legacy-unsuffixed');
      expect(constraint.rows[0]?.definition).toContain('generation-v1');

      const runId = randomUUID();
      await migrationPool.query(
        `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
        [runId],
      );
      const attempt = await createAttemptStore(migrationPool).createAttempt({
        id: randomUUID(),
        runId,
        hop: 1,
        phase: 'generate',
        role: 'generator',
        provider: 'codex',
        accountId: 'team1',
        machineId: 'us-mac-m4',
        bundle: { inputs: {} },
        callbackSecretHash: 'a'.repeat(64),
      });
      expect(attempt.local_container_naming).toBe('generation-v1');

      const legacyId = randomUUID();
      await migrationPool.query(
        `INSERT INTO harness_attempts (
           id, run_id, hop, phase, role, provider, machine_id,
           task_bundle, callback_secret_hash
         ) VALUES ($1,$2,2,'generate','generator','codex','us-mac-m4','{}','legacy-hash')`,
        [legacyId, runId],
      );
      const legacy = await migrationPool.query(
        'SELECT local_container_naming FROM harness_attempts WHERE id=$1',
        [legacyId],
      );
      expect(legacy.rows[0].local_container_naming).toBe('legacy-unsuffixed');

      await expect(
        migrationPool.query(
          `UPDATE harness_attempts
              SET local_container_naming='unsupported'
            WHERE id=$1`,
          [legacyId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(runMigrations(migrationPool)).resolves.toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});
