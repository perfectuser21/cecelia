import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  createPostgresAuditSink,
  createPostgresBundleChainStore,
  createPostgresNonceConsumer,
  createPostgresPredecessorResolver,
} from '../../lib/kernel-equivalence-postgres-runtime.js';
import {
  sha256Canonical,
} from '../../lib/kernel-equivalence-receipts.js';
import {
  FIXTURE_ATTEMPT_ID,
  FIXTURE_RUN_ID,
  createTrustFixture,
  fixtureBundle,
  fixtureCell,
  fixtureGrant,
  fixtureReceipt,
} from '../../lib/__tests__/kernel-equivalence-test-fixtures.js';

const migration = readFileSync(
  new URL('../../../migrations/375_kernel_equivalence_runtime.sql', import.meta.url),
  'utf8',
);
const schemaName =
  `kernel_equivalence_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;

let adminPool;
let pool;

function bundleValue(behaviorId, scenario = 'normal', previousBundleHash = null) {
  const keys = createTrustFixture();
  const cell = fixtureCell({ behaviorId, scenario });
  const grant = fixtureGrant(keys, cell);
  const receipt = fixtureReceipt(keys, grant, cell);
  const bundle = fixtureBundle(
    keys,
    cell,
    grant,
    [receipt],
    [grant],
    previousBundleHash,
  );
  return {
    cell,
    grant,
    receipt,
    bundle,
    hash: sha256Canonical(bundle),
  };
}

async function insertOffChainBundle(value) {
  await pool.query(
    `INSERT INTO kernel_equivalence_receipt_bundles
       (chain_id, bundle_hash, previous_bundle_hash, bundle_id, cell_id,
        behavior_id, provider, scenario, run_id, attempt_id, artifact_sha,
        resource_id, resource_ref, seam_id, adapter_id, grant_id, bundle)
     VALUES
       ('kernel-equivalence-v1', $1, NULL, $2, $3, $4, $5, $6, $7::uuid,
        $8::uuid, $9, $10, $11, $12, $13, $14::uuid, $15::jsonb)`,
    [
      value.hash,
      value.bundle.bundle_id,
      value.bundle.cell_id,
      value.bundle.behavior_id,
      value.bundle.provider,
      value.bundle.scenario,
      value.bundle.run_id,
      value.bundle.attempt_id,
      value.bundle.artifact_sha,
      value.bundle.resource_id,
      value.bundle.resource_ref,
      value.bundle.seam_id,
      value.bundle.adapter_id,
      value.bundle.grant_id,
      JSON.stringify(value.bundle),
    ],
  );
}

function predecessorRequest(value) {
  return {
    cell_id: value.cell.cell_id,
    behavior_id: value.cell.behavior_id,
    provider: value.cell.provider,
    scenario: 'violation',
    run_id: value.grant.run_id,
    attempt_id: value.grant.attempt_id,
    artifact_sha: value.grant.artifact_sha,
    resource_id: value.grant.resource_id,
    resource_ref: value.grant.resource_ref,
    seam_id: value.cell.seam_id,
    adapter_id: value.cell.adapter_id,
  };
}

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 4 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  pool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schemaName}`,
    max: 8,
  });
  await pool.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY
    );
    CREATE TABLE harness_attempts (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES initiative_runs(id)
    );
  `);
  await pool.query(migration);
  await pool.query(migration);
  await pool.query(
    'INSERT INTO initiative_runs (id) VALUES ($1)',
    [FIXTURE_RUN_ID],
  );
  await pool.query(
    'INSERT INTO harness_attempts (id, run_id) VALUES ($1, $2)',
    [FIXTURE_ATTEMPT_ID, FIXTURE_RUN_ID],
  );
}, 15_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('trusted equivalence runtime on real PostgreSQL', () => {
  it('allows exactly one consumer for two concurrent claims on one nonce', async () => {
    const consume = createPostgresNonceConsumer({ pool });
    const nonce = randomUUID();
    const common = {
      nonce,
      cell_id: 'KERNEL-P0-MERGE-AUTHORITY::codex::normal',
      run_id: FIXTURE_RUN_ID,
      attempt_id: FIXTURE_ATTEMPT_ID,
      expires_at: '2099-01-01T00:00:00.000Z',
    };
    const results = await Promise.all([
      consume({ ...common, grant_id: randomUUID() }),
      consume({ ...common, grant_id: randomUUID() }),
    ]);

    expect(results.filter(({ consumed }) => consumed)).toHaveLength(1);
    const durable = await pool.query(
      `SELECT grant_id, nonce
         FROM kernel_equivalence_execution_nonces
        WHERE nonce = $1`,
      [nonce],
    );
    expect(durable.rowCount).toBe(1);
  });

  it('CAS-commits one same-head winner and a fresh instance reads it durably', async () => {
    const first = bundleValue('KERNEL-P0-MERGE-AUTHORITY');
    const second = bundleValue('KERNEL-P0-SECOND-AUTHORITY');
    const firstStore = createPostgresBundleChainStore({ pool });
    const secondStore = createPostgresBundleChainStore({ pool });
    await Promise.all([
      firstStore.getCheckpoint(),
      secondStore.getCheckpoint(),
    ]);

    const results = await Promise.all([
      firstStore.commit({
        bundle: first.bundle,
        bundle_hash: first.hash,
        previous_head_hash: null,
      }),
      secondStore.commit({
        bundle: second.bundle,
        bundle_hash: second.hash,
        previous_head_hash: null,
      }),
    ]);
    const winners = results
      .map((result, index) => ({ result, value: [first, second][index] }))
      .filter(({ result }) => result.committed);

    expect(winners).toHaveLength(1);
    const ledger = await pool.query(
      `SELECT bundle_hash
         FROM kernel_equivalence_receipt_bundles`,
    );
    expect(ledger.rows).toEqual([{ bundle_hash: winners[0].value.hash }]);
    const head = await pool.query(
      `SELECT head_hash, revision
         FROM kernel_equivalence_bundle_chain_heads
        WHERE chain_id = 'kernel-equivalence-v1'`,
    );
    expect(head.rows).toEqual([{
      head_hash: winners[0].value.hash,
      revision: '1',
    }]);

    const restartedStore = createPostgresBundleChainStore({ pool });
    await expect(restartedStore.readBundle(winners[0].value.hash))
      .resolves.toEqual(winners[0].value.bundle);

    const violation = bundleValue(
      'KERNEL-P0-VIOLATION-AUTHORITY',
      'violation',
      winners[0].value.hash,
    );
    await restartedStore.getCheckpoint();
    await expect(restartedStore.commit({
      bundle: violation.bundle,
      bundle_hash: violation.hash,
      previous_head_hash: winners[0].value.hash,
    })).resolves.toMatchObject({ committed: true });
    const resolvePredecessor = createPostgresPredecessorResolver({ pool });
    await expect(resolvePredecessor(predecessorRequest(violation)))
      .resolves.toEqual({
      bundle_hash: violation.hash,
      bundle: violation.bundle,
    });

    const rogue = bundleValue(
      'KERNEL-P0-ROGUE-VIOLATION',
      'violation',
    );
    await insertOffChainBundle(rogue);
    await expect(resolvePredecessor(predecessorRequest(rogue)))
      .rejects.toMatchObject({
        code: 'recovery_predecessor_unavailable',
      });
  });

  it('rejects mutation and truncation of every append-only ledger', async () => {
    const persistAudit = createPostgresAuditSink({
      pool,
      randomUUID: () => randomUUID(),
    });
    await persistAudit({
      schema_version: 'kernel-equivalence-denial-audit/v1',
      occurred_at: '2026-07-28T12:02:00.000Z',
      status: 'blocked',
      code: 'grant_nonce_replay',
      stage: 'nonce_consumption',
      cell_id: 'KERNEL-P0-MERGE-AUTHORITY::codex::normal',
      behavior_id: 'KERNEL-P0-MERGE-AUTHORITY',
      provider: 'codex',
      scenario: 'normal',
      run_id: FIXTURE_RUN_ID,
      attempt_id: FIXTURE_ATTEMPT_ID,
      late_effect_risk: false,
    });

    for (const statement of [
      `UPDATE kernel_equivalence_execution_nonces
          SET expires_at = expires_at + interval '1 second'`,
      'DELETE FROM kernel_equivalence_denial_audits',
      `UPDATE kernel_equivalence_receipt_bundles
          SET resource_ref = resource_ref || '-tampered'`,
      'TRUNCATE kernel_equivalence_execution_nonces',
      'TRUNCATE kernel_equivalence_denial_audits',
      'TRUNCATE kernel_equivalence_receipt_bundles',
      'DELETE FROM kernel_equivalence_bundle_chain_heads',
      `UPDATE kernel_equivalence_bundle_chain_heads
          SET genesis_hash = repeat('f', 64)`,
      `UPDATE kernel_equivalence_bundle_chain_heads
          SET revision = revision + 2`,
    ]) {
      await expect(pool.query(statement)).rejects.toMatchObject({
        code: 'P0001',
      });
    }
  });

  it('settles a lock timeout without a late bundle or head commit', async () => {
    const before = await pool.query(
      `SELECT genesis_hash, head_hash, revision
         FROM kernel_equivalence_bundle_chain_heads
        WHERE chain_id = 'kernel-equivalence-v1'`,
    );
    const checkpoint = before.rows[0];
    const value = bundleValue(
      'KERNEL-P0-TIMEOUT-SETTLEMENT',
      'normal',
      checkpoint.head_hash,
    );
    const store = createPostgresBundleChainStore({ pool });
    await store.getCheckpoint();
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(
      `SELECT 1
         FROM kernel_equivalence_bundle_chain_heads
        WHERE chain_id = 'kernel-equivalence-v1'
        FOR UPDATE`,
    );
    let released = false;
    const delayedRelease = new Promise((resolve) => {
      setTimeout(async () => {
        await blocker.query('ROLLBACK');
        blocker.release();
        released = true;
        resolve();
      }, 500);
    });

    await expect(store.commit({
      bundle: value.bundle,
      bundle_hash: value.hash,
      previous_head_hash: checkpoint.head_hash,
      timeout_ms: 30,
    })).rejects.toMatchObject({
      code: 'bundle_chain_commit_timeout',
    });
    expect(released).toBe(false);
    await delayedRelease;

    const after = await pool.query(
      `SELECT genesis_hash, head_hash, revision
         FROM kernel_equivalence_bundle_chain_heads
        WHERE chain_id = 'kernel-equivalence-v1'`,
    );
    expect(after.rows).toEqual(before.rows);
    const bundle = await pool.query(
      `SELECT 1
         FROM kernel_equivalence_receipt_bundles
        WHERE bundle_hash = $1`,
      [value.hash],
    );
    expect(bundle.rowCount).toBe(0);
  });
});
