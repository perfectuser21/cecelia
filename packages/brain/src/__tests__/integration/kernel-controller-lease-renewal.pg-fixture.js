import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import {
  createKernelRun,
  CONTROLLER_LEASE_DEFAULT_SECONDS,
} from '../../orchestrator/kernel-run-store.js';
const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const LEASE = CONTROLLER_LEASE_DEFAULT_SECONDS;
export const MIN = 60_000;
export function createKernelLeasePgFixture() {
  let adminPool;
  let testPool;
  let databaseName;
  function quotedIdentifier(value) {
    if (!/^kernel_leaserenew_[a-z0-9_]+$/.test(value)) {
      throw new Error(`unsafe test database identifier: ${value}`);
    }
    return `"${value}"`;
  }
  async function createIsolatedDatabase() {
    databaseName = `kernel_leaserenew_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    adminPool = new Pool({
      ...DB_DEFAULTS,
      database: 'postgres',
      max: 1,
      statement_timeout: 10_000,
    });
    await adminPool.query(
      `CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
    );
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
    testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 10 });
  }
  async function dropIsolatedDatabase() {
    if (testPool) await testPool.end().catch(() => {});
    if (adminPool && databaseName) {
      await adminPool.query(
        'UPDATE pg_database SET datallowconn=false WHERE datname=$1',
        [databaseName],
      ).catch(() => {});
      await adminPool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [databaseName],
      ).catch(() => {});
      await adminPool.query(
        `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`,
      ).catch(() => {});
    }
    if (adminPool) await adminPool.end().catch(() => {});
  }
  function pool() {
    if (!testPool) throw new Error('kernel lease PG fixture is not initialized');
    return testPool;
  }
  async function seedOwnedRun({ controllerSessionId }) {
    const initiativeId = randomUUID();
    const taskId = randomUUID();
    await pool().query(
      `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
       VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
      [taskId, `kernel-leaserenew-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
    );
    const created = await createKernelRun(pool(), {
      taskId,
      initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
      controllerSessionId,
    });
    return { runId: created.run.id, taskId, initiativeId };
  }
  async function seedHistoricalBlankRun(controllerSessionId) {
    const initiativeId = randomUUID();
    const taskId = randomUUID();
    await pool().query(
      `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
       VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
      [taskId, `kernel-blank-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
    );
    const { rows } = await pool().query(
      `INSERT INTO initiative_runs (
         initiative_id, current_task_id, phase, orchestrator_version, created_source,
         deadline_at, controller_session_id, controller_lease_expires_at
       ) VALUES (
         $1, $2, 'planning', 'v2', 'historical_reconstruction',
         NOW() + INTERVAL '8 hours', $3, NOW() + INTERVAL '1 hour'
       ) RETURNING id`,
      [initiativeId, taskId, controllerSessionId],
    );
    return { runId: rows[0].id, taskId };
  }
  async function leaseOf(runId) {
    const { rows } = await pool().query(
      `SELECT r.controller_lease_expires_at, r.orchestrator_heartbeat_at,
              r.phase, r.failure_reason,
              t.status AS task_status
         FROM initiative_runs r
         JOIN tasks t ON t.id = r.current_task_id
        WHERE r.id = $1`,
      [runId],
    );
    return rows[0];
  }
  async function auditEvents(runId) {
    const { rows } = await pool().query(
      `SELECT event_type, source, task_id, payload
         FROM cecelia_events
        WHERE payload->>'run_id' = $1
        ORDER BY id`,
      [runId],
    );
    return rows;
  }
  async function installRejectingAuditTrigger(eventType) {
    if (!['kernel_controller_lease_renewed', 'kernel_ownerless_run_recovered'].includes(eventType)) {
      throw new Error(`unsafe audit event fixture: ${eventType}`);
    }
    await pool().query(`
      CREATE OR REPLACE FUNCTION reject_kernel_audit_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = TG_ARGV[0] THEN
          RAISE EXCEPTION 'forced kernel audit failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool().query(
      `CREATE TRIGGER reject_kernel_audit_event_trigger
         BEFORE INSERT ON cecelia_events
         FOR EACH ROW
         EXECUTE FUNCTION reject_kernel_audit_event('${eventType}')`,
    );
  }
  async function removeRejectingAuditTrigger() {
    await pool().query('DROP TRIGGER IF EXISTS reject_kernel_audit_event_trigger ON cecelia_events');
    await pool().query('DROP FUNCTION IF EXISTS reject_kernel_audit_event()');
  }
  async function waitForBlockedFinalize() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await pool().query(
        `SELECT count(*)::int AS blocked
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND cardinality(pg_blocking_pids(pid)) > 0
            AND query LIKE '%SELECT id, status%'
            AND query LIKE '%FROM tasks%'
            AND query LIKE '%FOR UPDATE%'`,
      );
      if (rows[0].blocked > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('reconcile did not reach the blocked finalize boundary');
  }
  return {
    auditEvents,
    createIsolatedDatabase,
    dropIsolatedDatabase,
    installRejectingAuditTrigger,
    leaseOf,
    pool,
    removeRejectingAuditTrigger,
    seedHistoricalBlankRun,
    seedOwnedRun,
    waitForBlockedFinalize,
  };
}
