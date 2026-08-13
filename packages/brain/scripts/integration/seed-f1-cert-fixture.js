#!/usr/bin/env node
/**
 * seed-f1-cert-fixture.js — 幂等 F1 认证 fixture 播种器
 *
 * Sprint: F1 Capability 可重复认证闭环 kernel-v1（20260813-r3）
 *
 * 供 PR-CI smoke（sprints/.../tests/f1-certification-smoke.test.ts）、
 * nightly 负向矩阵、DoD manual:bash 与 final-e2e 复用。真 PG，禁 mock 被改的边。
 *
 * 用法: node packages/brain/scripts/integration/seed-f1-cert-fixture.js <case>
 *   case ∈ green | no_receipt | wrong_sha | missing_feature | no_contract | receipt_fail
 *
 * 连接: 优先 DATABASE_URL / DB_URL（final-e2e 注入 attempt 级空库；smoke 由测试注入），
 *       否则由 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD 拼装（与测试 resolveDbUrl 镜像）。
 *
 * 输出: 最后一行是 JSON —— { journey_step_link_id, source_sha, gp_contract_hash, case }。
 *
 * 幂等: 冻结身份/骨架用固定 UUID upsert；receipt 每次 TRUNCATE 后按 case 重播
 *       （journey_assertion_receipts append-only，DELETE 被触发器拦截，TRUNCATE 不触发行级触发器）。
 */

import pg from 'pg';

// ── 冻结身份（task_bundle SSOT，跨角色/GAN 轮次不变）───────────────────────
const GOLDEN_PATH_ID = '8943227f-20dd-4c54-ad06-d12e6ed2e705';
const GP_CONTRACT_ID = '48ef45ab-83a1-48b7-a4d5-d4afba9ccaf3';
const GP_HASH = '3ade5843bbd84777bd3b1a3bb2cdd0bb6c8da83bf611ce307bb26f169dee15c8';
const JOURNEY_ID = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';
const STEP_ID = 'aad25bdb-bdd6-47f4-9a99-e1176e23ac8b';

// ── fixture 稳定 UUID（seed 私有，非认证身份）──────────────────────────────
const FEATURE_ID = 'f1f1f1f1-0000-4000-8000-000000000001';
const JSL_ID = 'f1f1f1f1-0000-4000-8000-0000000000c1';

// ── 稳定 SHA / hash（40hex / 64hex，满足 DB CHECK）────────────────────────
const GREEN_SHA = 'a1'.repeat(20);        // green 正向：receipt 与 expected 一致
const WRONG_EXPECTED_SHA = 'b2'.repeat(20); // wrong_sha：调用方传的 expected
const WRONG_STORED_SHA = 'c3'.repeat(20);   // wrong_sha：receipt 实存（与 expected 不一致）
const GENERIC_SHA = 'd4'.repeat(20);      // 无 receipt / 缺 Feature / 无合同 / FAIL
const WRONG_HASH = 'e5'.repeat(32);       // no_contract：合法 64hex 但非 signed 合同
const OUTPUT_DIGEST = 'f6'.repeat(32);    // 64hex
const ASSERTION_DIGEST = '0a'.repeat(32); // 64hex
const ASSERTION_REF = 'sprints/0813-f1-capability-certification-r3/tests/f1-certification-smoke.test.ts';

const CASES = new Set(['green', 'no_receipt', 'wrong_sha', 'missing_feature', 'no_contract', 'receipt_fail']);

function resolveConnection() {
  const connectionString = process.env.DATABASE_URL || process.env.DB_URL;
  if (connectionString) return { connectionString };
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'cecelia',
    user: process.env.DB_USER || 'cecelia',
    password: process.env.DB_PASSWORD || 'cecelia',
  };
}

