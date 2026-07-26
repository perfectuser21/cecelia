import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATION_357 = readFileSync(
  'packages/brain/migrations/357_harness_provider_attempts.sql',
  'utf8',
);
const MIGRATION_361_PATH = 'packages/brain/migrations/361_kernel_attempt_telemetry.sql';
const QUERY_MODULE = '../../../packages/brain/src/orchestrator/attempt-telemetry.js';
const WATCHDOG_MODULE = '../../../packages/brain/src/harness-relay-watchdog.js';

function assertSafeTestDatabaseUrl(value: string | undefined) {
  if (!value) {
    throw new Error('必须显式设置 TEST_DATABASE_URL；禁止 DB_URL/DATABASE_URL 生产库 fallback');
  }
  const database = new URL(value).pathname.slice(1);
  if (!/(_test|_scratch)$/.test(database) || database === 'cecelia') {
    throw new Error(`拒绝非测试数据库: ${database}`);
  }
}

let hasSafeTestDatabase = false;
try {
  assertSafeTestDatabaseUrl(TEST_DATABASE_URL);
  hasSafeTestDatabase = true;
} catch {
  hasSafeTestDatabase = false;
}

const pool = new pg.Pool({
  connectionString: hasSafeTestDatabase
    ? TEST_DATABASE_URL
    : 'postgresql://invalid:invalid@127.0.0.1:1/missing_test',
  max: 2,
});
let client: pg.PoolClient;
let schemaName: string;

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function applyMigration361Twice() {
  expect(existsSync(MIGRATION_361_PATH), `${MIGRATION_361_PATH} 必须存在`).toBe(true);
  if (!existsSync(MIGRATION_361_PATH)) return;
  const sql = readFileSync(MIGRATION_361_PATH, 'utf8');
  await client.query(sql);
  await client.query(sql);
}

