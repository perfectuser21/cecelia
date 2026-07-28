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
  createPostgresBundleChainStore,
  createPostgresNonceConsumer,
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

function bundleValue(behaviorId) {
  const keys = createTrustFixture();
  const cell = fixtureCell({ behaviorId });
  const grant = fixtureGrant(keys, cell);
  const receipt = fixtureReceipt(keys, grant, cell);
  const bundle = fixtureBundle(keys, cell, grant, [receipt]);
  return { bundle, hash: sha256Canonical(bundle) };
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
  });
});
