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
    await expect(resolvePredecessor({
      cell_id: violation.cell.cell_id,
      behavior_id: violation.cell.behavior_id,
      provider: violation.cell.provider,
      scenario: 'violation',
      run_id: violation.grant.run_id,
      attempt_id: violation.grant.attempt_id,
      artifact_sha: violation.grant.artifact_sha,
      resource_id: violation.grant.resource_id,
      resource_ref: violation.grant.resource_ref,
      seam_id: violation.cell.seam_id,
      adapter_id: violation.cell.adapter_id,
    })).resolves.toEqual({
      grant: violation.grant,
      receipt: violation.receipt,
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
    ]) {
      await expect(pool.query(statement)).rejects.toMatchObject({
        code: 'P0001',
      });
    }
  });
});