async function seedBaseSchema() {
  await client.query(`
    CREATE TABLE schema_version (
      version TEXT PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE tasks (
      id UUID PRIMARY KEY,
      payload JSONB NOT NULL DEFAULT '{}'
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY,
      initiative_id UUID NOT NULL,
      current_task_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(MIGRATION_357);
}

async function loadQueryModule() {
  const modulePath = 'packages/brain/src/orchestrator/attempt-telemetry.js';
  expect(existsSync(modulePath), `${modulePath} 必须存在`).toBe(true);
  if (!existsSync(modulePath)) return null;
  return import(QUERY_MODULE);
}

async function insertRun(id: string, taskId: string, tenantId: string) {
  await client.query(
    `INSERT INTO tasks (id, payload)
     VALUES ($1, jsonb_build_object('tenant_id', $2::text))
     ON CONFLICT (id) DO NOTHING`,
    [taskId, tenantId],
  );
  await client.query(
    `INSERT INTO initiative_runs (id, initiative_id, current_task_id)
     VALUES ($1, $2, $2)`,
    [id, taskId],
  );
}

async function insertAttempt({
  id,
  runId,
  hop,
  role,
  logicalCycleId,
  attemptKind = 'initial',
  retryOfAttemptId = null,
  restartReason = null,
  workstreamKey = 'ws1',
  invalid = false,
  derived = false,
  secretNoise = false,
}: {
  id: string;
  runId: string;
  hop: number;
  role: string;
  logicalCycleId: string;
  attemptKind?: string;
  retryOfAttemptId?: string | null;
  restartReason?: string | null;
  workstreamKey?: string;
  invalid?: boolean;
  derived?: boolean;
  secretNoise?: boolean;
}) {
  await client.query(
    `INSERT INTO harness_attempts (
       id, run_id, hop, phase, role, provider, task_bundle, callback_secret_hash,
       status, created_at, started_at, completed_at, updated_at,
       logical_cycle_id, attempt_kind, retry_of_attempt_id, restart_reason,
       workstream_key, time_derived, result, error_message
     ) VALUES (
       $1,$2,$3,'evaluate',$4,'codex',$5::jsonb,$6,
       'completed',$7::timestamptz,$8::timestamptz,$9::timestamptz,$9::timestamptz,
       $10,$11,$12,$13,$14,$15,$16::jsonb,$17
     )`,
    [
      id,
      runId,
      hop,
      role,
      JSON.stringify({ objective: 'fixture' }),
      secretNoise ? 'callback-secret-SHOULD-NOT-LEAK' : `hash-${id}`,
      '2026-07-25T00:00:00.000Z',
      '2026-07-25T00:00:00.500Z',
      '2026-07-25T00:00:01.500Z',
      logicalCycleId,
      attemptKind,
      retryOfAttemptId,
      restartReason,
      workstreamKey,
      derived,
      JSON.stringify({
        evaluation: { valid: !invalid },
        agent_text: invalid
          ? 'looks valid in prose'
          : 'retry recovery invalid watchdog_overdue words are only noise',
        secret: secretNoise ? 'bearer SUPER-SECRET-TOKEN' : undefined,
      }),
      secretNoise ? 'token=SUPER-SECRET raw-agent-content' : 'retry invalid recovery textual noise',
    ],
  );
}

describe('kernel telemetry PostgreSQL safety contract', () => {
  it('显式 TEST_DATABASE_URL 指向 _test/_scratch，绝不 fallback 到生产库', () => {
    expect(() => assertSafeTestDatabaseUrl(TEST_DATABASE_URL)).not.toThrow();
  });
});

describe.sequential.runIf(hasSafeTestDatabase)(
  'kernel attempt telemetry real PostgreSQL contract [BEHAVIOR]',
  () => {
  beforeEach(async () => {
    client = await pool.connect();
    schemaName = `kernel_telemetry_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}, public`);
    await seedBaseSchema();
  });

  afterEach(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    client.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('真实隔离 PG 执行 additive migration 两次且不改写 357 既有列', async () => {
    const before = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='harness_attempts'
      ORDER BY ordinal_position
    `, [schemaName]);

    await applyMigration361Twice();

    const after = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='harness_attempts'
      ORDER BY ordinal_position
    `, [schemaName]);
    expect(after.rows.slice(0, before.rows.length)).toEqual(before.rows);
    expect(after.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      'logical_cycle_id',
      'attempt_kind',
      'retry_of_attempt_id',
      'restart_reason',
      'workstream_key',
      'time_derived',
    ]));
  });

  it('生产库 URL 在创建连接或执行 SQL 前 fail-closed', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://localhost/cecelia')).toThrow();
    expect(() => assertSafeTestDatabaseUrl('postgresql://localhost/cecelia_dev')).toThrow();
    expect(() => assertSafeTestDatabaseUrl('postgresql://localhost/cecelia_test')).not.toThrow();
  });

  it('attempt-store 真写 lineage，新 attempt 严格绑定 retry_of_attempt_id', async () => {
    await applyMigration361Twice();
    if (!existsSync(MIGRATION_361_PATH)) return;

    const taskId = randomUUID();
    const runId = randomUUID();
    const initialId = randomUUID();
    const retryId = randomUUID();
    await insertRun(runId, taskId, 'tenant-a');
    const store = createAttemptStore(client);
    const base = {
      runId,
      phase: 'generate',
      role: 'generator',
      provider: 'codex',
      bundle: { objective: 'fixture' },
      callbackSecretHash: 'hash',
      logicalCycleId: 'cycle-a',
      workstreamKey: 'ws1',
    };
    await store.createAttempt({
      ...base,
      id: initialId,
      hop: 1,
      attemptKind: 'initial',
      retryOfAttemptId: null,
      restartReason: null,
    });
    await store.createAttempt({
      ...base,
      id: retryId,
      hop: 2,
      attemptKind: 'retry',
      retryOfAttemptId: initialId,
      restartReason: 'evaluator_failed',
    });

    const rows = await client.query(
      `SELECT id, logical_cycle_id, attempt_kind, retry_of_attempt_id,
              restart_reason, workstream_key
       FROM harness_attempts ORDER BY hop`,
    );
    expect(rows.rows).toEqual([
      {
        id: initialId,
        logical_cycle_id: 'cycle-a',
        attempt_kind: 'initial',
        retry_of_attempt_id: null,
        restart_reason: null,
        workstream_key: 'ws1',
      },
      {
        id: retryId,
        logical_cycle_id: 'cycle-a',
        attempt_kind: 'retry',
        retry_of_attempt_id: initialId,
        restart_reason: 'evaluator_failed',
        workstream_key: 'ws1',
      },
    ]);
  });

  it('真调用 orphan 收口入口：新 owner fencing、多轮、重复 callback、null/false 只终结一次', async () => {
    await applyMigration361Twice();
    if (!existsSync(MIGRATION_361_PATH)) return;
    const watchdog = await import(WATCHDOG_MODULE);
    expect(typeof watchdog.reconcileExpiredKernelAttempt).toBe('function');
    if (typeof watchdog.reconcileExpiredKernelAttempt !== 'function') return;

    const taskId = randomUUID();
    const runId = randomUUID();
    const orphanId = randomUUID();
    await insertRun(runId, taskId, 'tenant-a');
    await client.query(
      `INSERT INTO harness_attempts (
         id, run_id, hop, phase, role, provider, task_bundle, callback_secret_hash,
         status, lease_owner, lease_expires_at, provider_session_id,
         logical_cycle_id, attempt_kind, workstream_key
       ) VALUES (
         $1,$2,1,'generate','generator','codex','{}','hash',
         'running','old-owner',NOW()-INTERVAL '1 minute','session-orphan',
         'cycle-a','initial','ws1'
       )`,
      [orphanId, runId],
    );

    const resumeAttempt = async () => null;
    await watchdog.reconcileExpiredKernelAttempt({
      db: client,
      attemptId: orphanId,
      leaseOwner: 'watchdog-owner',
      resumeAttempt,
    });
    await watchdog.reconcileExpiredKernelAttempt({
      db: client,
      attemptId: orphanId,
      leaseOwner: 'watchdog-owner',
      resumeAttempt: async () => false,
    });

    const afterTwoScans = await client.query(
      `SELECT id, status, lease_owner, completed_at, retry_of_attempt_id, attempt_kind
       FROM harness_attempts WHERE id=$1 OR retry_of_attempt_id=$1 ORDER BY created_at`,
      [orphanId],
    );
    expect(afterTwoScans.rows.filter((row) => row.completed_at !== null)).toHaveLength(1);
    expect(afterTwoScans.rows.filter((row) =>
      ['resume', 'recovery'].includes(row.attempt_kind))).toHaveLength(0);

    const store = createAttemptStore(client);
    const repeated = await store.complete(orphanId, {
      status: 'completed',
      provider_metadata: { session_id: 'late-old-callback' },
    }, { leaseOwner: 'old-owner' });
    expect(repeated).toEqual({ attempt: null, deduped: true });

    const liveAttemptId = randomUUID();
    await client.query(
      `INSERT INTO harness_attempts (
         id, run_id, hop, phase, role, provider, task_bundle, callback_secret_hash,
         status, lease_owner, lease_expires_at, provider_session_id,
         logical_cycle_id, attempt_kind, workstream_key
       ) VALUES (
         $1,$2,2,'generate','generator','codex','{}','hash-live',
         'running','new-owner',NOW()+INTERVAL '5 minutes','session-new-owner',
         'cycle-a','recovery','ws1'
       )`,
      [liveAttemptId, runId],
    );
    await watchdog.reconcileExpiredKernelAttempt({
      db: client,
      attemptId: liveAttemptId,
      leaseOwner: 'watchdog-owner',
      resumeAttempt: async () => false,
    });
    const live = await client.query(
      'SELECT status, lease_owner, completed_at FROM harness_attempts WHERE id=$1',
      [liveAttemptId],
    );
    expect(live.rows[0]).toEqual({
      status: 'running',
      lease_owner: 'new-owner',
      completed_at: null,
    });
  });

  it('4-run fixture 锁定时间公式、六 role、derived、结构化分类与 totals 对齐', async () => {
    await applyMigration361Twice();
    const module = await loadQueryModule();
    if (!module || !existsSync(MIGRATION_361_PATH)) return;
    expect(typeof module.queryAttemptTelemetry).toBe('function');

    const tenantId = 'tenant-a';
    const taskId = randomUUID();
    const runIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const runId of runIds) await insertRun(runId, taskId, tenantId);

    const roleCounts = {
      planner: 4,
      reviewer: 5,
      generator: 9,
      evaluator: 1,
      judge: 5,
      reporter: 1,
    };
    const ids: string[] = [];
    let index = 0;
    for (const [role, count] of Object.entries(roleCounts)) {
      for (let n = 0; n < count; n += 1) {
        const id = randomUUID();
        ids.push(id);
        await insertAttempt({
          id,
          runId: runIds[index % runIds.length],
          hop: index + 1,
          role,
          logicalCycleId: index < 12 ? 'cycle-a' : 'cycle-b',
          attemptKind: index === 2 || index === 8
            ? 'retry'
            : index === 17
              ? 'recovery'
              : 'initial',
          retryOfAttemptId: index === 2 || index === 8 || index === 17 ? ids[0] : null,
          restartReason: index === 2 || index === 8
            ? 'evaluator_failed'
            : index === 17
              ? 'lease_expired'
              : null,
          workstreamKey: index % 2 === 0 ? 'ws1' : 'ws2',
          invalid: index === 13,
          derived: role === 'judge' || role === 'reporter',
          secretNoise: index === 20,
        });
        index += 1;
      }
    }

    const telemetry = await module.queryAttemptTelemetry(client, {
      taskId,
      tenantId,
      includeAttempts: true,
    });
    expect(telemetry.task_id).toBe(taskId);
    expect(telemetry.run_count).toBe(4);
    expect(telemetry.logical_cycle_count).toBe(2);
    expect(telemetry.raw_counts).toMatchObject({
      planner: 4,
      reviewer: 5,
      generator: 9,
      judge: 5,
    });
    expect(telemetry.totals).toEqual({
      active_time_ms: 25_000,
      wait_time_ms: 12_500,
      wall_time_ms: 37_500,
      retry_count: 2,
      recovery_count: 1,
      invalid_count: 1,
    });
    expect(new Set(telemetry.role_metrics.map((metric: any) => metric.role))).toEqual(
      new Set(['planner', 'generator', 'reviewer', 'evaluator', 'judge', 'reporter']),
    );
    expect(telemetry.role_metrics.every((metric: any) =>
      metric.wall_time_ms === metric.active_time_ms + metric.wait_time_ms)).toBe(true);
    expect(telemetry.role_metrics.reduce(
      (sum: number, metric: any) => sum + metric.active_time_ms,
      0,
    )).toBe(telemetry.totals.active_time_ms);
    expect(telemetry.role_metrics.reduce(
      (sum: number, metric: any) => sum + metric.wait_time_ms,
      0,
    )).toBe(telemetry.totals.wait_time_ms);
    expect(telemetry.role_metrics.reduce(
      (sum: number, metric: any) => sum + metric.wall_time_ms,
      0,
    )).toBe(telemetry.totals.wall_time_ms);
    expect(telemetry.attempts.filter(
      (attempt: any) => ['judge', 'reporter'].includes(attempt.role),
    ).every((attempt: any) => attempt.derived === true)).toBe(true);
    expect(telemetry.attempts.every(
      (attempt: any) => typeof attempt.logical_cycle_id === 'string',
    )).toBe(true);
    expect(JSON.stringify(telemetry)).not.toMatch(
      /SUPER-SECRET|callback_secret_hash|raw-agent-content|bearer/i,
    );
  });

  it('双租户真实 PG fixture 不可交叉读取，文本噪声不改变 retry/recovery/invalid 分类', async () => {
    await applyMigration361Twice();
    const module = await loadQueryModule();
    if (!module || !existsSync(MIGRATION_361_PATH)) return;

    const taskA = randomUUID();
    const taskB = randomUUID();
    const runA = randomUUID();
    const runB = randomUUID();
    await insertRun(runA, taskA, 'tenant-a');
    await insertRun(runB, taskB, 'tenant-b');
    await insertAttempt({
      id: randomUUID(),
      runId: runA,
      hop: 1,
      role: 'generator',
      logicalCycleId: 'cycle-a',
    });
    await insertAttempt({
      id: randomUUID(),
      runId: runB,
      hop: 1,
      role: 'generator',
      logicalCycleId: 'cycle-b',
      secretNoise: true,
    });

    const tenantA = await module.queryAttemptTelemetry(client, {
      taskId: taskA,
      tenantId: 'tenant-a',
      includeAttempts: true,
    });
    expect(tenantA.run_count).toBe(1);
    expect(tenantA.totals.retry_count).toBe(0);
    expect(tenantA.totals.recovery_count).toBe(0);
    expect(tenantA.totals.invalid_count).toBe(0);
    expect(tenantA.attempts.every((attempt: any) => attempt.run_id === runA)).toBe(true);

    await expect(module.queryAttemptTelemetry(client, {
      taskId: taskB,
      tenantId: 'tenant-a',
      includeAttempts: true,
    })).rejects.toMatchObject({ code: 'telemetry_not_found' });
  });
  },
);
