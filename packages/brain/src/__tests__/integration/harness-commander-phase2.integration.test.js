import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { runMigrations } from '../../migrate.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { createCommanderStore } from '../../orchestrator/commander-store.js';
import { appendHop } from '../../orchestrator/decision-log.js';

const migrationsUrl = new URL('../../../migrations/', import.meta.url);
const schemaName = `commander_368_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const prerequisites = [
  '312_orchestrator_runs_state.sql',
  '357_harness_provider_attempts.sql',
  '361_kernel_attempt_telemetry.sql',
  '362_kernel_attempt_telemetry_reconcile.sql',
  '363_kernel_fleet_execution_receipts.sql',
  '364_kernel_local_container_naming.sql',
  '366_kernel_harness_failure_class.sql',
  '367_harness_commander_phase1.sql',
];

let adminPool;
let migrationPool;
let setupClient;

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  setupClient = await adminPool.connect();
  await setupClient.query(`SET search_path TO ${quotedSchema}, public`);
  await setupClient.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'planning',
      failure_reason TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  for (const file of prerequisites) {
    await setupClient.query(
      readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'),
    );
  }
  const versionsExcept368 = readdirSync(migrationsUrl)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .map((file) => file.split('_')[0])
    .filter((version) => Number(version) !== 368);
  await setupClient.query(
    `INSERT INTO schema_version (version, description)
     SELECT version, 'pre-368 fixture'
       FROM UNNEST($1::text[]) AS version
     ON CONFLICT (version) DO NOTHING`,
    [versionsExcept368],
  );
  migrationPool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schemaName},public`,
    max: 3,
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await runMigrations(migrationPool);
  } finally {
    log.mockRestore();
  }
}, 15_000);

