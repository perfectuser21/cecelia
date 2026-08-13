import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import pool from '../../db.js';
import { resolveF1Certification } from '../../map/f1-certification.js';

// F1 Capability 可重复认证闭环 — nightly 负向矩阵（真 PG，禁 mock 被改的边）。
// integration-nightly.yml 起真 postgres service 跑；本文件登记进 vitest.config.js
// POSTGRES_INTEGRATION_TESTS。全程真库真行：golden_path_contract_versions /
// journey_step_links / journey_features / journey_assertion_receipts + Mapper 聚合。

const digest64 = (value) => createHash('sha256').update(value).digest('hex');
const sha40 = (seed) => digest64(seed).slice(0, 40);
const OUTPUT_DIGEST = digest64('seed output');
const ASSERTION_DIGEST = digest64('assertion ref');
const ASSERTION_REF = 'src/map/f1-certification.js';

let client;

/**
 * 在当前事务内播撒一套独立的冻结身份 + F1 骨架（随机 UUID，互不干扰），
 * 可选落 Feature 绑定与 receipt。返回认证入参所需 id 与正确 hash。
 */
async function seedScenario({ withFeature = true, receipt = null } = {}) {
  const journeyId = (await client.query(
    "INSERT INTO journeys (name, journey_type) VALUES ($1, 'autonomous') RETURNING id",
    [`f1-cert-${randomUUID()}`]
  )).rows[0].id;
  const stepId = (await client.query(
    "INSERT INTO journey_steps (journey_id, name, step_number) VALUES ($1, 'F1 step', 1) RETURNING id",
    [journeyId]
  )).rows[0].id;
  const goldenPathId = (await client.query(
    "INSERT INTO golden_paths (title, one_liner, journey_id, status) VALUES ('F1', 'F1 cert', $1, 'in_dev') RETURNING id",
    [journeyId]
  )).rows[0].id;
  const contractHash = digest64(`contract-${goldenPathId}`);
  const contractId = (await client.query(
    `INSERT INTO golden_path_contract_versions
       (golden_path_id, schema_version, version, contract_json, content_hash, status, signed_at)
     VALUES ($1, 1, 1, '{}'::jsonb, $2, 'signed', NOW()) RETURNING id`,
    [goldenPathId, contractHash]
  )).rows[0].id;

  let featureId = null;
  if (withFeature) {
    featureId = (await client.query(
      "INSERT INTO journey_features (journey_id, name, status) VALUES ($1, 'F1 feature', 'done') RETURNING id",
      [journeyId]
    )).rows[0].id;
  }

  const cell = (await client.query(
    `INSERT INTO journey_step_links
       (journey_id, step_id, step_order, feature_id, cell_kind, cell_key, cell_status, assertion_ref)
     VALUES ($1, $2, 1, $3, 'capability', 'F1', 'green', $4)
     RETURNING id, assertion_revision`,
    [journeyId, stepId, featureId, ASSERTION_REF]
  )).rows[0];
  const jslId = cell.id;
  const assertionRevision = Number(cell.assertion_revision);

  if (receipt) {
    const isPass = receipt.verdict === 'PASS';
    const now = new Date();
    const started = new Date(now.getTime() - 1000);
    await client.query(
      `INSERT INTO journey_assertion_receipts (
         journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
         assertion_digest, source_repo, source_sha, gp_contract_id, gp_contract_hash,
         command_argv, verdict, exit_code, scenario_count, scenario_evidence,
         machine_id, output_digest, output_tail, synthetic, started_at, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'cecelia', $6, $7, $8,
         $9::jsonb, $10, $11, $12, $13::jsonb,
         'integration-test', $14, 'seeded', false, $15, $16
       )`,
      [
        jslId,
        `f1-cert-${randomUUID()}`,
        assertionRevision,
        ASSERTION_REF,
        ASSERTION_DIGEST,
        receipt.source_sha,
        contractId,
        contractHash,
        JSON.stringify(['npx', 'vitest', 'run', ASSERTION_REF]),
        receipt.verdict,
        isPass ? 0 : 1,
        isPass ? 1 : 0,
        JSON.stringify(isPass ? { kind: 'seed', passed: 1 } : {}),
        OUTPUT_DIGEST,
        started.toISOString(),
        now.toISOString(),
      ]
    );
  }

  return { journeyId, stepId, contractId, contractHash, jslId };
}

