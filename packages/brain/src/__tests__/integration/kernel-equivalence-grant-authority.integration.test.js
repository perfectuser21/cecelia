import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const migrationUrl = new URL(
  '../../../migrations/382_kernel_equivalence_grant_authority.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, 'utf8')
  : '';
const schemaName =
  `kernel_grant_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const appRole = `kernel_grant_app_${process.pid}_${randomUUID()
  .replaceAll('-', '')}`;
const quotedAppRole = `"${appRole}"`;
const integrationMigration = migration.replaceAll(
  'SET search_path = public, pg_temp',
  `SET search_path = ${schemaName}, pg_temp`,
);
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const CONTROLLER_ID = '44444444-4444-4444-8444-444444444444';
const RUNTIME_ID = '55555555-5555-4555-8555-555555555555';
const CELL_ID =
  'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::normal';
const RESOURCE_TYPE = 'ephemeral_run';
const RESOURCE_ID = ATTEMPT_ID;
const RESOURCE_REF =
  `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/controller/${ATTEMPT_ID}`;
const RESOURCE_PREFIX =
  `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/controller/`;
const DIGEST = 'a'.repeat(64);

let adminPool;
let pool;

function signedGrant({
  expiresInMs = 120_000,
  grantId = randomUUID(),
} = {}) {
  return {
    schema_version: 'kernel-equivalence-execution-grant/v1',
    grant_id: grantId,
    key_id: 'kernel-equivalence-test-key',
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    nonce: randomUUID(),
    cell_id: CELL_ID,
    behavior_id: 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
    provider: 'codex',
    scenario: 'normal',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    artifact_sha: 'a'.repeat(40),
    brain_version: '1.268.29',
    engine_version: '19.7.1',
    environment: 'isolated',
    resource_id: RESOURCE_ID,
    resource_ref: RESOURCE_REF,
    resource_prefix: RESOURCE_PREFIX,
    seam_id: 'kernel.controller.attempt_ownership',
    adapter_id: 'kernel.drill.controller_session_isolation.v1',
    scopes: ['isolated_effect'],
    signature: 'test-signature',
  };
}

async function registerGrant({
  caseId = CASE_ID,
  digest = DIGEST,
  expiresInMs = 120_000,
  grantOverrides = {},
  grantId = randomUUID(),
} = {}) {
  const grant = {
    ...signedGrant({ expiresInMs, grantId }),
    ...grantOverrides,
  };
  await pool.query(
    `SELECT *
       FROM kernel_equivalence_register_grant_authority(
         $1::uuid, $2::jsonb, $3
       )`,
    [caseId, JSON.stringify(grant), digest],
  );
  return grantId;
}

async function appendEvent({
  actorId,
  details,
  digest = DIGEST,
  grantId,
  state,
}) {
  const eventActor = actorId
    ?? (state === 'published' ? CONTROLLER_ID : RUNTIME_ID);
  const eventDetails = details ?? (
    state.startsWith('effect_') || state === 'aborted_before_effect'
      ? { intent_generation: 2 }
      : {}
  );
  return pool.query(
    `SELECT *
       FROM kernel_equivalence_append_grant_event(
         $1::uuid, $2, $3, $4::uuid, $5::jsonb
       )`,
    [grantId, digest, state, eventActor, JSON.stringify(eventDetails)],
  );
}

async function revokeGrant({
  controllerId = CONTROLLER_ID,
  digest = DIGEST,
  grantId,
  reason = 'operator_cancelled',
}) {
  return pool.query(
    `SELECT *
       FROM kernel_equivalence_revoke_grant(
         $1::uuid, $2, $3::uuid, $4
       )`,
    [grantId, digest, controllerId, reason],
  );
}

beforeAll(async () => {
  expect(migration).not.toBe('');
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await adminPool.query(`CREATE ROLE ${quotedAppRole} NOLOGIN`);
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
    CREATE TABLE kernel_equivalence_production_cases (
      case_id UUID PRIMARY KEY,
      cell_id TEXT NOT NULL,
      run_id UUID NOT NULL,
      attempt_id UUID NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_ref TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE kernel_equivalence_production_case_leases (
      case_id UUID PRIMARY KEY
        REFERENCES kernel_equivalence_production_cases(case_id),
      owner_id TEXT NOT NULL,
      state TEXT NOT NULL,
      lease_expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE kernel_equivalence_production_case_bindings (
      case_id UUID PRIMARY KEY
        REFERENCES kernel_equivalence_production_cases(case_id)
    );
    INSERT INTO kernel_equivalence_production_cases
      (case_id, cell_id, run_id, attempt_id, resource_type, resource_id,
       resource_ref, expires_at)
    VALUES
      ('${CASE_ID}', '${CELL_ID}', '${RUN_ID}', '${ATTEMPT_ID}',
       '${RESOURCE_TYPE}', '${RESOURCE_ID}', '${RESOURCE_REF}',
       clock_timestamp() + interval '5 minutes');
    INSERT INTO kernel_equivalence_production_case_leases
      (case_id, owner_id, state, lease_expires_at)
    VALUES
      ('${CASE_ID}', 'brain.kernel_equivalence.production_cases',
       'prepared', clock_timestamp() + interval '3 minutes');
    INSERT INTO kernel_equivalence_production_case_bindings (case_id)
    VALUES ('${CASE_ID}');
  `);
  await pool.query(integrationMigration);
  await pool.query(integrationMigration);
  await adminPool.query(
    `GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedAppRole}`,
  );
}, 15_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.query(`DROP ROLE IF EXISTS ${quotedAppRole}`);
    await adminPool.end();
  }
});

