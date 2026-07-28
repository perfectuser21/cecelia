import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createPostgresReleaseRunStore } from '../../orchestrator/release-run-store.js';

const mergeMigration = readFileSync(
  new URL('../../../migrations/372_kernel_merge_effect_receipts.sql', import.meta.url),
  'utf8',
);
const releaseMigration = readFileSync(
  new URL('../../../migrations/374_kernel_release_runs.sql', import.meta.url),
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
const headSha = 'a'.repeat(40);
const mergeSha = 'b'.repeat(40);
const artifacts = [{
  name: 'brain',
  version: '1.268.5',
  digest: `sha256:${'c'.repeat(64)}`,
}];
let client;
let release;
let store;

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}, public`);
  await client.query(`
    CREATE TABLE tasks (id UUID PRIMARY KEY);
    CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
  `);
  await client.query(mergeMigration);
  await client.query(releaseMigration);
  await client.query(releaseMigration);
  await client.query('INSERT INTO tasks (id) VALUES ($1)', [taskId]);
  await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);

  const ownershipId = (await client.query(
    `INSERT INTO kernel_pr_ownership
       (run_id, task_id, repository, pr_number, pr_url, head_ref)
     VALUES ($1, $2, 'perfectuser21/cecelia', 4500,
             'https://github.com/perfectuser21/cecelia/pull/4500', 'cp-release')
     RETURNING id`,
    [runId, taskId],
  )).rows[0].id;
  await client.query(
    `INSERT INTO kernel_pr_head_observations
       (ownership_id, run_id, head_sha, head_ref, pr_state, ci_status, merged)
     VALUES ($1, $2, $3, 'cp-release', 'MERGED', 'pass', true)`,
    [ownershipId, runId, headSha],
  );
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

describe('migration 374 ReleaseRun ledger on PostgreSQL', () => {
  it('binds the confirmed merge receipt and enforces the exact six states', async () => {
    const merge = await store.loadMergeAuthority(client, { runId, taskId });
    release = await store.createRelease(client, {
      ...merge,
      artifact_versions: artifacts,
      policy_version: 'kernel-release/v1',
    });
    expect(release).toMatchObject({ state: 'merged', merge_sha: mergeSha });

    for (const state of [
      'staging_queued',
      'staging_running',
      'staging_passed',
      'production_deploying',
      'production_verified',
    ]) {
      await store.appendTransition(client, {
        releaseRunId: release.id,
        currentState: release.state,
        state,
        evidence: { merge_sha: mergeSha },
      });
      release = { ...release, state };
    }
    const rows = await client.query(
      `SELECT state FROM kernel_release_transitions
        WHERE release_run_id = $1 ORDER BY created_at, id`,
      [release.id],
    );
    expect(rows.rows.map((row) => row.state)).toEqual([
      'merged',
      'staging_queued',
      'staging_running',
      'staging_passed',
      'production_deploying',
      'production_verified',
    ]);
    await expect(client.query(
      `INSERT INTO kernel_release_transitions (release_run_id, state)
       VALUES ($1, 'staging_passed')`,
      [release.id],
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('persists exact effect receipts and rejects ledger mutation', async () => {
    const intent = await store.findOrCreateIntent(client, {
      releaseRun: release,
      effectKind: 'production',
    });
    await store.appendReceipt(client, {
      intent_id: intent.id,
      receipt_status: 'confirmed',
      observed_merge_sha: mergeSha,
      observed_artifact_versions: artifacts,
      evidence: { status: 'pass' },
    });
    await expect(client.query(
      'UPDATE kernel_release_runs SET repository = repository WHERE id = $1',
      [release.id],
    )).rejects.toMatchObject({ code: 'P0001' });
    await expect(client.query(
      `INSERT INTO kernel_release_effect_receipts
         (intent_id, receipt_status, observed_merge_sha, observed_artifact_versions)
       VALUES ($1, 'confirmed', $2, $3::jsonb)`,
      [intent.id, mergeSha, JSON.stringify(artifacts)],
    )).rejects.toMatchObject({ code: '23505' });
  });
});
