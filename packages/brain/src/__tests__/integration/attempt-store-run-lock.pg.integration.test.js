import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { appendHop } from '../../orchestrator/decision-log.js';
import { createExpiredAttemptAuthority } from '../../orchestrator/expired-attempt-reconciler.js';
import { createRunEventStore } from '../../orchestrator/run-event-store.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^attempt_store_run_lock_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedAttempt(initialStatus) {
  const taskId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  await testPool.query(
    "INSERT INTO tasks (id,title,status) VALUES ($1,$2,'in_progress')",
    [taskId, `attempt store run lock ${attemptId}`],
  );
  await seedOwnedActiveV2Run(testPool, { runId, taskId, phase: 'planning' });
  const store = createAttemptStore(testPool);
  await store.createAttempt({
    id: attemptId,
    runId,
    hop: 1,
    phase: 'generate',
    role: 'generator',
    provider: 'codex',
    callbackSecretHash: 'd'.repeat(64),
    bundle: {},
  });
  if (initialStatus !== 'queued') {
    await testPool.query(
      `UPDATE harness_attempts
          SET status=$2,lease_owner='worker:run-lock',lease_generation=3,
              lease_expires_at=CASE WHEN $2='running'
                THEN NOW()+INTERVAL '2 minutes' ELSE lease_expires_at END,
              heartbeat_at=CASE WHEN $2='running' THEN NOW() ELSE heartbeat_at END
        WHERE id=$1`,
      [attemptId, initialStatus],
    );
  }
  return { attemptId, runId, store };
}

async function installPauseTrigger(attemptId) {
  await testPool.query(`
    CREATE OR REPLACE FUNCTION aaa_pause_projected_attempt_write()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.id = '${attemptId}'::uuid
         AND (NEW.status IS DISTINCT FROM OLD.status
              OR NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at) THEN
        PERFORM pg_sleep(1.5);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER aaa_pause_projected_attempt_write
    BEFORE UPDATE ON harness_attempts
    FOR EACH ROW EXECUTE FUNCTION aaa_pause_projected_attempt_write();
  `);
}

async function removePauseTrigger() {
  await testPool.query(
    'DROP TRIGGER IF EXISTS aaa_pause_projected_attempt_write ON harness_attempts',
  );
  await testPool.query('DROP FUNCTION IF EXISTS aaa_pause_projected_attempt_write()');
}

function failedCallback(context) {
  return context.store.recordCallbackTerminal({
    attemptId: context.attemptId,
    runId: context.runId,
    leaseOwner: 'worker:run-lock',
    leaseGeneration: 3,
    result: {
      status: 'failed',
      summary: 'provider failed during lock-order test',
      artifacts: [],
      provider_metadata: {},
      failure_class: 'runner_failure',
      error: { code: 'provider_failed', message: 'boom' },
    },
  });
}

function expireAttempt(context) {
  return createExpiredAttemptAuthority(testPool).terminalize({
    attemptId: context.attemptId,
    runId: context.runId,
    leaseOwner: 'worker:run-lock',
    leaseGeneration: 3,
    code: 'worker_attempt_missing_after_lease',
    message: 'worker disappeared after lease expiry',
    failureClass: 'infrastructure_blocked',
    evidence: { target: 'worker:run-lock' },
  });
}