afterAll(async () => {
  if (setupClient) setupClient.release();
  if (migrationPool) await migrationPool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('Commander Phase 2 PostgreSQL authority chain', () => {
  it('projects proposal/adjudication from decision authority and advances recoverable memory', async () => {
    const runId = randomUUID();
    const attemptId = randomUUID();
    await migrationPool.query(
      `INSERT INTO initiative_runs (id,commander_mode) VALUES ($1,'hybrid')`,
      [runId],
    );
    await createCommanderStore(migrationPool).ensureRun({ runId });

    const directive = {
      schema: 'commander-directive/v1',
      run_id: runId,
      event_cursor: 1,
      action: 'continue_default',
      reason: 'Keep the current Kernel decision.',
      evidence_refs: ['event:1'],
    };
    const attempts = createAttemptStore(migrationPool);
    await attempts.createAttempt({
      id: attemptId,
      runId,
      hop: 1,
      phase: 'planning',
      role: 'commander',
      provider: 'codex',
      accountId: 'team4',
      machineId: 'us-mac-m4',
      bundle: {
        inputs: {
          commander_bundle: {
            run_id: runId,
            commander_attempt_id: attemptId,
            event_cursor: 1,
          },
        },
      },
      callbackSecretHash: 'a'.repeat(64),
      logicalCycleId: 'commander-wakeup:1',
    });
    await attempts.markStarting(attemptId, {
      leaseOwner: 'brain-1',
      leaseSeconds: 90,
    });
    await attempts.complete(attemptId, {
      status: 'completed',
      decision: directive,
      provider_metadata: { provider: 'codex', session_id: 'session-private' },
    }, { leaseOwner: 'brain-1' });

    await appendHop(migrationPool, {
      runId,
      hop: 2,
      observed: { commander_attempt_id: attemptId, event_cursor: 1 },
      derivedPhase: 'planning',
      gateVerdict: null,
      action: 'commander.directive_proposed',
      detail: { attempt_id: attemptId, directive },
    });
    await appendHop(migrationPool, {
      runId,
      hop: 3,
      observed: { commander_attempt_id: attemptId, event_cursor: 1 },
      derivedPhase: 'planning',
      gateVerdict: 'allow',
      action: 'commander.directive_accepted',
      detail: { attempt_id: attemptId, directive },
    });

    const projected = await migrationPool.query(
      `SELECT cursor,event_type,payload
         FROM harness_run_events
        WHERE run_id=$1
        ORDER BY cursor`,
      [runId],
    );
    expect(projected.rows.map(({ event_type }) => event_type)).toEqual([
      'run.created',
      'attempt.starting',
      'attempt.completed',
      'commander.directive_proposed',
      'commander.directive_accepted',
    ]);
    expect(JSON.stringify(projected.rows)).not.toMatch(
      /session-private|callback_secret|raw_prompt|raw_provider_output|credential/i,
    );

    await expect(createCommanderStore(migrationPool).advanceCursor(runId, {
      expectedCursor: 0,
      nextCursor: Number(projected.rows.at(-1).cursor),
    })).resolves.toMatchObject({
      run_id: runId,
      event_cursor: Number(projected.rows.at(-1).cursor),
    });
    await expect(
      migrationPool.query(
        `UPDATE harness_run_events SET payload='{"mutated":true}'
          WHERE run_id=$1 AND cursor=$2`,
        [runId, projected.rows.at(-1).cursor],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('keeps failed and replacement Commander Attempts with projected failover decisions', async () => {
    const runId = randomUUID();
    const failedAttemptId = randomUUID();
    const replacementAttemptId = randomUUID();
    const attempts = createAttemptStore(migrationPool);
    await migrationPool.query(
      `INSERT INTO initiative_runs (id,commander_mode) VALUES ($1,'hybrid')`,
      [runId],
    );
    await attempts.createAttempt({
      id: failedAttemptId,
      runId,
      hop: 1,
      phase: 'planning',
      role: 'commander',
      provider: 'codex',
      accountId: 'team4',
      machineId: 'us-mac-m4',
      bundle: { inputs: {} },
      callbackSecretHash: 'a'.repeat(64),
      logicalCycleId: 'commander-wakeup:1',
    });
    await attempts.fail(failedAttemptId, {
      code: 'provider_unavailable',
      message: 'bounded diagnostic',
      failureClass: 'infrastructure_blocked',
    });
    await appendHop(migrationPool, {
      runId,
      hop: 1,
      observed: { commander_attempt_id: failedAttemptId },
      derivedPhase: 'planning',
      gateVerdict: 'allow',
      action: 'commander.failover_started',
      detail: {
        attempt_id: failedAttemptId,
        reason_code: 'provider_unavailable',
      },
    });
    await attempts.createAttempt({
      id: replacementAttemptId,
      runId,
      hop: 2,
      phase: 'planning',
      role: 'commander',
      provider: 'claude',
      accountId: 'account1',
      machineId: 'us-mac-m4',
      bundle: { inputs: {} },
      callbackSecretHash: 'b'.repeat(64),
      logicalCycleId: 'commander-wakeup:1',
      attemptKind: 'retry',
      retryOfAttemptId: failedAttemptId,
      restartReason: 'commander_failover:provider_unavailable',
    });
    await appendHop(migrationPool, {
      runId,
      hop: 2,
      observed: { commander_attempt_id: replacementAttemptId },
      derivedPhase: 'planning',
      gateVerdict: 'allow',
      action: 'commander.failover_completed',
      detail: { attempt_id: replacementAttemptId },
    });

    const lineage = await attempts.listCommanderFailoverLineage(
      runId,
      'commander-wakeup:1',
    );
    expect(lineage).toMatchObject([
      {
        id: failedAttemptId,
        status: 'failed',
        provider: 'codex',
        failure_class: 'infrastructure_blocked',
        error_code: 'provider_unavailable',
      },
      {
        id: replacementAttemptId,
        status: 'queued',
        provider: 'claude',
        retry_of_attempt_id: failedAttemptId,
        restart_reason: 'commander_failover:provider_unavailable',
      },
    ]);
    const events = await migrationPool.query(
      `SELECT event_type,payload
         FROM harness_run_events
        WHERE run_id=$1
          AND event_type LIKE 'commander.failover_%'
        ORDER BY cursor`,
      [runId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      'commander.failover_started',
      'commander.failover_completed',
    ]);
  });
});
