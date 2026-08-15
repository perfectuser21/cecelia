import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptCleanupOutboxStore } from '../../orchestrator/attempt-cleanup-outbox-store.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^cleanup_outbox_store_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedIntent(overrides = {}) {
  const taskId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  await testPool.query(
    "INSERT INTO tasks (id,title,status) VALUES ($1,$2,'in_progress')",
    [taskId, `cleanup outbox store ${taskId}`],
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
  const inserted = await testPool.query(
    `INSERT INTO harness_attempt_cleanup_outbox (
       run_id,attempt_id,lease_generation,cleanup_cause,available_at
     ) VALUES ($1,$2,0,'store_test',$3)
     RETURNING *`,
    [runId, attemptId, overrides.availableAt ?? new Date(Date.now() - 1_000)],
  );
  return inserted.rows[0];
}

async function expireClaim(id) {
  await testPool.query(
    `ALTER TABLE harness_attempt_cleanup_outbox
       DISABLE TRIGGER guard_harness_attempt_cleanup_outbox_mutation`,
  );
  try {
    await testPool.query(
      `UPDATE harness_attempt_cleanup_outbox
          SET claim_expires_at=NOW()-INTERVAL '1 second'
        WHERE id=$1`,
      [id],
    );
  } finally {
    await testPool.query(
      `ALTER TABLE harness_attempt_cleanup_outbox
         ENABLE TRIGGER guard_harness_attempt_cleanup_outbox_mutation`,
    );
  }
}

async function setClaimGeneration(id, generation) {
  await testPool.query(
    `ALTER TABLE harness_attempt_cleanup_outbox
       DISABLE TRIGGER guard_harness_attempt_cleanup_outbox_mutation`,
  );
  try {
    await testPool.query(
      'UPDATE harness_attempt_cleanup_outbox SET claim_generation=$2::bigint WHERE id=$1',
      [id, generation],
    );
  } finally {
    await testPool.query(
      `ALTER TABLE harness_attempt_cleanup_outbox
         ENABLE TRIGGER guard_harness_attempt_cleanup_outbox_mutation`,
    );
  }
}

async function reclaimIntent(store, id) {
  const first = (await store.claimBatch({ claimOwner: 'first', leaseSeconds: 30, limit: 1 }))[0];
  await expireClaim(id);
  const current = (await store.claimBatch({ claimOwner: 'second', leaseSeconds: 30, limit: 1 }))[0];
  return { first, current };
}

async function expectAllCasMiss(store, id, authority) {
  await expect(store.confirm(id, { ...authority, receipt: { removed: true } }))
    .resolves.toBeNull();
  await expect(store.retry(id, {
    ...authority, errorCode: 'old', errorMessage: 'old', retryAfterSeconds: 0,
  })).resolves.toBeNull();
  await expect(store.block(id, {
    ...authority, errorCode: 'old', errorMessage: 'old',
  })).resolves.toBeNull();
}