async function seedIdentitySkeleton(client, { featureId }) {
  // 冻结身份 + F1 journey 骨架，全用固定 UUID upsert（幂等）。
  await client.query(
    `INSERT INTO journeys (id, name, journey_type)
     VALUES ($1, 'F1 可重复认证 Golden Path', 'autonomous')
     ON CONFLICT (id) DO NOTHING`,
    [JOURNEY_ID]
  );
  // step_number 用高位值，避开与 migration 386/398 后续可能补的 F1 步号冲突
  // （UNIQUE(journey_id, step_number)；端点按 step_id 查，step_number 仅占位）。
  await client.query(
    `INSERT INTO journey_steps (id, journey_id, name, step_number)
     VALUES ($1, $2, 'F1 认证步', 9001)
     ON CONFLICT (id) DO NOTHING`,
    [STEP_ID, JOURNEY_ID]
  );
  await client.query(
    `INSERT INTO golden_paths (id, title, one_liner, journey_id, status)
     VALUES ($1, 'F1 可重复认证', 'F1 从碎片化功能升级为可重复认证的 Capability', $2, 'in_dev')
     ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_PATH_ID, JOURNEY_ID]
  );
  // signed 冻结合同：始终以正确 hash 落账（no_contract 由调用方传错 hash 触发不匹配）
  await client.query(
    `INSERT INTO golden_path_contract_versions
       (id, golden_path_id, schema_version, version, contract_json, content_hash, status, signed_at)
     VALUES ($1, $2, 1, 1, '{}'::jsonb, $3, 'signed', NOW())
     ON CONFLICT (id) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       status = 'signed',
       contract_json = EXCLUDED.contract_json`,
    [GP_CONTRACT_ID, GOLDEN_PATH_ID, GP_HASH]
  );
  await client.query(
    `INSERT INTO journey_features (id, journey_id, name, status)
     VALUES ($1, $2, 'F1 认证能力件', 'done')
     ON CONFLICT (id) DO NOTHING`,
    [FEATURE_ID, JOURNEY_ID]
  );
  // F1 cell：feature_id 由 case 决定（missing_feature → NULL）
  const cell = await client.query(
    `INSERT INTO journey_step_links
       (id, journey_id, step_id, step_order, feature_id, cell_kind, cell_key, cell_status, assertion_ref)
     VALUES ($1, $2, $3, 1, $4, 'capability', 'F1', 'green', $5)
     ON CONFLICT (id) DO UPDATE SET
       feature_id = EXCLUDED.feature_id,
       cell_status = EXCLUDED.cell_status,
       assertion_ref = EXCLUDED.assertion_ref
     RETURNING id, assertion_revision`,
    [JSL_ID, JOURNEY_ID, STEP_ID, featureId, ASSERTION_REF]
  );
  return {
    jslId: cell.rows[0].id,
    assertionRevision: Number(cell.rows[0].assertion_revision),
  };
}

async function insertReceipt(client, { jslId, assertionRevision, verdict, exitCode, sourceSha }) {
  const now = new Date();
  const started = new Date(now.getTime() - 1000);
  const isPass = verdict === 'PASS';
  await client.query(
    `INSERT INTO journey_assertion_receipts (
       journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
       assertion_digest, source_repo, source_sha, gp_contract_id, gp_contract_hash,
       command_argv, verdict, exit_code, scenario_count, scenario_evidence,
       machine_id, output_digest, output_tail, synthetic, started_at, completed_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, 'cecelia', $6, $7, $8,
       $9::jsonb, $10, $11, $12, $13::jsonb,
       'seed-f1-cert-fixture', $14, 'seeded by seed-f1-cert-fixture', false, $15, $16
     )`,
    [
      jslId,
      `f1-cert-seed-${verdict}-${Date.now()}`,
      assertionRevision,
      ASSERTION_REF,
      ASSERTION_DIGEST,
      sourceSha,
      GP_CONTRACT_ID,
      GP_HASH,
      JSON.stringify(['npx', 'vitest', 'run', ASSERTION_REF]),
      verdict,
      exitCode,
      isPass ? 1 : 0,
      JSON.stringify(isPass ? { kind: 'seed', passed: 1 } : {}),
      OUTPUT_DIGEST,
      started.toISOString(),
      now.toISOString(),
    ]
  );
}

async function main() {
  const kase = process.argv[2];
  if (!kase || !CASES.has(kase)) {
    process.stderr.write(`ERROR: 未知 case "${kase || ''}"；允许: ${[...CASES].join(', ')}\n`);
    process.exit(1);
  }

  const client = new pg.Client(resolveConnection());
  await client.connect();
  try {
    const featureId = kase === 'missing_feature' ? null : FEATURE_ID;
    const { jslId, assertionRevision } = await seedIdentitySkeleton(client, { featureId });

    // receipt 状态每次重置后按 case 重播（append-only：只能 TRUNCATE 清空）
    await client.query('TRUNCATE journey_assertion_receipts');

    let sourceSha = GENERIC_SHA;
    let gpContractHash = GP_HASH;

    switch (kase) {
      case 'green':
        sourceSha = GREEN_SHA;
        await insertReceipt(client, { jslId, assertionRevision, verdict: 'PASS', exitCode: 0, sourceSha: GREEN_SHA });
        break;
      case 'wrong_sha':
        sourceSha = WRONG_EXPECTED_SHA; // 调用方传 expected
        await insertReceipt(client, { jslId, assertionRevision, verdict: 'PASS', exitCode: 0, sourceSha: WRONG_STORED_SHA });
        break;
      case 'receipt_fail':
        sourceSha = GENERIC_SHA;
        await insertReceipt(client, { jslId, assertionRevision, verdict: 'FAIL', exitCode: 1, sourceSha: GENERIC_SHA });
        break;
      case 'no_contract':
        gpContractHash = WRONG_HASH; // 调用方用错 hash → contract_identity_mismatch
        break;
      case 'no_receipt':
      case 'missing_feature':
      default:
        // 不落 receipt
        break;
    }

    process.stdout.write(
      JSON.stringify({
        case: kase,
        journey_step_link_id: jslId,
        source_sha: sourceSha,
        gp_contract_hash: gpContractHash,
        gp_contract_id: GP_CONTRACT_ID,
        journey_id: JOURNEY_ID,
        step_id: STEP_ID,
      }) + '\n'
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`seed-f1-cert-fixture failed: ${err.stack || err.message}\n`);
  process.exit(1);
});
