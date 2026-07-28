import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const migration378Url = new URL(
  '../../../migrations/378_kernel_equivalence_production_case_authority.sql',
  import.meta.url,
);
const migration378Path = fileURLToPath(migration378Url);
const migration376 = readFileSync(
  new URL(
    '../../../migrations/376_kernel_equivalence_runtime.sql',
    import.meta.url,
  ),
  'utf8',
);
const migration377 = readFileSync(
  new URL(
    '../../../migrations/377_kernel_equivalence_production_cases.sql',
    import.meta.url,
  ),
  'utf8',
);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const VALID_CASE_ID = '33333333-3333-4333-8333-333333333333';
const INVALID_CASE_ID = '44444444-4444-4444-8444-444444444444';
const OWNER = 'brain.kernel_equivalence.production_cases';

const LEGACY_377_CB805_COMPAT_DDL = `
  CREATE TABLE schema_version (
    version VARCHAR(10) PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
  );
  CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
  CREATE TABLE harness_attempts (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES initiative_runs(id)
  );
  CREATE TABLE kernel_equivalence_production_cases (
    case_id UUID PRIMARY KEY,
    cell_id TEXT NOT NULL,
    behavior_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'grok')),
    scenario TEXT NOT NULL CHECK (
      scenario IN ('normal', 'violation', 'recovery')
    ),
    seam_id TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    run_id UUID NOT NULL REFERENCES initiative_runs(id),
    attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
    artifact_sha TEXT NOT NULL CHECK (artifact_sha ~ '^[0-9a-f]{40}$'),
    brain_version TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_prefix TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    resource_ref TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (cell_id, run_id, attempt_id, resource_id),
    CHECK (cell_id = behavior_id || '::' || provider || '::' || scenario),
    CHECK (expires_at > created_at)
  );
  CREATE TABLE kernel_equivalence_production_case_leases (
    case_id UUID PRIMARY KEY
      REFERENCES kernel_equivalence_production_cases(case_id),
    owner_id TEXT NOT NULL,
    generation BIGINT NOT NULL DEFAULT 1 CHECK (generation >= 1),
    state TEXT NOT NULL CHECK (state IN (
      'prepared',
      'cancelling',
      'cancelled',
      'cleanup_unconfirmed',
      'cleaned'
    )),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
  CREATE TABLE kernel_equivalence_production_case_events (
    event_id UUID PRIMARY KEY,
    case_id UUID NOT NULL
      REFERENCES kernel_equivalence_production_cases(case_id),
    generation BIGINT NOT NULL CHECK (generation >= 1),
    event_type TEXT NOT NULL CHECK (event_type IN (
      'prepared',
      'cancel_requested',
      'cancel_confirmed',
      'cleanup_confirmed',
      'cleanup_unconfirmed',
      'inspection'
    )),
    status TEXT NOT NULL CHECK (
      status IN ('confirmed', 'denied', 'unconfirmed')
    ),
    evidence_ref TEXT NOT NULL,
    before_hash TEXT,
    after_hash TEXT,
    late_effect_risk BOOLEAN NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (case_id, generation, event_type)
  );
  INSERT INTO initiative_runs (id) VALUES ('${RUN_ID}');
  INSERT INTO harness_attempts (id, run_id)
    VALUES ('${ATTEMPT_ID}', '${RUN_ID}');
  INSERT INTO schema_version (version, description)
    VALUES ('377', 'kernel_equivalence_production_cases');
`;

const schemas = [];

function exactMigration378() {
  expect(existsSync(migration378Path)).toBe(true);
  return readFileSync(migration378Url, 'utf8');
}

async function legacyPool() {
  const admin = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
  const schema =
    `kernel_case_upgrade_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schema}`,
    max: 4,
  });
  await pool.query(LEGACY_377_CB805_COMPAT_DDL);
  schemas.push({ admin, pool, schema });
  return pool;
}