describe('migration 382 grant authority on real PostgreSQL', () => {
  it('registers only exact signed grant identity within active DB deadlines', async () => {
    const grantId = await registerGrant();
    const anchor = await pool.query(
      `SELECT grant_id, grant_digest, grant_payload->>'grant_id' AS payload_id,
              registered_at >= grant_issued_at AS valid
         FROM kernel_equivalence_grant_authorities
        WHERE grant_id = $1`,
      [grantId],
    );
    expect(anchor.rows).toEqual([{
      grant_id: grantId,
      grant_digest: DIGEST,
      payload_id: grantId,
      valid: true,
    }]);

    await expect(registerGrant({ digest: 'ABC' }))
      .rejects.toThrow(/digest/i);
    await expect(registerGrant({
      grantOverrides: { private_key: 'must-not-persist' },
    })).rejects.toThrow(/payload/i);
    await expect(registerGrant({ expiresInMs: 240_000 }))
      .rejects.toThrow(/deadline|expiry/i);

    await pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE case_id = $1`,
      [CASE_ID],
    );
    await expect(registerGrant())
      .rejects.toThrow(/authority.*unavailable|expired/i);
    await pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET lease_expires_at = clock_timestamp() + interval '3 minutes'
        WHERE case_id = $1`,
      [CASE_ID],
    );
  });

  it('requires publication, intent, one terminal, and monotonic generations', async () => {
    const grantId = await registerGrant();
    await expect(appendEvent({ grantId, state: 'execution_intent' }))
      .rejects.toThrow(/start.*published|publication/i);
    await appendEvent({ grantId, state: 'published' });
    await expect(appendEvent({ grantId, state: 'effect_completed' }))
      .rejects.toThrow(/execution intent/i);
    await expect(appendEvent({
      digest: 'b'.repeat(64),
      grantId,
      state: 'execution_intent',
    })).rejects.toThrow(/digest/i);
    const intent = await appendEvent({ grantId, state: 'execution_intent' });
    expect(intent.rows[0]).toMatchObject({
      grant_id: grantId,
      generation: '2',
      state: 'execution_intent',
      actor_instance_id: RUNTIME_ID,
      actor_kind: 'runtime',
    });
    await expect(appendEvent({
      details: { intent_generation: 1 },
      grantId,
      state: 'aborted_before_effect',
    })).rejects.toThrow(/intent generation/i);
    await appendEvent({
      details: { intent_generation: 2 },
      grantId,
      state: 'aborted_before_effect',
    });
    await expect(appendEvent({ grantId, state: 'effect_unknown' }))
      .rejects.toThrow(/terminal|transition/i);

    const events = await pool.query(
      `SELECT generation, state, actor_kind
         FROM kernel_equivalence_grant_events
        WHERE grant_id = $1
        ORDER BY generation`,
      [grantId],
    );
    expect(events.rows).toEqual([
      { generation: '1', state: 'published', actor_kind: 'controller' },
      { generation: '2', state: 'execution_intent', actor_kind: 'runtime' },
      { generation: '3', state: 'aborted_before_effect', actor_kind: 'runtime' },
    ]);
  });

  it('uses DB time, not details evidence, for active publication', async () => {
    const grantId = await registerGrant({ expiresInMs: 150 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(appendEvent({
      details: { occurred_at: '2000-01-01T00:00:00.000Z' },
      grantId,
      state: 'published',
    })).rejects.toThrow(/expired|authority.*unavailable/i);
  });

  it('resolves only a published, unexpired, exact, unrevoked grant', async () => {
    const grantId = await registerGrant();
    let active = await pool.query(
      `SELECT *
         FROM kernel_equivalence_resolve_active_grant($1::uuid, $2, $3)`,
      [grantId, DIGEST, CELL_ID],
    );
    expect(active.rowCount).toBe(0);
    await appendEvent({ grantId, state: 'published' });
    active = await pool.query(
      `SELECT grant_id, grant_sha256, cell_id, active,
              "grant"->>'grant_id' AS payload_id
         FROM kernel_equivalence_resolve_active_grant($1::uuid, $2, $3)`,
      [grantId, DIGEST, CELL_ID],
    );
    expect(active.rows).toEqual([{
      grant_id: grantId,
      grant_sha256: DIGEST,
      cell_id: CELL_ID,
      active: true,
      payload_id: grantId,
    }]);
    await expect(pool.query(
      `SELECT *
         FROM kernel_equivalence_resolve_active_grant($1::uuid, $2, $3)`,
      [grantId, 'b'.repeat(64), CELL_ID],
    )).resolves.toMatchObject({ rowCount: 0 });

    await revokeGrant({ grantId });
    active = await pool.query(
      `SELECT *
         FROM kernel_equivalence_resolve_active_grant($1::uuid, $2, $3)`,
      [grantId, DIGEST, CELL_ID],
    );
    expect(active.rowCount).toBe(0);
    await expect(appendEvent({ grantId, state: 'execution_intent' }))
      .rejects.toThrow(/revoked/i);
  });

  it('derives revoke disposition and permits only exact duplicates', async () => {
    const safeGrant = await registerGrant();
    await appendEvent({ grantId: safeGrant, state: 'published' });
    let revoked = await revokeGrant({ grantId: safeGrant });
    expect(revoked.rows[0]).toMatchObject({
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
    });
    revoked = await revokeGrant({ grantId: safeGrant });
    expect(revoked.rows[0]).toMatchObject({
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
    });
    await expect(revokeGrant({
      grantId: safeGrant,
      reason: 'different_reason',
    })).rejects.toThrow(/idempotency|identity/i);

    const possibleGrant = await registerGrant();
    await appendEvent({ grantId: possibleGrant, state: 'published' });
    await appendEvent({ grantId: possibleGrant, state: 'execution_intent' });
    revoked = await revokeGrant({ grantId: possibleGrant });
    expect(revoked.rows[0]).toMatchObject({
      safe_no_effect: false,
      effect_possible: true,
      disposition: 'effect_possible',
    });

    const abortedGrant = await registerGrant();
    await appendEvent({ grantId: abortedGrant, state: 'published' });
    await appendEvent({ grantId: abortedGrant, state: 'execution_intent' });
    await appendEvent({
      grantId: abortedGrant,
      state: 'aborted_before_effect',
    });
    revoked = await revokeGrant({
      grantId: abortedGrant,
      reason: 'runtime_cancelled',
    });
    expect(revoked.rows[0]).toMatchObject({
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
    });
  });

  it('blocks non-owner app DML while controlled functions remain executable', async () => {
    const appClient = await pool.connect();
    const grantId = randomUUID();
    try {
      await appClient.query(`SET ROLE ${quotedAppRole}`);
      await expect(appClient.query(
        `INSERT INTO kernel_equivalence_grant_authorities
           (grant_id, case_id, cell_id, run_id, attempt_id, resource_type,
            resource_id, resource_ref, grant_digest, expires_at,
            grant_issued_at, grant_payload)
         VALUES
           ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8, $9,
            clock_timestamp() + interval '1 minute', clock_timestamp(),
            '{}'::jsonb)`,
        [
          grantId,
          CASE_ID,
          CELL_ID,
          RUN_ID,
          ATTEMPT_ID,
          RESOURCE_TYPE,
          RESOURCE_ID,
          RESOURCE_REF,
          DIGEST,
        ],
      )).rejects.toMatchObject({ code: '42501' });

      await expect(appClient.query(
        `SELECT *
           FROM kernel_equivalence_register_grant_authority(
             $1::uuid, $2::jsonb, $3
           )`,
        [
          CASE_ID,
          JSON.stringify(signedGrant({ expiresInMs: 60_000, grantId })),
          DIGEST,
        ],
      )).resolves.toBeTruthy();
    } finally {
      await appClient.query('RESET ROLE');
      appClient.release();
    }
  });

  it('rejects UPDATE, DELETE, and TRUNCATE on every durable relation', async () => {
    const grantId = await registerGrant();
    await appendEvent({ grantId, state: 'published' });
    await revokeGrant({ grantId });
    for (const statement of [
      `UPDATE kernel_equivalence_grant_authorities
          SET expires_at = expires_at + interval '1 minute'
        WHERE grant_id = '${grantId}'`,
      `DELETE FROM kernel_equivalence_grant_authorities
        WHERE grant_id = '${grantId}'`,
      `UPDATE kernel_equivalence_grant_events
          SET state = 'effect_unknown'
        WHERE grant_id = '${grantId}'`,
      `DELETE FROM kernel_equivalence_grant_events
        WHERE grant_id = '${grantId}'`,
      `UPDATE kernel_equivalence_grant_revocations
          SET reason = 'tampered'
        WHERE grant_id = '${grantId}'`,
      `DELETE FROM kernel_equivalence_grant_revocations
        WHERE grant_id = '${grantId}'`,
      'TRUNCATE kernel_equivalence_grant_authorities CASCADE',
      'TRUNCATE kernel_equivalence_grant_events',
      'TRUNCATE kernel_equivalence_grant_revocations',
    ]) {
      await expect(pool.query(statement)).rejects.toMatchObject({
        code: 'P0001',
      });
    }
  });

  it('registers schema version 382 exactly once', async () => {
    const result = await pool.query(
      `SELECT count(*)::integer AS count
         FROM schema_version
        WHERE version = '382'`,
    );
    expect(result.rows).toEqual([{ count: 1 }]);
  });
});
