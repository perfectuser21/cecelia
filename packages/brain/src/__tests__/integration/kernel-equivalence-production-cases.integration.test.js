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
  createPostgresProductionCaseStore,
} from '../../lib/kernel-equivalence-production-case-store.js';

const migration = readFileSync(
  new URL(
    '../../../migrations/377_kernel_equivalence_production_cases.sql',
    import.meta.url,
  ),
  'utf8',
);
const schemaName =
  `kernel_equivalence_cases_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_RUN_ID = '33333333-3333-4333-8333-333333333333';
const CASE_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

let adminPool;
let pool;

function caseColumns(caseId = CASE_ID, resourceId = 'resource-1') {
  const prefix = `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/workspace/`;
  return [
    caseId,
    'KERNEL-P1-09-DEVGATE-TDD-DOD::codex::normal',
    'KERNEL-P1-09-DEVGATE-TDD-DOD',
    'codex',
    'normal',
    'kernel.quality.devgate',
    'kernel.drill.devgate_tdd_dod.v1',
    RUN_ID,
    ATTEMPT_ID,
    'a'.repeat(40),
    '1.268.15',
    '19.7.1',
    'ephemeral_workspace',
    prefix,
    resourceId,
    `${prefix}${resourceId}`,
  ];
}

async function insertCase(values = caseColumns()) {
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

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  pool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schemaName}`,
    max: 4,
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
    INSERT INTO initiative_runs (id) VALUES
      ('${RUN_ID}'),
      ('${OTHER_RUN_ID}');
    INSERT INTO harness_attempts (id, run_id)
      VALUES ('${ATTEMPT_ID}', '${RUN_ID}');
  `);
  await pool.query(migration);
  await pool.query(migration);
}, 15_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('production equivalence cases on real PostgreSQL', () => {
  it('creates one exact case, lease, and allowlisted event', async () => {
    await expect(insertCase()).resolves.toMatchObject({ rowCount: 1 });
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_case_leases
         (case_id, owner_id, state, lease_expires_at)
       VALUES ($1, $2, 'prepared', clock_timestamp() + interval '5 minutes')`,
      [CASE_ID, `brain:${RUN_ID}`],
    )).resolves.toMatchObject({ rowCount: 1 });
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_case_events
         (event_id, case_id, generation, event_type, status, evidence_ref,
          before_hash, after_hash, late_effect_risk)
       VALUES ($1, $2, 1, 'prepared', 'confirmed', $3, NULL, $4, false)`,
      [
        EVENT_ID,
        CASE_ID,
        `db:kernel-equivalence-production-cases/${CASE_ID}/1`,
        'b'.repeat(64),
      ],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects cross-run ownership and duplicate resource identity', async () => {
    const wrongRun = caseColumns(
      '66666666-6666-4666-8666-666666666666',
      'resource-2',
    );
    wrongRun[7] = OTHER_RUN_ID;
    await expect(insertCase(wrongRun)).rejects.toThrow(
      /attempt\/run ownership mismatch/i,
    );

    const duplicateRef = caseColumns(
      '77777777-7777-4777-8777-777777777777',
      'resource-1',
    );
    await expect(insertCase(duplicateRef)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('fences lease owner, generation, transition, and database expiry', async () => {
    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET generation = generation + 1,
              state = 'cancelling',
              updated_at = clock_timestamp() + interval '1 millisecond'
        WHERE case_id = $1 AND owner_id = $2 AND generation = 1`,
      [CASE_ID, `brain:${RUN_ID}`],
    )).resolves.toMatchObject({ rowCount: 1 });

    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET owner_id = 'foreign',
              generation = generation + 1,
              updated_at = clock_timestamp() + interval '1 millisecond'
        WHERE case_id = $1`,
      [CASE_ID],
    )).rejects.toThrow(/lease advance is invalid/i);

    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET generation = generation + 2,
              updated_at = clock_timestamp() + interval '1 millisecond'
        WHERE case_id = $1`,
      [CASE_ID],
    )).rejects.toThrow(/lease advance is invalid/i);

    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET generation = generation + 1,
              state = 'prepared',
              lease_expires_at = clock_timestamp() - interval '1 second',
              updated_at = clock_timestamp() + interval '1 millisecond'
        WHERE case_id = $1`,
      [CASE_ID],
    )).rejects.toThrow(/lease is expired|transition is invalid/i);
  });

  it('blocks mutation and erasure of immutable evidence', async () => {
    for (const statement of [
      `UPDATE kernel_equivalence_production_cases
          SET artifact_sha = '${'c'.repeat(40)}'
        WHERE case_id = '${CASE_ID}'`,
      `DELETE FROM kernel_equivalence_production_cases
        WHERE case_id = '${CASE_ID}'`,
      `UPDATE kernel_equivalence_production_case_events
          SET status = 'denied'
        WHERE event_id = '${EVENT_ID}'`,
      'TRUNCATE kernel_equivalence_production_case_events',
      'DELETE FROM kernel_equivalence_production_case_leases',
      'TRUNCATE kernel_equivalence_production_case_leases',
    ]) {
      await expect(pool.query(statement)).rejects.toThrow(/append-only/i);
    }
  });

  it('prepares and generation-fences a case through the production store', async () => {
    const generated = [
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    const store = createPostgresProductionCaseStore({
      pool,
      randomUUID: () => generated.shift(),
    });
    const prefix =
      `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/controller/`;
    const prepared = await store.prepareCase({
      adapter_id: 'kernel.drill.controller_session_isolation.v1',
      artifact_sha: 'd'.repeat(40),
      attempt_id: ATTEMPT_ID,
      behavior_id: 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
      brain_version: '1.268.16',
      cell_id:
        'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::grok::recovery',
      engine_version: '19.7.1',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      provider: 'grok',
      resource_id: 'controller-case-1',
      resource_prefix: prefix,
      resource_ref: `${prefix}controller-case-1`,
      resource_type: 'ephemeral_run',
      run_id: RUN_ID,
      scenario: 'recovery',
      seam_id: 'kernel.controller.attempt_ownership',
    }, { timeoutMs: 2_000 });

    expect(prepared).toMatchObject({
      case_id: '88888888-8888-4888-8888-888888888888',
      generation: 1,
      state: 'prepared',
      resource_id: 'controller-case-1',
    });

    const cancelling = await store.transitionCase({
      after_hash: null,
      before_hash: 'e'.repeat(64),
      case_id: prepared.case_id,
      event_type: 'cancel_requested',
      evidence_ref:
        `db:kernel-equivalence-production-cases/${prepared.case_id}/2/cancel_requested`,
      expected_generation: 1,
      from_state: 'prepared',
      late_effect_risk: false,
      lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
      status: 'confirmed',
      to_state: 'cancelling',
    }, { timeoutMs: 2_000 });
    expect(cancelling).toMatchObject({
      generation: 2,
      state: 'cancelling',
    });

    const cleaned = await store.transitionCase({
      after_hash: 'f'.repeat(64),
      before_hash: 'e'.repeat(64),
      case_id: prepared.case_id,
      event_type: 'cleanup_confirmed',
      evidence_ref:
        `db:kernel-equivalence-production-cases/${prepared.case_id}/3/cleanup_confirmed`,
      expected_generation: 2,
      from_state: 'cancelling',
      late_effect_risk: false,
      lease_expires_at: null,
      status: 'confirmed',
      to_state: 'cleaned',
    }, { timeoutMs: 2_000 });
    expect(cleaned).toMatchObject({
      generation: 3,
      state: 'cleaned',
    });

    const evidence = await pool.query(
      `SELECT generation, event_type, status, late_effect_risk
         FROM kernel_equivalence_production_case_events
        WHERE case_id = $1
        ORDER BY generation`,
      [prepared.case_id],
    );
    expect(evidence.rows).toEqual([
      {
        generation: '1',
        event_type: 'prepared',
        status: 'confirmed',
        late_effect_risk: false,
      },
      {
        generation: '2',
        event_type: 'cancel_requested',
        status: 'confirmed',
        late_effect_risk: false,
      },
      {
        generation: '3',
        event_type: 'cleanup_confirmed',
        status: 'confirmed',
        late_effect_risk: false,
      },
    ]);
  });
});
