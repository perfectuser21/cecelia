import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileRunTrust } from '../../../scripts/kernel-run-trust-reconcile.mjs';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;
let auditDirectory;

function quotedIdentifier(value) {
  if (!/^kernel_trust_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `kernel_trust_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  auditDirectory = await mkdtemp(join(tmpdir(), 'kernel-trust-pg-'));
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
    );
  }
  if (adminPool) await adminPool.end();
  if (auditDirectory) await rm(auditDirectory, { recursive: true, force: true });
}, 30_000);

describe('kernel trust reconciliation on real PostgreSQL', () => {
  it('mutates only reviewed historical candidates and converges to zero changes', async () => {
    const cutoff = new Date(Date.now() - 60_000);
    await testPool.query(
      `UPDATE schema_version SET applied_at = $1 WHERE version = '376'`,
      [cutoff],
    );

    const historicalTaskId = randomUUID();
    const historicalRunId = randomUUID();
    const activeRunId = randomUUID();
    const postCutoverRunId = randomUUID();
    const nativeTrustedRunId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'historical trust evidence', 'completed')`,
      [historicalTaskId],
    );
    const historicalStartedAt = new Date(cutoff.getTime() - 60_000);
    const postCutoverStartedAt = new Date(cutoff.getTime() + 1_000);
    await testPool.query(
       `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at,
         record_trust_status, record_trust_reason
       ) VALUES
         ($1, $5, 'done', $6, 'v2', 'historical_reconstruction', $7, $8, 'untrusted', NULL),
         ($2, $5, 'generate', $6, 'v2', 'historical_reconstruction', $7, NULL, 'untrusted', NULL),
         ($3, $5, 'failed', $6, 'v2', 'historical_reconstruction', $9, $8, 'untrusted', NULL),
         ($4, $5, 'done', $6, 'v2', 'kernel_dispatch', $7, $8, 'trusted', 'native_writer')`,
      [
        historicalRunId,
        activeRunId,
        postCutoverRunId,
        nativeTrustedRunId,
        randomUUID(),
        historicalTaskId,
        historicalStartedAt,
        cutoff,
        postCutoverStartedAt,
      ],
    );

    const before = await testPool.query(
      `SELECT id, phase, record_trust_status, record_trust_reason
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[historicalRunId, activeRunId, postCutoverRunId, nativeTrustedRunId]],
    );
    const dry = await reconcileRunTrust({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(dry).toMatchObject({
      database: databaseName,
      proposed: 1,
      would_change: 1,
    });

    const auditOutput = join(auditDirectory, 'trust-reconcile.jsonl');
    const applied = await reconcileRunTrust({
      db: testPool,
      apply: true,
      auditOutput,
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: dry.proposed,
      confirmDatabase: databaseName,
      productionGuards: true,
      failOnConflict: true,
      batchSize: 50,
      writeLine: () => {},
    });
    expect(applied).toMatchObject({
      applied: 1,
      unchanged: 0,
      conflicts: 0,
      would_change: 1,
    });

    const after = await testPool.query(
      `SELECT id, phase, record_trust_status, record_trust_reason
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[historicalRunId, activeRunId, postCutoverRunId, nativeTrustedRunId]],
    );
    const beforeById = Object.fromEntries(before.rows.map(row => [row.id, row]));
    const afterById = Object.fromEntries(after.rows.map(row => [row.id, row]));
    expect(afterById[historicalRunId]).toMatchObject({
      record_trust_status: 'reconstructed',
      record_trust_reason: 'direct_task_reference',
    });
    for (const untouchedId of [activeRunId, postCutoverRunId, nativeTrustedRunId]) {
      expect(afterById[untouchedId]).toEqual(beforeById[untouchedId]);
    }

    const secondDry = await reconcileRunTrust({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(secondDry).toMatchObject({
      proposed: 1,
      would_change: 0,
    });
    expect((await stat(auditOutput)).mode & 0o777).toBe(0o400);
    const audit = await readFile(auditOutput, 'utf8');
    expect(audit).toContain('"outcome":"batch_committed"');
    expect(audit).toContain('"outcome":"completed"');
  });
});
