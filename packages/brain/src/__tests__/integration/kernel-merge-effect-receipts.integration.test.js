import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createPostgresMergeEffectStore } from '../../orchestrator/merge-effect-store.js';

const migration = readFileSync(
  new URL('../../../migrations/372_kernel_merge_effect_receipts.sql', import.meta.url),
  'utf8',
);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1))
  : DB_DEFAULTS.database;

if (!/_test$|_scratch$/.test(databaseName || '')) {
  throw new Error(`kernel merge receipt integration test requires a test database, got ${databaseName}`);
}

const pool = new pg.Pool(testDatabaseUrl
  ? { connectionString: testDatabaseUrl, max: 2 }
  : { ...DB_DEFAULTS, max: 2 });
const schema = `kernel_merge_receipts_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schema}"`;
const taskId = randomUUID();
const runId = randomUUID();
const headSha = 'a'.repeat(40);
let client;
let ownershipId;
let authorizationId;
let intentId;

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}, public`);
  await client.query(`
    CREATE TABLE tasks (id UUID PRIMARY KEY);
    CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
  `);
  await client.query(migration);
  await client.query(migration);
  await client.query('INSERT INTO tasks (id) VALUES ($1)', [taskId]);
  await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);

  ownershipId = (await client.query(
    `INSERT INTO kernel_pr_ownership
       (run_id, task_id, repository, pr_number, pr_url, head_ref)
     VALUES ($1, $2, 'perfectuser21/cecelia', 4400,
             'https://github.com/perfectuser21/cecelia/pull/4400', 'cp-safe')
     RETURNING id`,
    [runId, taskId],
  )).rows[0].id;
  await client.query(
    `INSERT INTO kernel_pr_head_observations
       (ownership_id, run_id, head_sha, head_ref, pr_state, ci_status, merged)
     VALUES ($1, $2, $3, 'cp-safe', 'OPEN', 'pass', false)`,
    [ownershipId, runId, headSha],
  );
  authorizationId = (await client.query(
    `INSERT INTO kernel_merge_authorizations
       (ownership_id, run_id, task_id, repository, pr_number, pr_url,
        head_ref, head_sha, policy_version, evidence)
     VALUES ($1, $2, $3, 'perfectuser21/cecelia', 4400,
             'https://github.com/perfectuser21/cecelia/pull/4400',
             'cp-safe', $4, 'kernel-merge/v1', '{}')
     RETURNING id`,
    [ownershipId, runId, taskId, headSha],
  )).rows[0].id;
  intentId = (await client.query(
    `INSERT INTO kernel_merge_effect_intents
       (authorization_id, run_id, target, requested_head_sha)
     VALUES ($1, $2, 'https://github.com/perfectuser21/cecelia/pull/4400', $3)
     RETURNING id`,
    [authorizationId, runId, headSha],
  )).rows[0].id;
}, 15_000);

afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    client.release();
  }
  await pool.end();
});

describe('migration 372 exact-SHA merge ledger on PostgreSQL', () => {
  it('is rerunnable and preserves one stable owner and one intent', async () => {
    await expect(client.query(
      `INSERT INTO kernel_pr_ownership
         (run_id, task_id, repository, pr_number, pr_url, head_ref)
       VALUES ($1, $2, 'other/repo', 1, 'https://github.com/other/repo/pull/1', 'other')`,
      [runId, taskId],
    )).rejects.toMatchObject({ code: '23505' });

    await expect(client.query(
      `INSERT INTO kernel_merge_effect_intents
         (authorization_id, run_id, target, requested_head_sha)
       VALUES ($1, $2, 'duplicate', $3)`,
      [authorizationId, runId, headSha],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('permits only one confirmed exact-head receipt', async () => {
    await client.query(
      `INSERT INTO kernel_merge_effect_receipts
         (intent_id, receipt_status, observed_head_sha, merged)
       VALUES ($1, 'confirmed', $2, true)`,
      [intentId, headSha],
    );
    await expect(client.query(
      `INSERT INTO kernel_merge_effect_receipts
         (intent_id, receipt_status, observed_head_sha, merged)
       VALUES ($1, 'confirmed', $2, true)`,
      [intentId, headSha],
    )).rejects.toMatchObject({ code: '23505' });
    await expect(client.query(
      `INSERT INTO kernel_merge_effect_receipts
         (intent_id, receipt_status, observed_head_sha, merged)
       VALUES ($1, 'confirmed', $2, false)`,
      [intentId, headSha],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('persists and idempotently receipts the real store SQL', async () => {
    const store = createPostgresMergeEffectStore({});
    const secondTaskId = randomUUID();
    const secondRunId = randomUUID();
    const secondPrUrl = 'https://github.com/perfectuser21/cecelia/pull/4401';
    await client.query('INSERT INTO tasks (id) VALUES ($1)', [secondTaskId]);
    await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [secondRunId]);

    const intent = await store.createAuthorizationIntent(client, {
      proof: {
        run_id: secondRunId,
        task_id: secondTaskId,
        repository: 'perfectuser21/cecelia',
        pr_number: 4401,
        pr_url: secondPrUrl,
        head_ref: 'cp-safe-second',
        head_sha: headSha,
        policy_version: 'kernel-merge/v1',
        review_required: false,
        evaluator_hop: 1,
        judge_hop: 2,
        human_review_hop: null,
        merge_intent_hop: 3,
      },
      currentPr: {
        url: secondPrUrl,
        repository: 'perfectuser21/cecelia',
        number: 4401,
        head_ref: 'cp-safe-second',
        head_sha: headSha,
        state: 'OPEN',
        ci: 'pass',
        merged: false,
      },
    });
    expect(intent).toMatchObject({
      requested_head_sha: headSha,
      confirmed_receipt: null,
    });

    const receipt = {
      intent_id: intent.intent_id,
      receipt_status: 'confirmed',
      observed_head_sha: headSha,
      merged: true,
      evidence: { source: 'integration' },
    };
    await store.appendReceipt(client, receipt);
    await store.appendReceipt(client, receipt);

    const receipts = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM kernel_merge_effect_receipts
        WHERE intent_id = $1
          AND receipt_status = 'confirmed'`,
      [intent.intent_id],
    );
    expect(receipts.rows[0].count).toBe(1);
    await expect(store.findIntent(client, { runId: secondRunId })).resolves.toMatchObject({
      intent_id: intent.intent_id,
      requested_head_sha: headSha,
      confirmed_receipt: expect.any(String),
    });
  });

  it.each([
    ['kernel_pr_ownership', 'id', () => ownershipId],
    ['kernel_pr_head_observations', 'ownership_id', () => ownershipId],
    ['kernel_merge_authorizations', 'id', () => authorizationId],
    ['kernel_merge_effect_intents', 'id', () => intentId],
    ['kernel_merge_effect_receipts', 'intent_id', () => intentId],
  ])('%s rejects UPDATE and DELETE', async (table, column, value) => {
    await expect(client.query(
      `UPDATE ${table} SET id = id WHERE ${column} = $1`,
      [value()],
    )).rejects.toMatchObject({ code: 'P0001' });
    await expect(client.query(
      `DELETE FROM ${table} WHERE ${column} = $1`,
      [value()],
    )).rejects.toMatchObject({ code: 'P0001' });
  });
});
