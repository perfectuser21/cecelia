import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { runMigrations } from '../../migrate.js';
import {
  materializeBootstrapE2EManifest,
} from '../../orchestrator/release-run-bootstrap-e2e.js';
import { createPostgresMergeEffectStore } from '../../orchestrator/merge-effect-store.js';
import { createReleaseBlockedEscalator } from '../../orchestrator/release-run-escalation.js';
import { createPostgresReleaseRunStore } from '../../orchestrator/release-run-store.js';

const mergeMigration = readFileSync(
  new URL('../../../migrations/372_kernel_merge_effect_receipts.sql', import.meta.url),
  'utf8',
);
const releaseMigration = readFileSync(
  new URL('../../../migrations/374_kernel_release_runs.sql', import.meta.url),
  'utf8',
);
const closureMigration = readFileSync(
  new URL('../../../migrations/375_kernel_release_run_closure.sql', import.meta.url),
  'utf8',
);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1))
  : DB_DEFAULTS.database;

if (!/_test$|_scratch$/.test(databaseName || '')) {
  throw new Error(`kernel ReleaseRun integration test requires a test database, got ${databaseName}`);
}

const pool = new pg.Pool(testDatabaseUrl
  ? { connectionString: testDatabaseUrl, max: 2 }
  : { ...DB_DEFAULTS, max: 2 });
const schema = `kernel_release_runs_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schema}"`;
const taskId = randomUUID();
const runId = randomUUID();
const contractId = randomUUID();
const headSha = 'a'.repeat(40);
const mergeSha = 'b'.repeat(40);
const artifacts = [{
  name: 'brain',
  version: '1.268.6',
  digest: `sha256:${'c'.repeat(64)}`,
}];
const scenarioResult = {
  name: 'exact ReleaseRun behavior',
  status: 'pass',
  started_at: '2026-07-28T06:01:00.000Z',
  finished_at: '2026-07-28T06:01:01.000Z',
  log_digest: `sha256:${'d'.repeat(64)}`,
};
const probeResult = {
  scenario_name: scenarioResult.name,
  probe_id: 'brain.health',
  status: 'pass',
  observation_digest: `sha256:${'9'.repeat(64)}`,
};
const acceptance = {
  scenarios: [{
    name: scenarioResult.name,
    covered_tasks: [taskId],
    commands: [{ type: 'probe', id: 'brain.health' }],
  }],
};
let client;
let release;
let store;
let rollbackIntent;
let artifactRollbackIntents;

async function appendTransition(state, evidence = {}) {
  await store.appendTransition(client, {
    releaseRunId: release.id,
    currentState: release.state,
    state,
    evidence: { merge_sha: mergeSha, ...evidence },
  });
  release = { ...release, state };
}