beforeAll(async () => {
  databaseName = `cleanup_outbox_store_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 5 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('attempt cleanup outbox claim/CAS store on PostgreSQL', () => {
  it('lets only one concurrent claimant own a due row', async () => {
    const intent = await seedIntent();
    const firstClient = await testPool.connect();
    const secondClient = await testPool.connect();
    try {
      await firstClient.query('BEGIN');
      await secondClient.query('BEGIN');
      const first = await createAttemptCleanupOutboxStore(firstClient).claimBatch({
        claimOwner: 'first', leaseSeconds: 30, limit: 1,
      });
      const second = await createAttemptCleanupOutboxStore(secondClient).claimBatch({
        claimOwner: 'second', leaseSeconds: 30, limit: 1,
      });
      expect(first.map((row) => row.id)).toEqual([intent.id]);
      expect(second).toEqual([]);
      await firstClient.query('COMMIT');
      await secondClient.query('COMMIT');
    } finally {
      await firstClient.query('ROLLBACK').catch(() => {});
      await secondClient.query('ROLLBACK').catch(() => {});
      firstClient.release();
      secondClient.release();
    }
  });

  it('does not steal a live lease and reclaims it after expiry', async () => {
    const intent = await seedIntent();
    const store = createAttemptCleanupOutboxStore(testPool);
    const first = (await store.claimBatch({ claimOwner: 'first', leaseSeconds: 30, limit: 1 }))[0];
    expect(await store.claimBatch({ claimOwner: 'second', leaseSeconds: 30, limit: 1 })).toEqual([]);

    await expireClaim(intent.id);
    const reclaimed = (await store.claimBatch({ claimOwner: 'second', leaseSeconds: 30, limit: 1 }))[0];
    expect(reclaimed).toMatchObject({
      id: intent.id,
      claim_owner: 'second',
      claim_generation: String(BigInt(first.claim_generation) + 1n),
      delivery_attempts: 2,
    });
  });

  it('fences a stale owner even when its generation is current', async () => {
    const intent = await seedIntent();
    const store = createAttemptCleanupOutboxStore(testPool);
    const { first, current } = await reclaimIntent(store, intent.id);

    await expectAllCasMiss(store, intent.id, {
      claimOwner: first.claim_owner,
      claimGeneration: current.claim_generation,
    });
    await expect(store.confirm(intent.id, {
      claimOwner: current.claim_owner,
      claimGeneration: current.claim_generation,
      receipt: { removed: true },
    })).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('fences a stale generation even when its owner is current', async () => {
    const intent = await seedIntent();
    const store = createAttemptCleanupOutboxStore(testPool);
    const { first, current } = await reclaimIntent(store, intent.id);

    await expectAllCasMiss(store, intent.id, {
      claimOwner: current.claim_owner,
      claimGeneration: first.claim_generation,
    });
    await expect(store.confirm(intent.id, {
      claimOwner: current.claim_owner,
      claimGeneration: current.claim_generation,
      receipt: { removed: true, remoteState: 'gone' },
    })).resolves.toMatchObject({
      status: 'confirmed',
      claim_owner: 'second',
      claim_generation: current.claim_generation,
      receipt: { removed: true, remoteState: 'gone' },
    });
  });

  it('defers retries until available_at and never claims blocked rows', async () => {
    const retryIntent = await seedIntent();
    const blockIntent = await seedIntent();
    const store = createAttemptCleanupOutboxStore(testPool);
    const claims = await store.claimBatch({ claimOwner: 'worker', leaseSeconds: 30, limit: 2 });
    const retryClaim = claims.find((row) => row.id === retryIntent.id);
    const blockClaim = claims.find((row) => row.id === blockIntent.id);
    await store.retry(retryIntent.id, {
      claimOwner: retryClaim.claim_owner,
      claimGeneration: retryClaim.claim_generation,
      errorCode: 'transport_failed',
      errorMessage: 'token=secret-value',
      retryAfterSeconds: 60,
    });
    await store.block(blockIntent.id, {
      claimOwner: blockClaim.claim_owner,
      claimGeneration: blockClaim.claim_generation,
      errorCode: 'unsupported_transport',
      errorMessage: 'password=hunter2',
    });

    expect(await store.claimBatch({ claimOwner: 'other', leaseSeconds: 30, limit: 10 })).toEqual([]);
    const persisted = await testPool.query(
      `SELECT id,status,claim_owner,claim_generation::text AS claim_generation,
              available_at > NOW() AS deferred,last_error_message
         FROM harness_attempt_cleanup_outbox
        WHERE id=ANY($1::uuid[])
        ORDER BY id`,
      [[retryIntent.id, blockIntent.id]],
    );
    expect(persisted.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: retryIntent.id, status: 'pending', claim_owner: null, deferred: true }),
      expect.objectContaining({ id: blockIntent.id, status: 'blocked', claim_owner: null }),
    ]));
    expect(persisted.rows.map((row) => row.last_error_message).join(' ')).not.toMatch(/secret-value|hunter2/);
  });

  it('allows exactly one winner between expired confirmation and reclaim', async () => {
    const intent = await seedIntent();
    const store = createAttemptCleanupOutboxStore(testPool);
    const claim = (await store.claimBatch({ claimOwner: 'old', leaseSeconds: 30, limit: 1 }))[0];
    await expireClaim(intent.id);

    const [confirmed, reclaimed] = await Promise.all([
      store.confirm(intent.id, {
        claimOwner: claim.claim_owner,
        claimGeneration: claim.claim_generation,
        receipt: { removed: true },
      }),
      store.claimBatch({ claimOwner: 'new', leaseSeconds: 30, limit: 1 }),
    ]);
    expect(Number(confirmed !== null) + Number(reclaimed.length === 1)).toBe(1);
    const final = (await testPool.query(
      'SELECT status,claim_owner,claim_generation::text AS claim_generation FROM harness_attempt_cleanup_outbox WHERE id=$1',
      [intent.id],
    )).rows[0];
    if (confirmed) expect(final).toMatchObject({ status: 'confirmed', claim_owner: 'old' });
    else expect(final).toMatchObject({
      status: 'leased',
      claim_owner: 'new',
      claim_generation: String(BigInt(claim.claim_generation) + 1n),
    });
  });

  it('preserves claim generations above Number.MAX_SAFE_INTEGER without loss', async () => {
    const intent = await seedIntent();
    await setClaimGeneration(intent.id, '9007199254740992');
    const claim = (await createAttemptCleanupOutboxStore(testPool).claimBatch({
      claimOwner: 'bigint', leaseSeconds: 30, limit: 1,
    }))[0];
    expect(claim.claim_generation).toBe('9007199254740993');
    expect(typeof claim.claim_generation).toBe('string');
  });
});