function certifyParams(scenario, { hash, expectedMergeSha }) {
  return {
    capability: 'F1',
    gp_contract_id: scenario.contractId,
    gp_contract_version: 1,
    gp_contract_hash: hash,
    journey_id: scenario.journeyId,
    step_id: scenario.stepId,
    expected_merge_sha: expectedMergeSha,
  };
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

describe('F1 Capability certification 负向矩阵 [PostgreSQL]', () => {
  it('同 cell 上更新但不属于当前 GP Contract 的 receipt 不得遮蔽精确回执', async () => {
    const mergeSha = sha40('gp-exact-merge');
    const scenario = await seedScenario({ receipt: { verdict: 'PASS', source_sha: mergeSha } });
    const now = new Date();
    await client.query(
      `INSERT INTO journey_assertion_receipts (
         journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
         assertion_digest, source_repo, source_sha, command_argv, verdict, exit_code,
         scenario_count, scenario_evidence, machine_id, output_digest, output_tail,
         synthetic, started_at, completed_at
       ) VALUES (
         $1, $2, 1, $3, $4, 'cecelia', $5, $6::jsonb, 'PASS', 0,
         1, $7::jsonb, 'integration-test', $8, 'distractor', false, $9, $10
       )`,
      [
        scenario.jslId,
        `f1-cert-distractor-${randomUUID()}`,
        ASSERTION_REF,
        ASSERTION_DIGEST,
        sha40('wrong-gp-newer-sha'),
        JSON.stringify(['npx', 'vitest', 'run', ASSERTION_REF]),
        JSON.stringify({ kind: 'distractor', passed: 1 }),
        OUTPUT_DIGEST,
        new Date(now.getTime() - 500).toISOString(),
        now.toISOString(),
      ]
    );

    const body = await resolveF1Certification(client, certifyParams(scenario, {
      hash: scenario.contractHash,
      expectedMergeSha: mergeSha,
    }));

    expect(body.state).toBe('green');
    expect(body.merge_sha).toBe(mergeSha);
  });

  it('非 synthetic PASS receipt 精确落账 → 端点回读 green（同一行）', async () => {
    const mergeSha = sha40('green-merge');
    const scenario = await seedScenario({ receipt: { verdict: 'PASS', source_sha: mergeSha } });
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: scenario.contractHash, expectedMergeSha: mergeSha }));

    expect(body.capability).toBe('F1');
    expect(body.state).toBe('green');
    expect(body.reason_code).toBe('pass_current_revision');
    expect(body.synthetic).toBe(false);
    expect(typeof body.receipt_id).toBe('string');
    expect(body.merge_sha).toBe(mergeSha);

    // 端点 receipt_id 与库行同一：真在库、PASS、非 synthetic
    const row = await client.query(
      "SELECT count(*)::int AS c FROM journey_assertion_receipts WHERE id=$1 AND verdict='PASS' AND synthetic=false AND source_sha=$2",
      [body.receipt_id, mergeSha]
    );
    expect(row.rows[0].c).toBe(1);
  });

  it('无合同时不 green（contract_identity_mismatch）', async () => {
    const mergeSha = sha40('nc-merge');
    const scenario = await seedScenario({ receipt: { verdict: 'PASS', source_sha: mergeSha } });
    const wrongHash = digest64('not-a-signed-contract');
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: wrongHash, expectedMergeSha: mergeSha }));

    expect(body.state).not.toBe('green');
    expect(body.reason_code).toBe('contract_identity_mismatch');
    expect(body.receipt_id).toBeNull();
  });

  it('无 receipt 时不 green（no_receipt，补证据非缺陷）', async () => {
    const scenario = await seedScenario({ receipt: null });
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: scenario.contractHash, expectedMergeSha: sha40('nr-merge') }));

    expect(body.state).not.toBe('green');
    expect(body.state).toBe('gray');
    expect(body.reason_code).toBe('no_receipt');
  });

  it('错 SHA 时不 green（revision_mismatch，拒绝共享 clock）', async () => {
    const scenario = await seedScenario({ receipt: { verdict: 'PASS', source_sha: sha40('stored-sha') } });
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: scenario.contractHash, expectedMergeSha: sha40('expected-sha') }));

    expect(body.state).not.toBe('green');
    expect(body.state).toBe('unknown');
    expect(body.reason_code).toBe('revision_mismatch');
  });

  it('缺 Feature 时不 green（anchor_target_missing）', async () => {
    const mergeSha = sha40('mf-merge');
    const scenario = await seedScenario({ withFeature: false, receipt: null });
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: scenario.contractHash, expectedMergeSha: mergeSha }));

    expect(body.state).not.toBe('green');
    expect(body.reason_code).toBe('anchor_target_missing');
  });

  it('receipt FAIL 时判缺陷 red（receipt_fail，与 no_receipt 语义区分）', async () => {
    const mergeSha = sha40('rf-merge');
    const scenario = await seedScenario({ receipt: { verdict: 'FAIL', source_sha: sha40('rf-stored') } });
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: scenario.contractHash, expectedMergeSha: mergeSha }));

    expect(body.state).toBe('red');
    expect(body.reason_code).toBe('receipt_fail');
  });

  it('缺 expected_merge_sha 一律 fail-closed 不 green（validation-clock）', async () => {
    const scenario = await seedScenario({ receipt: { verdict: 'PASS', source_sha: sha40('vc-merge') } });
    const body = await resolveF1Certification(client, certifyParams(scenario, { hash: scenario.contractHash, expectedMergeSha: null }));

    expect(body.state).not.toBe('green');
  });
});