async function appendConfirmedReceipt(effectKind) {
  const intent = await store.findOrCreateIntent(client, {
    releaseRun: release,
    effectKind,
  });
  const claim = (await client.query(
    `INSERT INTO kernel_release_effect_dispatch_claims
       (intent_id, generation, idempotency_key, effect_kind, claim_mode,
        lease_expires_at)
     VALUES (
       $1,
       COALESCE((
         SELECT MAX(generation)
           FROM kernel_release_effect_dispatch_claims
          WHERE intent_id = $1
       ), 0) + 1,
       $2, $3, 'verification', clock_timestamp() + interval '15 minutes'
     )
     RETURNING id, generation`,
    [intent.id, intent.idempotency_key, effectKind],
  )).rows[0];
  await client.query(
    `INSERT INTO kernel_release_effect_dispatch_outcomes
       (dispatch_claim_id, outcome, evidence)
     VALUES ($1, 'observed', '{"source":"integration_live_readback"}')`,
    [claim.id],
  );
  const verification = {
    status: 'pass',
    required_e2e: 'pass',
    e2e_manifest_digest: release.e2e_manifest.manifest_digest,
    e2e_environment: effectKind,
    e2e_scenarios_total: 1,
    e2e_scenarios_passed: 1,
    e2e_scenario_results: [scenarioResult],
    e2e_probe_results: [probeResult],
    e2e_started_at: scenarioResult.started_at,
    e2e_finished_at: scenarioResult.finished_at,
    e2e_artifact_readback: artifacts,
    ...(effectKind === 'production' ? {
      health: 'pass',
      rollback_metadata: {
        anchor: `brain:${artifacts[0].digest}`,
        previous_version: `brain-image:sha256:${'f'.repeat(64)}`,
      },
      rollback_artifacts: [{
        artifact_name: 'brain',
        current_version: artifacts[0].version,
        current_digest: artifacts[0].digest,
        anchor: `brain:${artifacts[0].digest}`,
        previous_version: `brain-image:sha256:${'f'.repeat(64)}`,
        previous_digest: `sha256:${'f'.repeat(64)}`,
        rollback_metadata: {
          image_reference: `sha256:${'f'.repeat(64)}`,
        },
      }],
    } : {}),
  };
  const effectReceipt = await store.appendReceipt(client, {
    intent_id: intent.id,
    receipt_status: 'confirmed',
    observed_merge_sha: mergeSha,
    observed_artifact_versions: artifacts,
    dispatch_claim_id: Number(claim.id),
    dispatch_generation: claim.generation,
    e2e_manifest_id: release.e2e_manifest.id,
    e2e_manifest_digest: release.e2e_manifest.manifest_digest,
    e2e_scenarios_total: 1,
    e2e_scenarios_passed: 1,
    e2e_environment: effectKind,
    e2e_scenario_results: [scenarioResult],
    e2e_probe_results: [probeResult],
    e2e_started_at: scenarioResult.started_at,
    e2e_finished_at: scenarioResult.finished_at,
    evidence: { verification },
  });
  if (effectKind !== 'production') return { ...effectReceipt, verification };
  const rollbackReceipt = await store.appendRollbackReceipt(client, {
    rollback_intent_id: rollbackIntent.id,
    effect_receipt_id: effectReceipt.id,
    anchor: verification.rollback_metadata.anchor,
    previous_version: verification.rollback_metadata.previous_version,
    rollback_metadata: verification.rollback_metadata,
  });
  await expect(client.query(
    `INSERT INTO kernel_release_rollback_artifact_receipts
       (rollback_artifact_intent_id, effect_receipt_id, observed_anchor,
        observed_previous_version, observed_previous_digest, rollback_metadata)
     VALUES ($1, $2, 'brain:forged', 'brain-image:forged',
             $3, '{"image_reference":"forged"}')`,
    [
      artifactRollbackIntents[0].id,
      effectReceipt.id,
      `sha256:${'0'.repeat(64)}`,
    ],
  )).rejects.toMatchObject({ code: 'P0001' });
  const artifactRollbackReceipts = await store.appendArtifactRollbackReceipts(client, {
    effectReceiptId: effectReceipt.id,
    intents: artifactRollbackIntents,
    artifacts: verification.rollback_artifacts,
  });
  return {
    ...effectReceipt,
    verification,
    rollback_receipt_id: rollbackReceipt.id,
    artifact_rollback_receipt_ids:
      artifactRollbackReceipts.map((receipt) => receipt.id),
  };
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}, public`);
  await client.query(`
    CREATE TABLE tasks (
      id UUID PRIMARY KEY,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE initiative_contracts (
      id UUID PRIMARY KEY,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      approved_at TIMESTAMPTZ,
      contract_content TEXT,
      e2e_acceptance JSONB
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY,
      contract_id UUID REFERENCES initiative_contracts(id)
    );
  `);
  await client.query(mergeMigration);
  await client.query(releaseMigration);
  await client.query(closureMigration);
  await client.query(closureMigration);
  await client.query('INSERT INTO tasks (id) VALUES ($1)', [taskId]);
  await client.query(
    `INSERT INTO initiative_contracts
       (id, version, status, approved_at, contract_content, e2e_acceptance)
     VALUES ($1, 4, 'approved', $2, '# frozen approved contract', $3::jsonb)`,
    [contractId, '2026-07-28T06:00:00.000Z', JSON.stringify(acceptance)],
  );
  await client.query(
    'INSERT INTO initiative_runs (id, contract_id) VALUES ($1, $2)',
    [runId, contractId],
  );

  const ownershipId = (await client.query(
    `INSERT INTO kernel_pr_ownership
       (run_id, task_id, repository, pr_number, pr_url, head_ref)
     VALUES ($1, $2, 'perfectuser21/cecelia', 4500,
             'https://github.com/perfectuser21/cecelia/pull/4500', 'cp-release')
     RETURNING id`,
    [runId, taskId],
  )).rows[0].id;
  const authorizationId = (await client.query(
    `INSERT INTO kernel_merge_authorizations
       (ownership_id, run_id, task_id, repository, pr_number, pr_url,
        head_ref, head_sha, policy_version, evidence)
     VALUES ($1, $2, $3, 'perfectuser21/cecelia', 4500,
             'https://github.com/perfectuser21/cecelia/pull/4500',
             'cp-release', $4, 'kernel-merge/v1', '{}')
     RETURNING id`,
    [ownershipId, runId, taskId, headSha],
  )).rows[0].id;
  const intentId = (await client.query(
    `INSERT INTO kernel_merge_effect_intents
       (authorization_id, run_id, target, requested_head_sha)
     VALUES ($1, $2, 'https://github.com/perfectuser21/cecelia/pull/4500', $3)
     RETURNING id`,
    [authorizationId, runId, headSha],
  )).rows[0].id;
  await client.query(
    `INSERT INTO kernel_merge_effect_receipts
       (intent_id, receipt_status, observed_head_sha, merged, evidence)
     VALUES ($1, 'confirmed', $2, true, $3::jsonb)`,
    [intentId, headSha, JSON.stringify({ merge_commit_sha: mergeSha })],
  );
  store = createPostgresReleaseRunStore({});
}, 15_000);

afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    client.release();
  }
  await pool.end();
});

describe('migrations 374-375 ReleaseRun ledger on PostgreSQL', () => {
  it('persists first-release and path risk as immutable server-owned review authority', async () => {
    const mergeStore = createPostgresMergeEffectStore({});
    const firstTaskId = randomUUID();
    const firstRunId = randomUUID();
    await client.query('INSERT INTO tasks (id) VALUES ($1)', [firstTaskId]);
    await client.query(
      'INSERT INTO initiative_runs (id, contract_id) VALUES ($1, $2)',
      [firstRunId, contractId],
    );

    await expect(client.query(
      `INSERT INTO kernel_merge_review_assessments
         (run_id, task_id, repository, pr_number, head_sha, policy_version,
          changed_paths, risk_tier, risk_reasons, first_kernel_release,
          payload_review_required, review_required)
       VALUES ($1, $2, 'other/repository', 1, $3, 'kernel-merge/v1',
               '["apps/dashboard/src/App.jsx"]', 'low', '["low_risk_paths"]',
               false, false, false)`,
      [firstRunId, firstTaskId, headSha],
    )).rejects.toMatchObject({ code: 'P0001' });

    const first = await mergeStore.assessReviewPolicy(client, {
      runId: firstRunId,
      taskId: firstTaskId,
      currentPr: {
        repository: 'other/repository',
        number: 1,
        head_sha: headSha,
        changed_paths: ['apps/dashboard/src/App.jsx'],
      },
      policyVersion: 'kernel-merge/v1',
      payload: { review_required: false },
    });
    expect(first).toMatchObject({
      risk_tier: 'low',
      first_kernel_release: true,
      payload_review_required: false,
      review_required: true,
      risk_reasons: ['low_risk_paths', 'first_kernel_release'],
    });
    await expect(client.query(
      `UPDATE kernel_merge_review_assessments
          SET review_required = false
        WHERE id = $1`,
      [first.assessment_id],
    )).rejects.toMatchObject({ code: 'P0001' });

    await expect(mergeStore.assessReviewPolicy(client, {
      runId,
      taskId,
      currentPr: {
        repository: 'perfectuser21/cecelia',
        number: 4500,
        head_sha: headSha,
        changed_paths: ['apps/dashboard/src/App.jsx'],
      },
      policyVersion: 'kernel-merge/v1',
      payload: { review_required: false },
    })).resolves.toMatchObject({
      risk_tier: 'low',
      first_kernel_release: false,
      review_required: false,
    });
  });

  it('uses the canonical runner to upgrade an N-1 schema from 368 through 375', async () => {
    const upgradeSchema = `kernel_release_upgrade_${randomUUID().replaceAll('-', '')}`;
    const quotedUpgradeSchema = `"${upgradeSchema}"`;
    await client.query(`CREATE SCHEMA ${quotedUpgradeSchema}`);
    const upgradePool = new pg.Pool(testDatabaseUrl
      ? {
        connectionString: testDatabaseUrl,
        options: `-c search_path=${upgradeSchema},public`,
        max: 1,
      }
      : {
        ...DB_DEFAULTS,
        options: `-c search_path=${upgradeSchema},public`,
        max: 1,
      });
    try {
      const seed = await upgradePool.connect();
      try {
        await seed.query(`
          CREATE TABLE schema_version (
            version VARCHAR(10) PRIMARY KEY,
            description TEXT,
            applied_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE TABLE tasks (id UUID PRIMARY KEY);
          CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
          CREATE TABLE harness_attempts (
            id UUID PRIMARY KEY,
            execution_transport TEXT
          );
        `);
        const migrationNames = readdirSync(
          new URL('../../../migrations/', import.meta.url),
        ).filter((name) => /^\d+_.+\.sql$/.test(name));
        for (const version of migrationNames
          .map((name) => name.split('_')[0])
          .filter((version) => Number(version) <= 368)) {
          await seed.query(
            `INSERT INTO schema_version (version, description)
             VALUES ($1, 'N-1 fixture') ON CONFLICT DO NOTHING`,
            [version],
          );
        }
      } finally {
        seed.release();
      }
      await expect(runMigrations(upgradePool)).resolves.toEqual([
        '369', '370', '371', '372', '374', '375',
      ]);
    } finally {
      await upgradePool.end();
      await client.query(`DROP SCHEMA IF EXISTS ${quotedUpgradeSchema} CASCADE`);
    }
  });

  it('reconciles a database that already recorded the shipped v374 schema', async () => {
    const legacySchema = `kernel_release_legacy_${randomUUID().replaceAll('-', '')}`;
    const quotedLegacySchema = `"${legacySchema}"`;
    await client.query(`CREATE SCHEMA ${quotedLegacySchema}`);
    const legacyPool = new pg.Pool(testDatabaseUrl
      ? {
        connectionString: testDatabaseUrl,
        options: `-c search_path=${legacySchema},public`,
        max: 1,
      }
      : {
        ...DB_DEFAULTS,
        options: `-c search_path=${legacySchema},public`,
        max: 1,
      });
    try {
      const legacy = await legacyPool.connect();
      try {
        await legacy.query(`
          CREATE TABLE tasks (id UUID PRIMARY KEY);
          CREATE TABLE initiative_contracts (
            id UUID PRIMARY KEY,
            version INTEGER NOT NULL,
            status TEXT NOT NULL,
            approved_at TIMESTAMPTZ,
            contract_content TEXT,
            e2e_acceptance JSONB
          );
          CREATE TABLE initiative_runs (
            id UUID PRIMARY KEY,
            contract_id UUID REFERENCES initiative_contracts(id)
          );
        `);
        await legacy.query(mergeMigration);
        await legacy.query(releaseMigration);

        await expect(legacy.query(closureMigration)).resolves.toBeDefined();
        const columns = (await legacy.query(
          `SELECT table_name, column_name
             FROM information_schema.columns
            WHERE table_schema = $1
              AND (
                (table_name = 'kernel_release_effect_dispatch_claims'
                  AND column_name = 'claim_mode')
                OR
                (table_name = 'kernel_release_effect_receipts'
                  AND column_name IN ('dispatch_claim_id', 'e2e_manifest_id'))
                OR
                (table_name = 'kernel_release_bootstrap_effect_receipts'
                  AND column_name IN ('observed_merge_sha', 'e2e_manifest_id'))
              )`,
          [legacySchema],
        )).rows.map(({ table_name: table, column_name: column }) => `${table}.${column}`);
        expect(columns).toEqual(expect.arrayContaining([
          'kernel_release_effect_dispatch_claims.claim_mode',
          'kernel_release_effect_receipts.dispatch_claim_id',
          'kernel_release_effect_receipts.e2e_manifest_id',
          'kernel_release_bootstrap_effect_receipts.observed_merge_sha',
          'kernel_release_bootstrap_effect_receipts.e2e_manifest_id',
        ]));
        await expect(legacy.query(
          `SELECT 1
             FROM kernel_release_effect_dispatch_renewals,
                  kernel_release_e2e_manifests,
                  kernel_release_bootstrap_e2e_manifests,
                  kernel_release_rollback_intents,
                  kernel_release_rollback_artifact_intents,
                  kernel_release_bootstrap_rollback_artifact_intents,
                  kernel_release_blocked_escalations
            LIMIT 1`,
        )).resolves.toBeDefined();
      } finally {
        legacy.release();
      }
    } finally {
      await legacyPool.end();
      await client.query(`DROP SCHEMA IF EXISTS ${quotedLegacySchema} CASCADE`);
    }
  });

  it('materializes exact merge/contract authority and rejects a cross-paired identity', async () => {
    const merge = await store.loadMergeAuthority(client, { runId, taskId });
    release = await store.createRelease(client, {
      ...merge,
      artifact_versions: artifacts,
      policy_version: 'kernel-release/v1',
    });
    expect(release).toMatchObject({
      state: 'merged',
      merge_sha: mergeSha,
      e2e_manifest: {
        scenarios_total: 1,
        artifact_versions: artifacts,
      },
    });

    const otherRunId = randomUUID();
    const otherTaskId = randomUUID();
    await client.query('INSERT INTO tasks (id) VALUES ($1)', [otherTaskId]);
    await client.query(
      'INSERT INTO initiative_runs (id, contract_id) VALUES ($1, $2)',
      [otherRunId, contractId],
    );
    await expect(client.query(
      `INSERT INTO kernel_release_runs
         (run_id, task_id, merge_intent_id, merge_receipt_id, repository,
          pr_number, source_head_sha, merge_sha, artifact_versions, policy_version)
       SELECT $1, $2, merge_intent_id, merge_receipt_id, repository,
              pr_number, source_head_sha, merge_sha, artifact_versions, policy_version
         FROM kernel_release_runs
        WHERE id = $3`,
      [otherRunId, otherTaskId, release.id],
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('rejects arbitrary shell acceptance at the durable manifest boundary', async () => {
    const { rows } = await client.query(
      `SELECT kernel_release_e2e_acceptance_is_typed($1::jsonb) AS allowed`,
      [JSON.stringify({
        scenarios: [{
          name: 'unsafe',
          covered_tasks: [taskId],
          commands: [{ type: 'bash', cmd: 'curl localhost; rm -rf /tmp/x' }],
        }],
      })],
    );
    expect(rows[0].allowed).toBe(false);
  });

  it('durably deduplicates a ReleaseRun BLOCKED P0 escalation', async () => {
    const notifications = [];
    const escalate = createReleaseBlockedEscalator({
      pool: client,
      raiseAlert: async (...args) => notifications.push(args),
    });
    const value = {
      run_id: runId,
      task_id: taskId,
      release_run_id: release.id,
      release_state: release.state,
      merge_sha: mergeSha,
      detail: 'release_staging_e2e_not_passed',
    };
    await expect(escalate(value)).resolves.toMatchObject({ deduped: false });
    await expect(escalate(value)).resolves.toMatchObject({ deduped: true });
    expect(notifications).toHaveLength(1);
    expect((await client.query(
      'SELECT count(*)::integer AS count FROM kernel_release_blocked_escalations',
    )).rows[0].count).toBe(1);
    expect((await client.query(
      'SELECT count(*)::integer AS count FROM kernel_release_alert_outbox',
    )).rows[0].count).toBe(1);
    expect((await client.query(
      `SELECT count(*)::integer AS count
         FROM kernel_release_alert_delivery_attempts
        WHERE outcome = 'delivered'`,
    )).rows[0].count).toBe(1);

    let deliveryAttempt = 0;
    const retryingEscalate = createReleaseBlockedEscalator({
      pool: client,
      raiseAlert: async () => {
        deliveryAttempt += 1;
        if (deliveryAttempt === 1) throw new Error('provider unavailable');
      },
    });
    const retryValue = {
      ...value,
      detail: 'release_production_e2e_not_passed',
    };
    await expect(retryingEscalate(retryValue)).resolves.toMatchObject({
      delivery: 'pending',
    });
    await expect(retryingEscalate(retryValue)).resolves.toMatchObject({
      deduped: true,
      delivery: 'delivered',
    });
    expect((await client.query(
      `SELECT outcome
         FROM kernel_release_alert_delivery_attempts
        WHERE outbox_id = (
          SELECT outbox.id
            FROM kernel_release_alert_outbox outbox
            JOIN kernel_release_blocked_escalations escalation
              ON escalation.id = outbox.escalation_id
           WHERE escalation.detail = $1
        )
        ORDER BY attempt_no`,
      [retryValue.detail],
    )).rows.map((row) => row.outcome)).toEqual(['failed', 'delivered']);
  });

  it('fences exact receipts and transitions to a live observed generation', async () => {
    await appendTransition('staging_queued');
    await appendTransition('staging_running');
    await expect(client.query(
      `INSERT INTO kernel_release_transitions
         (release_run_id, state, evidence)
       VALUES ($1, 'staging_passed', $2::jsonb)`,
      [release.id, JSON.stringify({ merge_sha: mergeSha })],
    )).rejects.toMatchObject({ code: 'P0001' });

    const stagingReceipt = await appendConfirmedReceipt('staging');
    await expect(store.appendReceipt(client, {
      ...stagingReceipt,
      evidence: {
        ...stagingReceipt.evidence,
        source: 'forged_idempotent_replay',
      },
    })).rejects.toMatchObject({ code: 'release_effect_receipt_conflict' });
    await expect(client.query(
      `INSERT INTO kernel_release_transitions
         (release_run_id, state, evidence)
       VALUES ($1, 'staging_passed', $2::jsonb)`,
      [
        release.id,
        JSON.stringify({
          merge_sha: mergeSha,
          artifact_versions: artifacts,
          effect_receipt_id: stagingReceipt.id,
          e2e_manifest_digest: release.e2e_manifest.manifest_digest,
          verification: { ...stagingReceipt.verification, status: 'forged' },
        }),
      ],
    )).rejects.toMatchObject({ code: 'P0001' });
    await appendTransition('staging_passed', {
      artifact_versions: artifacts,
      effect_receipt_id: stagingReceipt.id,
      e2e_manifest_digest: release.e2e_manifest.manifest_digest,
      verification: stagingReceipt.verification,
    });
    rollbackIntent = await store.findOrCreateRollbackIntent(
      client,
      { releaseRun: release },
    );
    await expect(client.query(
      `INSERT INTO kernel_release_rollback_artifact_intents
         (rollback_intent_id, artifact_name, expected_current_version,
          expected_current_digest, expected_anchor, expected_previous_version,
          expected_previous_digest)
       VALUES ($1, 'evil', 'forged', $2, 'evil:forged',
               'evil:previous', $3)`,
      [
        rollbackIntent.id,
        `sha256:${'0'.repeat(64)}`,
        `sha256:${'1'.repeat(64)}`,
      ],
    )).rejects.toMatchObject({ code: 'P0001' });
    artifactRollbackIntents = await store.findOrCreateArtifactRollbackIntents(
      client,
      {
        rollbackIntent,
        releaseRun: release,
        artifacts: [{
          artifact_name: 'brain',
          expected_current_version: artifacts[0].version,
          expected_current_digest: artifacts[0].digest,
          expected_anchor: `brain:${artifacts[0].digest}`,
          expected_previous_version: `brain-image:sha256:${'f'.repeat(64)}`,
          expected_previous_digest: `sha256:${'f'.repeat(64)}`,
        }],
      },
    );
    await appendTransition('production_deploying', {
      artifact_rollback_intent_ids:
        artifactRollbackIntents.map((intent) => intent.id),
    });
    const productionReceipt = await appendConfirmedReceipt('production');
    await expect(client.query(
      `INSERT INTO kernel_release_transitions
         (release_run_id, state, evidence)
       VALUES ($1, 'production_verified', $2::jsonb)`,
      [
        release.id,
        JSON.stringify({
          merge_sha: mergeSha,
          effect_receipt_id: productionReceipt.id,
          e2e_manifest_digest: release.e2e_manifest.manifest_digest,
          rollback_receipt_id: productionReceipt.rollback_receipt_id,
        }),
      ],
    )).rejects.toMatchObject({ code: 'P0001' });
    await appendTransition('production_verified', {
      deployed_versions: artifacts,
      effect_receipt_id: productionReceipt.id,
      e2e_manifest_digest: release.e2e_manifest.manifest_digest,
      rollback_receipt_id: productionReceipt.rollback_receipt_id,
      artifact_rollback_receipt_ids:
        productionReceipt.artifact_rollback_receipt_ids,
      verification: productionReceipt.verification,
    });
    const persistedProductionReceipt = (await client.query(
      `SELECT e2e_probe_results,
              evidence->'verification'->'e2e_probe_results'
                AS verification_probe_results
         FROM kernel_release_effect_receipts
        WHERE id = $1`,
      [productionReceipt.id],
    )).rows[0];
    expect(persistedProductionReceipt.e2e_probe_results).toEqual([probeResult]);
    expect(persistedProductionReceipt.verification_probe_results)
      .toEqual([probeResult]);

    const staleClaim = await client.query(
      `SELECT id, generation
         FROM kernel_release_effect_dispatch_claims
        WHERE intent_id = (
          SELECT id FROM kernel_release_effect_intents
           WHERE release_run_id = $1 AND effect_kind = 'production'
        )
        ORDER BY generation DESC LIMIT 1`,
      [release.id],
    );
    await expect(client.query(
      `INSERT INTO kernel_release_effect_receipts
         (intent_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, dispatch_claim_id, dispatch_generation,
          e2e_manifest_id, e2e_manifest_digest, e2e_scenarios_total,
          e2e_scenarios_passed, e2e_environment, e2e_scenario_results,
          e2e_probe_results, e2e_started_at, e2e_finished_at, evidence)
       SELECT intent.id, 'confirmed', $2, $3::jsonb, $4, $5 - 1,
              $6, $7, 1, 1, 'production', $8::jsonb, $9::jsonb,
              $10, $11, $12::jsonb
         FROM kernel_release_effect_intents intent
        WHERE intent.release_run_id = $1 AND intent.effect_kind = 'production'`,
      [
        release.id,
        mergeSha,
        JSON.stringify(artifacts),
        staleClaim.rows[0].id,
        staleClaim.rows[0].generation,
        release.e2e_manifest.id,
        release.e2e_manifest.manifest_digest,
        JSON.stringify([scenarioResult]),
        JSON.stringify([probeResult]),
        scenarioResult.started_at,
        scenarioResult.finished_at,
        JSON.stringify({ verification: { status: 'pass' } }),
      ],
    )).rejects.toBeTruthy();
  });

  it('blocks UPDATE, DELETE, and TRUNCATE against authoritative ledgers', async () => {
    await expect(client.query(
      'UPDATE kernel_release_runs SET repository = repository WHERE id = $1',
      [release.id],
    )).rejects.toMatchObject({ code: 'P0001' });
    await expect(client.query(
      'DELETE FROM kernel_release_effect_receipts WHERE id = $1',
      [(await client.query(
        'SELECT id FROM kernel_release_effect_receipts LIMIT 1',
      )).rows[0].id],
    )).rejects.toMatchObject({ code: 'P0001' });
    await expect(client.query(
      'TRUNCATE kernel_release_effect_receipts CASCADE',
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('binds bootstrap to the same manifest and latest active generation', async () => {
    const bootstrapRunId = (await client.query(
      `INSERT INTO kernel_release_bootstrap_runs
         (repository, pr_number, source_head_sha, merge_sha, approved_by,
          approval_key_id, approval_digest)
       VALUES ('perfectuser21/cecelia', 4500, $1, $2, 'owner',
               'owner-key-v1', $3)
       RETURNING id`,
      [headSha, mergeSha, 'e'.repeat(64)],
    )).rows[0].id;
    const manifest = await materializeBootstrapE2EManifest(client, {
      bootstrap_run_id: bootstrapRunId,
      repository: 'perfectuser21/cecelia',
      source_head_sha: headSha,
      merge_sha: mergeSha,
      artifact_versions: artifacts,
    });
    expect(manifest).toMatchObject({
      release_run_id: bootstrapRunId,
      run_id: runId,
      manifest_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });

    await client.query(
      `INSERT INTO kernel_release_bootstrap_transitions
         (bootstrap_run_id, state, evidence)
       VALUES ($1, 'approved', $2::jsonb),
              ($1, 'staging_intent', $2::jsonb)`,
      [bootstrapRunId, JSON.stringify({ merge_sha: mergeSha })],
    );
    const staleAttempt = (await client.query(
      `INSERT INTO kernel_release_bootstrap_effect_attempts
         (bootstrap_run_id, effect_kind, generation, lease_expires_at)
       VALUES ($1, 'staging', 1, clock_timestamp() - interval '1 second')
       RETURNING id`,
      [bootstrapRunId],
    )).rows[0];
    const confirmedValues = [
      mergeSha,
      JSON.stringify(artifacts),
      manifest.id,
      manifest.manifest_digest,
      JSON.stringify([scenarioResult]),
      JSON.stringify([probeResult]),
      scenarioResult.started_at,
      scenarioResult.finished_at,
      JSON.stringify({
        required_e2e: 'pass',
        merge_sha: mergeSha,
        e2e_probe_results: [probeResult],
      }),
    ];
    await expect(client.query(
      `INSERT INTO kernel_release_bootstrap_effect_receipts
         (effect_attempt_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, e2e_manifest_id, e2e_manifest_digest,
          e2e_scenarios_total, e2e_scenarios_passed, e2e_environment,
          e2e_scenario_results, e2e_probe_results,
          e2e_started_at, e2e_finished_at, evidence)
       VALUES ($1, 'confirmed', $2, $3::jsonb, $4, $5, 1, 1, 'staging',
               $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)`,
      [staleAttempt.id, ...confirmedValues],
    )).rejects.toMatchObject({ code: 'P0001' });
    const attempt = (await client.query(
      `INSERT INTO kernel_release_bootstrap_effect_attempts
         (bootstrap_run_id, effect_kind, generation, lease_expires_at)
       VALUES ($1, 'staging', 2, clock_timestamp() - interval '1 second')
       RETURNING id`,
      [bootstrapRunId],
    )).rows[0];
    await client.query(
      `INSERT INTO kernel_release_bootstrap_effect_attempt_renewals
         (effect_attempt_id, generation, lease_expires_at)
       VALUES ($1, 2, clock_timestamp() + interval '15 minutes')`,
      [attempt.id],
    );
    const receipt = (await client.query(
      `INSERT INTO kernel_release_bootstrap_effect_receipts
         (effect_attempt_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, e2e_manifest_id, e2e_manifest_digest,
          e2e_scenarios_total, e2e_scenarios_passed, e2e_environment,
          e2e_scenario_results, e2e_probe_results,
          e2e_started_at, e2e_finished_at, evidence)
       VALUES ($1, 'confirmed', $2, $3::jsonb, $4, $5, 1, 1, 'staging',
               $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
       RETURNING id`,
      [
        attempt.id,
        ...confirmedValues,
      ],
    )).rows[0];
    await expect(client.query(
      `INSERT INTO kernel_release_bootstrap_transitions
         (bootstrap_run_id, state, evidence)
       VALUES ($1, 'staging_passed', $2::jsonb)`,
      [bootstrapRunId, JSON.stringify({
        merge_sha: mergeSha,
        effect_receipt_id: String(receipt.id),
        e2e_manifest_digest: manifest.manifest_digest,
        artifact_versions: [{ ...artifacts[0], version: 'forged' }],
        receipt_evidence: confirmedValues.at(-1),
      })],
    )).rejects.toMatchObject({ code: 'P0001' });
    await client.query(
      `INSERT INTO kernel_release_bootstrap_transitions
         (bootstrap_run_id, state, evidence)
       VALUES ($1, 'staging_passed', $2::jsonb)`,
      [bootstrapRunId, JSON.stringify({
        merge_sha: mergeSha,
        effect_receipt_id: String(receipt.id),
        e2e_manifest_digest: manifest.manifest_digest,
        artifact_versions: artifacts,
        receipt_evidence: JSON.parse(confirmedValues.at(-1)),
      })],
    );
    await expect(client.query(
      `INSERT INTO kernel_release_bootstrap_effect_receipts
         (effect_attempt_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, e2e_manifest_id, e2e_manifest_digest,
          e2e_scenarios_total, e2e_scenarios_passed, e2e_environment,
          e2e_scenario_results, e2e_probe_results,
          e2e_started_at, e2e_finished_at, evidence)
       VALUES ($1, 'confirmed', $2, $3::jsonb, $4, $5, 1, 1, 'staging',
               $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)`,
      [
        attempt.id,
        ...confirmedValues,
      ],
    )).rejects.toMatchObject({ code: '23505' });

    const bootstrapPreviousDigest = `sha256:${'7'.repeat(64)}`;
    const bootstrapArtifactIntent = (await client.query(
      `INSERT INTO kernel_release_bootstrap_rollback_artifact_intents
         (bootstrap_run_id, artifact_name, expected_current_version,
          expected_current_digest, expected_anchor, expected_previous_version,
          expected_previous_digest)
       VALUES ($1, 'brain', $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        bootstrapRunId,
        artifacts[0].version,
        artifacts[0].digest,
        `brain:${artifacts[0].digest}`,
        `brain-image:${bootstrapPreviousDigest}`,
        bootstrapPreviousDigest,
      ],
    )).rows[0];
    await client.query(
      `INSERT INTO kernel_release_bootstrap_transitions
         (bootstrap_run_id, state, evidence)
       VALUES ($1, 'production_intent', $2::jsonb)`,
      [bootstrapRunId, JSON.stringify({
        merge_sha: mergeSha,
        artifact_rollback_intent_ids: [bootstrapArtifactIntent.id],
      })],
    );
    const productionAttempt = (await client.query(
      `INSERT INTO kernel_release_bootstrap_effect_attempts
         (bootstrap_run_id, effect_kind, generation, lease_expires_at)
       VALUES ($1, 'production', 1, clock_timestamp() + interval '15 minutes')
       RETURNING id`,
      [bootstrapRunId],
    )).rows[0];
    const bootstrapRollbackArtifacts = [{
      artifact_name: 'brain',
      current_version: artifacts[0].version,
      current_digest: artifacts[0].digest,
      anchor: `brain:${artifacts[0].digest}`,
      previous_version: `brain-image:${bootstrapPreviousDigest}`,
      previous_digest: bootstrapPreviousDigest,
      rollback_metadata: { image_reference: bootstrapPreviousDigest },
    }];
    const productionEffectReceipt = (await client.query(
      `INSERT INTO kernel_release_bootstrap_effect_receipts
         (effect_attempt_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, e2e_manifest_id, e2e_manifest_digest,
          e2e_scenarios_total, e2e_scenarios_passed, e2e_environment,
          e2e_scenario_results, e2e_probe_results,
          e2e_started_at, e2e_finished_at, evidence)
       VALUES ($1, 'confirmed', $2, $3::jsonb, $4, $5, 1, 1, 'production',
               $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
       RETURNING id`,
      [
        productionAttempt.id,
        mergeSha,
        JSON.stringify(artifacts),
        manifest.id,
        manifest.manifest_digest,
        JSON.stringify([scenarioResult]),
        JSON.stringify([probeResult]),
        scenarioResult.started_at,
        scenarioResult.finished_at,
        JSON.stringify({
          required_e2e: 'pass',
          merge_sha: mergeSha,
          e2e_probe_results: [probeResult],
          rollback_artifacts: bootstrapRollbackArtifacts,
        }),
      ],
    )).rows[0];
    await expect(client.query(
      `INSERT INTO kernel_release_bootstrap_rollback_artifact_receipts
         (rollback_artifact_intent_id, effect_receipt_id, observed_anchor,
          observed_previous_version, observed_previous_digest, rollback_metadata)
       VALUES ($1, $2, 'brain:forged', 'brain-image:forged', $3, '{}')`,
      [
        bootstrapArtifactIntent.id,
        productionEffectReceipt.id,
        `sha256:${'0'.repeat(64)}`,
      ],
    )).rejects.toMatchObject({ code: 'P0001' });
    const bootstrapArtifactReceipt = (await client.query(
      `INSERT INTO kernel_release_bootstrap_rollback_artifact_receipts
         (rollback_artifact_intent_id, effect_receipt_id, observed_anchor,
          observed_previous_version, observed_previous_digest, rollback_metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        bootstrapArtifactIntent.id,
        productionEffectReceipt.id,
        bootstrapRollbackArtifacts[0].anchor,
        bootstrapRollbackArtifacts[0].previous_version,
        bootstrapRollbackArtifacts[0].previous_digest,
        JSON.stringify(bootstrapRollbackArtifacts[0].rollback_metadata),
      ],
    )).rows[0];
    await expect(client.query(
      `INSERT INTO kernel_release_bootstrap_transitions
         (bootstrap_run_id, state, evidence)
       VALUES ($1, 'production_verified', $2::jsonb)`,
      [bootstrapRunId, JSON.stringify({
        merge_sha: mergeSha,
        effect_receipt_id: String(productionEffectReceipt.id),
        e2e_manifest_digest: manifest.manifest_digest,
      })],
    )).rejects.toMatchObject({ code: 'P0001' });
    await client.query(
      `INSERT INTO kernel_release_bootstrap_transitions
         (bootstrap_run_id, state, evidence)
       VALUES ($1, 'production_verified', $2::jsonb)`,
      [bootstrapRunId, JSON.stringify({
        merge_sha: mergeSha,
        effect_receipt_id: String(productionEffectReceipt.id),
        e2e_manifest_digest: manifest.manifest_digest,
        artifact_versions: artifacts,
        receipt_evidence: {
          required_e2e: 'pass',
          merge_sha: mergeSha,
          e2e_probe_results: [probeResult],
          rollback_artifacts: bootstrapRollbackArtifacts,
        },
        artifact_rollback_receipt_ids: [String(bootstrapArtifactReceipt.id)],
      })],
    );
  });
});
