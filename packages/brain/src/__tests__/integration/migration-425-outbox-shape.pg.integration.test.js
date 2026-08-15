import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^migration_425_shape_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedPendingIntent() {
  const taskId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  await testPool.query(
    "INSERT INTO tasks (id,title,status) VALUES ($1,$2,'in_progress')",
    [taskId, `migration 425 shape ${taskId}`],
  );
  await seedOwnedActiveV2Run(testPool, { runId, taskId, phase: 'planning' });
  await createAttemptStore(testPool).createAttempt({
    id: attemptId,
    runId,
    hop: 1,
    phase: 'generate',
    role: 'generator',
    provider: 'codex',
    callbackSecretHash: 'e'.repeat(64),
    bundle: {},
  });
  await testPool.query(
    `INSERT INTO harness_attempt_cleanup_outbox (
       run_id,attempt_id,lease_generation,cleanup_cause
     ) VALUES ($1,$2,0,'shape_test')`,
    [runId, attemptId],
  );
  return { attemptId };
}

async function expectRejectedInRollback(sql, values, pattern) {
  const client = await testPool.connect();
  try {
    await client.query('BEGIN');
    await expect(client.query(sql, values)).rejects.toThrow(pattern);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  databaseName = `migration_425_shape_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 3 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('migration 425 outbox row shape on PostgreSQL', () => {
  it('rejects confirmation evidence while blocking a pending intent', async () => {
    for (const pollution of ["receipt='{}'::jsonb", 'confirmed_at=NOW()']) {
      const { attemptId } = await seedPendingIntent();
      await expectRejectedInRollback(
        `UPDATE harness_attempt_cleanup_outbox
            SET status='blocked',${pollution}
          WHERE attempt_id=$1`,
        [attemptId],
        /cleanup_outbox_invalid_nonconfirmed_receipt/,
      );
    }
  });

  it('rejects non-object confirmation receipts', async () => {
    for (const receipt of ["'null'::jsonb", "'[]'::jsonb", "'true'::jsonb"]) {
      const { attemptId } = await seedPendingIntent();
      await testPool.query(
        `UPDATE harness_attempt_cleanup_outbox
            SET status='leased',claim_owner='worker',
                claim_generation=claim_generation+1,
                claim_expires_at=NOW()+INTERVAL '1 minute'
          WHERE attempt_id=$1`,
        [attemptId],
      );
      await expectRejectedInRollback(
        `UPDATE harness_attempt_cleanup_outbox
            SET status='confirmed',receipt=${receipt},confirmed_at=NOW()
          WHERE attempt_id=$1`,
        [attemptId],
        /cleanup_outbox_invalid_confirmation/,
      );
    }
    const { attemptId } = await seedPendingIntent();
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='leased',claim_owner='worker',claim_generation=claim_generation+1,
              claim_expires_at=NOW()+INTERVAL '1 minute' WHERE attempt_id=$1`,
      [attemptId],
    );
    await expect(testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET status='confirmed',receipt='{"removed":true}'::jsonb,confirmed_at=NOW()
        WHERE attempt_id=$1`,
      [attemptId],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects non-canonical initial outbox rows', async () => {
    const { attemptId } = await seedPendingIntent();
    const invalidInitialStates = [
      "'confirmed',0,NULL,NULL,'{}'::jsonb,NOW(),NULL,0,NULL,NULL,NULL",
      "'leased',0,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL",
      "'pending',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL",
      "'pending',0,'forged',NOW()+INTERVAL '1 minute',NULL,NULL,NULL,0,NULL,NULL,NULL",
      "'pending',0,NULL,NULL,'{}'::jsonb,NULL,NULL,0,NULL,NULL,NULL",
      "'pending',0,NULL,NULL,NULL,NOW(),NULL,0,NULL,NULL,NULL",
      "'pending',0,NULL,NULL,NULL,NULL,NOW(),0,NULL,NULL,NULL",
      "'pending',0,NULL,NULL,NULL,NULL,NULL,1,NULL,NULL,NULL",
      "'pending',0,NULL,NULL,NULL,NULL,NULL,0,'forged',NULL,NULL",
      "'pending',0,NULL,NULL,NULL,NULL,NULL,0,NULL,'forged',NULL",
      "'pending',0,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NOW()",
    ];
    for (const initialState of invalidInitialStates) {
      await expectRejectedInRollback(
        `INSERT INTO harness_attempt_cleanup_outbox (
           run_id,attempt_id,lease_generation,cleanup_cause,status,
           claim_generation,claim_owner,claim_expires_at,receipt,confirmed_at,blocked_at,
           delivery_attempts,last_error_code,last_error_message,last_error_at
         )
         SELECT run_id,attempt_id,lease_generation+100,cleanup_cause,${initialState}
           FROM harness_attempt_cleanup_outbox
          WHERE attempt_id=$1`,
        [attemptId],
        /cleanup_outbox_invalid_initial_state/,
      );
    }
  });
});