beforeAll(async () => {
  databaseName = `attempt_store_run_lock_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 8 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

const transitions = [
  {
    name: 'markRunning',
    initialStatus: 'starting',
    invoke: ({ store, attemptId }) => store.markRunning(attemptId, {
      leaseOwner: 'worker:run-lock',
      leaseGeneration: 3,
      providerSessionId: 'session:run-lock',
      leaseSeconds: 60,
    }),
    cleanupIntents: 1,
  },
  {
    name: 'heartbeat',
    initialStatus: 'running',
    invoke: ({ store, attemptId }) => store.heartbeat(attemptId, {
      leaseOwner: 'worker:run-lock',
      leaseGeneration: 3,
      leaseSeconds: 60,
    }),
    cleanupIntents: 1,
  },
  {
    name: 'reclaim',
    initialStatus: 'running',
    prepare: ({ attemptId }) => testPool.query(
      "UPDATE harness_attempts SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [attemptId],
    ),
    invoke: ({ store, attemptId }) => store.reclaim(attemptId, {
      leaseOwner: 'worker:reclaimed',
      leaseSeconds: 60,
    }),
    cleanupIntents: 1,
  },
  {
    name: 'complete',
    initialStatus: 'running',
    invoke: ({ store, attemptId }) => store.complete(attemptId, {
      status: 'completed',
      summary: 'done',
      artifacts: [],
      provider_metadata: {},
    }, { leaseOwner: 'worker:run-lock' }),
    cleanupIntents: 0,
  },
  {
    name: 'fail',
    initialStatus: 'running',
    invoke: ({ store, attemptId }) => store.fail(attemptId, {
      status: 'failed',
      code: 'provider_failed',
      message: 'failed before parent terminalized',
    }, { leaseOwner: 'worker:run-lock', leaseGeneration: 3 }),
    cleanupIntents: 0,
  },
];

describe.sequential('attempt-store run-first projected mutations on PostgreSQL', () => {
  it('heartbeat and a direct run event append do not deadlock', async () => {
    const context = await seedAttempt('running');
    await installPauseTrigger(context.attemptId);
    try {
      const heartbeat = context.store.heartbeat(context.attemptId, {
        leaseOwner: 'worker:run-lock',
        leaseGeneration: 3,
        leaseSeconds: 60,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const event = createRunEventStore(testPool).append({
        runId: context.runId,
        eventType: 'actor.message_delivered',
        sourceType: 'actor_inbox',
        sourceId: randomUUID(),
        sourceVersion: 1,
        payload: { source: 'lock-order-direct-event' },
      });

      const outcomes = await Promise.allSettled([heartbeat, event]);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
    } finally {
      await removePauseTrigger();
    }
  }, 10_000);

  it('heartbeat and an ordinary phase-changing decision append do not deadlock', async () => {
    const context = await seedAttempt('running');
    await appendHop(testPool, {
      runId: context.runId,
      hop: 1,
      observed: { source: 'lock-order-baseline' },
      derivedPhase: 'planning',
      gateVerdict: 'allow',
      action: 'observe',
      detail: null,
    });
    await installPauseTrigger(context.attemptId);
    try {
      const heartbeat = context.store.heartbeat(context.attemptId, {
        leaseOwner: 'worker:run-lock',
        leaseGeneration: 3,
        leaseSeconds: 60,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const decision = appendHop(testPool, {
        runId: context.runId,
        hop: 2,
        observed: { source: 'lock-order-phase-change' },
        derivedPhase: 'gan',
        gateVerdict: 'allow',
        action: 'dispatch',
        detail: null,
      });

      const outcomes = await Promise.allSettled([heartbeat, decision]);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
    } finally {
      await removePauseTrigger();
    }
  }, 10_000);

  it.each(transitions)(
    '$name does not deadlock terminalization and leaves no active ghost',
    async (transition) => {
      const context = await seedAttempt(transition.initialStatus);
      if (transition.prepare) await transition.prepare(context);
      await installPauseTrigger(context.attemptId);
      try {
        const mutation = transition.invoke(context);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const terminal = testPool.query(
          "UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1",
          [context.runId],
        );
        const outcomes = await Promise.allSettled([mutation, terminal]);
        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
        const attempt = (await testPool.query(
          'SELECT status,parent_run_terminal FROM harness_attempts WHERE id=$1',
          [context.attemptId],
        )).rows[0];
        expect(['queued', 'starting', 'running']).not.toContain(attempt.status);
        expect(attempt.parent_run_terminal).toBe(true);
        expect((await testPool.query(
          `SELECT COUNT(*)::int AS count,
                  COUNT(DISTINCT (attempt_id,lease_generation))::int AS unique_count
             FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1`,
          [context.attemptId],
        )).rows[0]).toEqual({
          count: transition.cleanupIntents,
          unique_count: transition.cleanupIntents,
        });
      } finally {
        await removePauseTrigger();
      }
    },
    10_000,
  );

  it('terminal-first waits without deadlock and the later heartbeat observes cancellation', async () => {
    const context = await seedAttempt('running');
    const terminal = await testPool.connect();
    try {
      await terminal.query('BEGIN');
      await terminal.query('SELECT id FROM initiative_runs WHERE id=$1 FOR UPDATE', [context.runId]);
      const heartbeat = context.store.heartbeat(context.attemptId, {
        leaseOwner: 'worker:run-lock',
        leaseGeneration: 3,
        leaseSeconds: 60,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await terminal.query(
        "UPDATE initiative_runs SET phase='failed',updated_at=NOW() WHERE id=$1",
        [context.runId],
      );
      await terminal.query('COMMIT');
      await expect(heartbeat).resolves.toBeNull();
      expect((await testPool.query(
        'SELECT status,parent_run_terminal FROM harness_attempts WHERE id=$1',
        [context.attemptId],
      )).rows[0]).toMatchObject({ status: 'cancelled', parent_run_terminal: true });
      expect((await testPool.query(
        'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
        [context.attemptId],
      )).rows[0].count).toBe(1);
    } finally {
      await terminal.query('ROLLBACK').catch(() => {});
      terminal.release();
    }
  }, 10_000);

  it.each(['helper-first', 'callback-first'])(
    '%s serializes heartbeat with callback authority without deadlock',
    async (order) => {
      const context = await seedAttempt('running');
      await installPauseTrigger(context.attemptId);
      try {
        const heartbeat = () => context.store.heartbeat(context.attemptId, {
          leaseOwner: 'worker:run-lock',
          leaseGeneration: 3,
          leaseSeconds: 60,
        });
        const first = order === 'helper-first' ? heartbeat() : failedCallback(context);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const second = order === 'helper-first' ? failedCallback(context) : heartbeat();
        const outcomes = await Promise.allSettled([first, second]);
        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
        expect((await testPool.query(
          'SELECT status,parent_run_terminal FROM harness_attempts WHERE id=$1',
          [context.attemptId],
        )).rows[0]).toMatchObject({ status: 'failed', parent_run_terminal: false });
        expect((await testPool.query(
          'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
          [context.attemptId],
        )).rows[0].count).toBe(0);
      } finally {
        await removePauseTrigger();
      }
    },
    10_000,
  );

  it.each(['helper-first', 'expired-first'])(
    '%s serializes heartbeat with expired authority without deadlock',
    async (order) => {
      const context = await seedAttempt('running');
      await testPool.query(
        "UPDATE harness_attempts SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [context.attemptId],
      );
      await installPauseTrigger(context.attemptId);
      try {
        const heartbeat = () => context.store.heartbeat(context.attemptId, {
          leaseOwner: 'worker:run-lock',
          leaseGeneration: 3,
          leaseSeconds: 0,
        });
        const first = order === 'helper-first' ? heartbeat() : expireAttempt(context);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const second = order === 'helper-first' ? expireAttempt(context) : heartbeat();
        const outcomes = await Promise.allSettled([first, second]);
        expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
        expect((await testPool.query(
          'SELECT status,parent_run_terminal FROM harness_attempts WHERE id=$1',
          [context.attemptId],
        )).rows[0]).toMatchObject({ status: 'failed', parent_run_terminal: false });
        expect((await testPool.query(
          'SELECT COUNT(*)::int AS count FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1',
          [context.attemptId],
        )).rows[0].count).toBe(0);
      } finally {
        await removePauseTrigger();
      }
    },
    10_000,
  );
});
