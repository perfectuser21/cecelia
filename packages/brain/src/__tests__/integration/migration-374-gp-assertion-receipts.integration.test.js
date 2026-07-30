import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pool from '../../db.js';
import { deriveAssertionVerification } from '../../lib/journey-assertion-receipt.js';
const migration = readFileSync(new URL(
  '../../../migrations/374_gp_assertion_receipts.sql', import.meta.url,
), 'utf8');
const fixture = `gp-assertion-receipt-${process.pid}-${randomUUID()}`;
const assertionRef = 'src/lib/__tests__/journey-assertion-receipt.test.js';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const assertionDigest = digest(assertionRef);
const outputDigest = digest('4 tests passed');
let client, cellId, assertionRevision, featureId;
async function insertReceipt(overrides = {}, conflict = '') {
  const value = {
    runId: `${fixture}-${randomUUID()}`, revision: assertionRevision,
    ref: assertionRef, digest: assertionDigest, sourceRepo: 'cecelia',
    sourceSha: 'a'.repeat(40), gpContractId: null, gpContractHash: null,
    commandArgv: ['npx', 'vitest', 'run', assertionRef],
    scenarioCount: 4, scenarioEvidence: { kind: 'vitest', passed: 4 },
    verdict: 'PASS', exitCode: 0, machineId: 'integration-test',
    outputDigest, synthetic: false, startedAt: '2026-07-30T00:00:00Z',
    completedAt: '2026-07-30T00:00:01Z', ...overrides,
  };
  return client.query(
    `INSERT INTO journey_assertion_receipts (
      journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
      assertion_digest, source_repo, source_sha, gp_contract_id, gp_contract_hash,
      command_argv, verdict, exit_code, scenario_count, scenario_evidence,
      machine_id, output_digest, output_tail,
      synthetic, started_at, completed_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,
      '4 tests passed',$17,$18,$19
    ) ${conflict} RETURNING *`,
    [cellId, value.runId, value.revision, value.ref, value.digest, value.sourceRepo,
      value.sourceSha, value.gpContractId, value.gpContractHash,
      JSON.stringify(value.commandArgv), value.verdict, value.exitCode,
      value.scenarioCount, JSON.stringify(value.scenarioEvidence),
      value.machineId, value.outputDigest, value.synthetic, value.startedAt, value.completedAt],
  );
}
async function expectConstraintFailure(query) {
  await client.query('SAVEPOINT expected_failure');
  try {
    await expect(query()).rejects.toThrow();
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}
async function rejectReceipts(values) {
  for (const value of values) await expectConstraintFailure(() => insertReceipt(value));
}
beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query(migration);
  await client.query(migration);
  const journeyId = (await client.query(
    `INSERT INTO journeys (name, description)
     VALUES ($1, 'assertion receipt migration fixture') RETURNING id`, [fixture],
  )).rows[0].id;
  const stepId = (await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number)
     VALUES ($1, 'execute assertion', 1) RETURNING id`, [journeyId],
  )).rows[0].id;
  const cell = (await client.query(
    `INSERT INTO journey_step_links (
      journey_id, step_id, step_order, cell_kind, cell_key, cell_status, assertion_ref
    ) VALUES ($1,$2,1,'element','FR','green',$3)
    RETURNING id, assertion_revision`, [journeyId, stepId, assertionRef],
  )).rows[0];
  cellId = cell.id;
  assertionRevision = Number(cell.assertion_revision);
  featureId = (await client.query(
    'INSERT INTO journey_features (journey_id, name) VALUES ($1,$2) RETURNING id',
    [journeyId, `${fixture}-feature`],
  )).rows[0].id;
});
afterAll(async () => {
  if (client) { await client.query('ROLLBACK'); client.release(); }
  await pool.end();
});
describe('migration 374 Golden Path assertion receipts [PostgreSQL]', () => {
  it('is idempotent and registers its schema version', async () => {
    const version = await client.query("SELECT description FROM schema_version WHERE version='374'");
    const column = await client.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_name='journey_step_links' AND column_name='assertion_revision'`,
    );
    expect(version.rows).toHaveLength(1);
    expect(column.rows).toEqual([
      expect.objectContaining({ is_nullable: 'NO', column_default: '1' }),
    ]);
  });
  it('rejects PASS without zero exit, source SHA, or output digest', async () => {
    await rejectReceipts([
      { exitCode: 1 }, { sourceSha: null }, { sourceSha: 'short-sha' },
      { sourceSha: 'A'.repeat(40) }, { outputDigest: null },
      { verdict: 'FAIL', exitCode: 0 },
    ]);
  });
  it('rejects zero-scenario PASS but records timeout FAIL evidence', async () => {
    await rejectReceipts([{ scenarioCount: 0, scenarioEvidence: {} }]);
    const timeout = (await insertReceipt({
      verdict: 'FAIL', exitCode: 124, scenarioCount: 0,
      scenarioEvidence: { kind: 'timeout', timeout_ms: 300000 },
    })).rows[0];
    expect(timeout).toMatchObject({
      verdict: 'FAIL', exit_code: 124, scenario_count: 0,
      scenario_evidence: { kind: 'timeout', timeout_ms: 300000 },
    });
  });
  it('rejects synthetic execution receipts', async () => {
    await rejectReceipts([{ synthetic: true }]);
  });
  it('rejects empty argv, reversed intervals, and incomplete contract snapshots', async () => {
    await rejectReceipts([
      { commandArgv: [] },
      { startedAt: '2026-07-30T00:00:02Z', completedAt: '2026-07-30T00:00:01Z' },
      { gpContractHash: 'b'.repeat(64) }, { gpContractId: randomUUID() },
      { gpContractHash: 'not-a-contract-hash' },
    ]);
  });
  it('rejects PASS without a machine identity', async () => {
    await rejectReceipts([{ machineId: null }]);
  });
  it('makes repeated run delivery idempotent by run and cell', async () => {
    const runId = `${fixture}-idempotent`;
    await insertReceipt({ runId });
    const repeated = await insertReceipt(
      { runId }, 'ON CONFLICT (run_id, journey_step_link_id) DO NOTHING',
    );
    const count = await client.query(
      `SELECT COUNT(*)::int AS count FROM journey_assertion_receipts
       WHERE run_id=$1 AND journey_step_link_id=$2`, [runId, cellId],
    );
    expect(repeated.rows).toHaveLength(0);
    expect(count.rows[0].count).toBe(1);
  });
  it('rejects UPDATE and DELETE of an existing receipt', async () => {
    const id = (await insertReceipt()).rows[0].id;
    for (const sql of [
      "UPDATE journey_assertion_receipts SET output_tail='tampered' WHERE id=$1",
      'DELETE FROM journey_assertion_receipts WHERE id=$1',
    ]) {
      await expectConstraintFailure(() => client.query(sql, [id]));
    }
  });
  it('prevents deleting a parent cell that has an immutable receipt', async () => {
    await insertReceipt();
    await expectConstraintFailure(() => client.query(
      'DELETE FROM journey_step_links WHERE id=$1', [cellId],
    ));
  });
  it('increments revision and makes the old receipt non-current', async () => {
    const receipt = await insertReceipt();
    const cell = (await client.query(
      `UPDATE journey_step_links SET assertion_ref=$2 WHERE id=$1
       RETURNING assertion_ref, assertion_revision`,
      [cellId, 'src/lib/__tests__/changed.test.js'],
    )).rows[0];
    expect(Number(cell.assertion_revision)).toBe(assertionRevision + 1);
    expect(deriveAssertionVerification(cell, receipt.rows)).toMatchObject({
      state: 'never_run', verified: false, assertion_current: false,
    });
  });
  it('bumps revision for every contract field and prevents revision tampering', async () => {
    let current = Number((await client.query(
      'SELECT assertion_revision FROM journey_step_links WHERE id=$1', [cellId],
    )).rows[0].assertion_revision);
    for (const [column, value] of [
      ['cell_key', `${fixture}-changed-key`], ['feature_id', featureId],
      ['na_reason', 'not applicable after contract revision'],
    ]) {
      const changed = await client.query(
        `UPDATE journey_step_links SET ${column}=$2 WHERE id=$1
         RETURNING assertion_revision`, [cellId, value],
      );
      expect(Number(changed.rows[0].assertion_revision)).toBe(++current);
    }
    for (const sql of [
      'UPDATE journey_step_links SET na_reason=na_reason WHERE id=$1 RETURNING assertion_revision',
      'UPDATE journey_step_links SET assertion_revision=999999 WHERE id=$1 RETURNING assertion_revision',
    ]) {
      const changed = await client.query(sql, [cellId]);
      expect(Number(changed.rows[0].assertion_revision)).toBe(current);
    }
  });
});