async function freshPool() {
  const admin = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
  const schema =
    `kernel_case_fresh_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schema}`,
    max: 4,
  });
  await pool.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
    );
    CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
    CREATE TABLE harness_attempts (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES initiative_runs(id)
    );
  `);
  schemas.push({ admin, pool, schema });
  return pool;
}

function caseValues({
  caseId = VALID_CASE_ID,
  canonical = true,
  resourceId = 'legacy-resource',
} = {}) {
  const prefix =
    `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/upgrade/`;
  return [
    caseId,
    'KERNEL-P1-09-DEVGATE-TDD-DOD::codex::normal',
    'KERNEL-P1-09-DEVGATE-TDD-DOD',
    'codex',
    'normal',
    canonical
      ? 'kernel.quality.devgate'
      : 'kernel.release.staging_promotion',
    canonical
      ? 'kernel.drill.devgate_tdd_dod.v1'
      : 'kernel.drill.release_promotion.v1',
    RUN_ID,
    ATTEMPT_ID,
    'a'.repeat(40),
    '1.268.17',
    '19.7.1',
    canonical ? 'ephemeral_workspace' : 'ephemeral_staging',
    prefix,
    resourceId,
    `${prefix}${resourceId}`,
  ];
}

async function insertCase(pool, values) {
  return pool.query(
    `INSERT INTO kernel_equivalence_production_cases
       (case_id, cell_id, behavior_id, provider, scenario, seam_id,
        adapter_id, run_id, attempt_id, artifact_sha, brain_version,
        engine_version, resource_type, resource_prefix, resource_id,
        resource_ref, expires_at)
     VALUES
       ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10, $11,
        $12, $13, $14, $15, $16, clock_timestamp() + interval '10 minutes')`,
    values,
  );
}

async function insertPreparedLifecycle(pool, caseId, eventId) {
  await pool.query(
    `INSERT INTO kernel_equivalence_production_case_leases
       (case_id, owner_id, generation, state, lease_expires_at)
     VALUES
       ($1, $2, 1, 'prepared', clock_timestamp() + interval '5 minutes')`,
    [caseId, OWNER],
  );
  await pool.query(
    `INSERT INTO kernel_equivalence_production_case_events
       (event_id, case_id, generation, event_type, status, evidence_ref,
        before_hash, after_hash, late_effect_risk)
     VALUES ($1, $2, 1, 'prepared', 'confirmed', $3, NULL, NULL, false)`,
    [
      eventId,
      caseId,
      `db:kernel-equivalence-production-cases/${caseId}/1/prepared`,
    ],
  );
}

afterEach(async () => {
  while (schemas.length > 0) {
    const { admin, pool, schema } = schemas.pop();
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

describe('migration 378 production-case authority upgrade', () => {
  it('rejects a cb805-era ledger containing a non-canonical tuple', async () => {
    const pool = await legacyPool();
    await insertCase(pool, caseValues({
      caseId: INVALID_CASE_ID,
      canonical: false,
      resourceId: 'forged-tuple',
    }));
    await insertPreparedLifecycle(
      pool,
      INVALID_CASE_ID,
      '55555555-5555-4555-8555-555555555555',
    );

    await expect(pool.query(exactMigration378())).rejects.toThrow(
      /non-canonical behavior tuple/i,
    );
  });

  it('rejects incomplete or forged cb805-era lifecycle state', async () => {
    const incomplete = await legacyPool();
    await insertCase(incomplete, caseValues());
    await expect(incomplete.query(exactMigration378())).rejects.toThrow(
      /invalid production case lifecycle/i,
    );

    const forged = await legacyPool();
    await insertCase(forged, caseValues());
    await forged.query(
      `INSERT INTO kernel_equivalence_production_case_leases
         (case_id, owner_id, generation, state, lease_expires_at)
       VALUES
         ($1, 'forged-owner', 7, 'cancelling',
          clock_timestamp() + interval '5 minutes')`,
      [VALID_CASE_ID],
    );
    await forged.query(
      `INSERT INTO kernel_equivalence_production_case_events
         (event_id, case_id, generation, event_type, status, evidence_ref,
          before_hash, after_hash, late_effect_risk)
       VALUES
         ('77777777-7777-4777-8777-777777777777', $1, 7,
          'cancel_requested', 'confirmed', $2, NULL, NULL, false)`,
      [
        VALID_CASE_ID,
        `db:kernel-equivalence-production-cases/${VALID_CASE_ID}/`
          + '7/cancel_requested',
      ],
    );
    await expect(forged.query(exactMigration378())).rejects.toThrow(
      /invalid production case lifecycle/i,
    );
  });

  it('upgrades a valid cb805-era ledger and remains fail-closed on rerun', async () => {
    const pool = await legacyPool();
    await insertCase(pool, caseValues());
    await insertPreparedLifecycle(
      pool,
      VALID_CASE_ID,
      '66666666-6666-4666-8666-666666666666',
    );

    await expect(pool.query(exactMigration378())).resolves.toBeDefined();
    await expect(pool.query(exactMigration378())).resolves.toBeDefined();

    const constraint = await pool.query(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conrelid =
                'kernel_equivalence_production_cases'::regclass
          AND conname =
                'ck_kernel_equivalence_production_case_canonical_tuple'`,
    );
    expect(constraint.rows).toEqual([{ convalidated: true }]);

    await expect(insertCase(pool, caseValues({
      caseId: INVALID_CASE_ID,
      canonical: false,
      resourceId: 'post-upgrade-forgery',
    }))).rejects.toMatchObject({ code: '23514' });
  });

  it('backports the initial lease and atomic lifecycle guards', async () => {
    const pool = await legacyPool();
    await pool.query(exactMigration378());

    await pool.query('BEGIN');
    await insertCase(pool, caseValues());
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_case_leases
         (case_id, owner_id, generation, state, lease_expires_at)
       VALUES
         ($1, 'forged-owner', 7, 'prepared',
          clock_timestamp() + interval '5 minutes')`,
      [VALID_CASE_ID],
    )).rejects.toThrow(/lease insert is invalid/i);
    await pool.query('ROLLBACK');

    await expect(insertCase(pool, caseValues({
      caseId: INVALID_CASE_ID,
      resourceId: 'missing-lifecycle',
    }))).rejects.toThrow(/lease event is missing/i);
  });

  it('applies cleanly after fresh trusted-runtime migrations 376 and 377', async () => {
    const pool = await freshPool();

    await pool.query(migration376);
    await pool.query(migration377);
    await pool.query(exactMigration378());
    await pool.query(exactMigration378());

    const versions = await pool.query(
      `SELECT version
         FROM schema_version
        WHERE version IN ('376', '377', '378')
        ORDER BY version`,
    );
    expect(versions.rows).toEqual([
      { version: '376' },
      { version: '377' },
      { version: '378' },
    ]);
  });
});
