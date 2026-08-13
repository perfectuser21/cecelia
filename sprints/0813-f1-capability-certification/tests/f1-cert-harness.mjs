#!/usr/bin/env node
/**
 * F1 Capability 认证闭环 — E2E oracle harness（真 Postgres，可丢弃 fixture）。
 *
 * 用法:
 *   node f1-cert-harness.mjs --scenario=S0-happy|S1-unsigned|S3-receipt-binding|S5-steplink|S6-evaluator-write|INV1-identity-failclosed
 *   node f1-cert-harness.mjs --mode=full        # 跑全 fail-closed 矩阵
 *
 * 自建 Pool 连 Fleet 注入的 DB_URL（不经 _test 名守护的全局 pool），把 client 注入被测的真实读路径
 * loadMapNodeStates / 写路径 persistTrustedEvaluatorReceipts —— 真库、真 resolver、无 mock 被改的边。
 * 全程一个事务，退出前 ROLLBACK（可丢弃 fixture 不残留）。观察与期望不符 → exit 1（fail-closed 未生效=红证据）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

import { digestMapManifest } from '../../../packages/brain/src/lib/map-manifest-schema.js';
import { projectMapManifest } from '../../../packages/brain/src/lib/map-projection-store.js';
import { loadMapNodeStates } from '../../../packages/brain/src/lib/map-state-resolver.js';
import { persistTrustedEvaluatorReceipts } from '../../../packages/brain/src/impact-contract/assertion-receipts.js';

const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error('FAIL: DB_URL 未注入'); process.exit(2); }

const args = process.argv.slice(2);
const modeFull = args.includes('--mode=full');
const scenarioArg = (args.find((a) => a.startsWith('--scenario=')) || '').split('=')[1];

const digest = (v) => createHash('sha256').update(String(v)).digest('hex');

const fixtureManifest = JSON.parse(readFileSync(
  new URL('../../../packages/brain/config/map-manifests/cecelia.v1.json', import.meta.url),
  'utf8',
));

const scopeKey = `f1-cert-e2e-${process.pid}-${randomUUID().slice(0, 8)}`;
const repo = `${scopeKey}-repo`;
const capabilityKey = `IT_${randomUUID().replaceAll('-', '')}`;
const testPath = `tests/${randomUUID()}.test.js`;
const sourcePath = `src/${randomUUID()}.js`;
const revision = 'a'.repeat(40);
const now = new Date();

const ctx = {};

async function seedBase(client) {
  const decisionId = randomUUID();
  await client.query(
    `INSERT INTO decisions (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1,'feature',$2,'f1 cert e2e','fail-closed proof','active','codex','user','P2')`,
    [decisionId, scopeKey],
  );
  await client.query(
    `INSERT INTO map_scope_repositories (scope_key, repo, adapter_key, adapter_config)
     VALUES ($1,$2,'legacy-ledger-v1','{"ledger_partition":"infrastructure"}'::jsonb)`,
    [scopeKey, repo],
  );
  const journey = await client.query(
    `INSERT INTO journeys (name, biz_area, capability_code) VALUES ($1,'infrastructure',$2) RETURNING id`,
    [scopeKey, capabilityKey],
  );
  ctx.journeyId = journey.rows[0].id;
  const step = await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number) VALUES ($1,'cert step',1) RETURNING id`,
    [ctx.journeyId],
  );
  ctx.stepId = step.rows[0].id;
  const feature = await client.query(
    `INSERT INTO journey_features (journey_id, step_id, name, unit_test_path) VALUES ($1,$2,'cert feature',$3) RETURNING id`,
    [ctx.journeyId, ctx.stepId, testPath],
  );
  ctx.featureId = feature.rows[0].id;
  const link = await client.query(
    `INSERT INTO journey_step_links
       (journey_id, step_id, feature_id, cell_kind, cell_key, cell_status, assertion_ref)
     VALUES ($1,$2,$3,'capability',$4,'green',$5) RETURNING id`,
    [ctx.journeyId, ctx.stepId, ctx.featureId, capabilityKey, testPath],
  );
  ctx.linkId = link.rows[0].id;
  const gp = await client.query(
    `INSERT INTO golden_paths (title, one_liner, journey_id) VALUES ('f1 cert gp','fail-closed cert',$1) RETURNING id`,
    [ctx.journeyId],
  );
  const contract = await client.query(
    `INSERT INTO golden_path_contract_versions
       (golden_path_id, version, contract_json, content_hash, status, signed_by, signed_at)
     VALUES ($1,1,'{"gp":"f1"}'::jsonb,$2,'signed','owner',NOW()) RETURNING id, content_hash`,
    [gp.rows[0].id, digest(`gp-contract-${scopeKey}`)],
  );
  ctx.signedContractId = contract.rows[0].id;
  ctx.signedContractHash = contract.rows[0].content_hash;
  await client.query(
    `INSERT INTO test_registry (repo, file_path, source_revision, scanner_version, scanned_at)
     VALUES ($1,$2,$3,'test-registry-v2',$4)`,
    [repo, testPath, revision, now],
  );
  await client.query(
    `INSERT INTO graph_edges (repo, src_path, dst_path, edge_type, source_revision, scanner_version, scanned_at)
     VALUES ($1,$2,$3,'import',$4,'graph-v3',$5)`,
    [repo, testPath, sourcePath, revision, now],
  );
  await client.query(
    `INSERT INTO fact_snapshot_headers (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES ('test',$1,$2,'test-registry-v2',$3,1),('graph',$1,$2,'graph-v3',$3,1),
            ('api',$1,$2,'api-registry-v2',$3,0),('db_schema',$1,$2,'db-schema-v2',$3,0)`,
    [repo, revision, now],
  );
  const manifest = structuredClone(fixtureManifest);
  manifest.scope_key = scopeKey;
  manifest.source_decision_id = decisionId;
  const oldKey = manifest.capabilities[0].key;
  manifest.capabilities[0].key = capabilityKey;
  manifest.boundaries = manifest.boundaries.map((b) => ({
    ...b,
    from: b.from === oldKey ? capabilityKey : b.from,
    to: b.to === oldKey ? capabilityKey : b.to,
  }));
  const version = await client.query(
    `INSERT INTO map_manifest_versions
       (scope_key, version, source_decision_id, manifest, digest, status, activated_at)
     VALUES ($1,1,$2,$3::jsonb,$4,'active',NOW())
     RETURNING id, scope_key, version, source_decision_id, manifest, digest, status, created_at, activated_at`,
    [scopeKey, decisionId, JSON.stringify(manifest), digestMapManifest(manifest)],
  );
  await projectMapManifest({ client, manifestVersion: version.rows[0] });
}

async function seedReceipt(client, overrides = {}) {
  const b = {
    gp_contract_id: ctx.signedContractId,
    gp_contract_hash: ctx.signedContractHash,
    impact_contract_id: randomUUID(),
    impact_contract_hash: digest(`impact-${randomUUID()}`),
    source_sha: revision,
    ...overrides,
  };
  await client.query(
    `INSERT INTO journey_assertion_receipts (
       journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
       assertion_digest, source_repo, source_sha, command_argv, verdict, exit_code,
       scenario_count, scenario_evidence, machine_id, output_digest, output_tail,
       started_at, completed_at, gp_contract_id, gp_contract_hash,
       impact_contract_id, impact_contract_hash
     ) VALUES ($1,$2,1,$3,$4,$5,$6,$7::jsonb,'PASS',0,1,$8::jsonb,
       'f1-cert-e2e',$9,'e2e receipt',$10,$11,$12,$13,$14,$15)`,
    [
      ctx.linkId, `${scopeKey}-${randomUUID()}`, testPath, digest(testPath), repo,
      b.source_sha, JSON.stringify(['npx', 'vitest', 'run', testPath]),
      JSON.stringify({ kind: 'vitest', scenario: testPath }), digest(`pass-${randomUUID()}`),
      new Date(now.getTime()), new Date(now.getTime() + 1000),
      b.gp_contract_id, b.gp_contract_hash, b.impact_contract_id, b.impact_contract_hash,
    ],
  );
}

const readAt = new Date(now.getTime() + 2000);
const capState = async (client) => {
  const r = await loadMapNodeStates(client, { scopeKey, now: readAt });
  return r.states.find((s) => s.node_key === capabilityKey) || { status: 'missing', reason_code: 'missing' };
};

function evaluatorBundle(sha) {
  const impactHash = digest(`impact-${scopeKey}`);
  return {
    attempt: {
      role: 'evaluator', id: randomUUID(), run_id: `run-${randomUUID()}`,
      actual_machine_id: 'e2e-machine',
      task_bundle: {
        inputs: {
          pull_request: { head_sha: sha },
          impact_gate: { contract_id: randomUUID(), contract_hash: impactHash, repo, head_revision: sha },
          required_assertions: [{
            assertion_id: testPath, journey_step_link_id: ctx.linkId, assertion_revision: 1,
            assertion_digest: digest(testPath),
            source_bindings: [{ journey_step_link_id: ctx.linkId, assertion_revision: 1, assertion_digest: digest(testPath) }],
          }],
        },
      },
    },
    result: {
      status: 'completed', decision: { outcome: 'PASS' },
      checks: [{
        assertion_id: testPath, journey_step_link_id: ctx.linkId, assertion_revision: 1,
        assertion_digest: digest(testPath), command_argv: ['npx', 'vitest', 'run', testPath],
        exit_code: 0, output_digest: digest(`out-${scopeKey}`), output_tail: 'ok', scenario_count: 1,
        scenario_evidence: { pr_head_sha: sha, machine: 'e2e-machine', cases: ['case-1'] },
        started_at: new Date(now.getTime()).toISOString(),
        completed_at: new Date(now.getTime() + 1000).toISOString(),
      }],
    },
  };
}

// 每个 scenario 返回 { lines: string[], ok: boolean }
const SCENARIOS = {
  'S0-happy': async (client) => {
    await seedReceipt(client);
    const s = await capState(client);
    const ok = s.status === 'green';
    return { lines: [`RESULT S0-happy state=${s.status} reason=${s.reason_code}`], ok };
  },
  'S1-unsigned': async (client) => {
    await client.query(`UPDATE golden_path_contract_versions SET status='pending_signature', signed_at=NULL WHERE id=$1`, [ctx.signedContractId]);
    await seedReceipt(client);
    const s = await capState(client);
    const ok = s.status !== 'green' && s.reason_code === 'gp_contract_unsigned';
    return { lines: [`RESULT S1-unsigned state=${s.status} reason=${s.reason_code}`], ok };
  },
  'S3-receipt-binding': async (client) => {
    const lines = []; let ok = true;
    // (a) gp identity 未绑定
    await client.query('SAVEPOINT s3a');
    await seedReceipt(client, { gp_contract_id: null, gp_contract_hash: null });
    let s = await capState(client);
    ok = ok && s.status !== 'green' && s.reason_code === 'receipt_gp_contract_unbound';
    lines.push(`RESULT S3a state=${s.status} reason=${s.reason_code}`);
    await client.query('ROLLBACK TO SAVEPOINT s3a');
    // (b) impact 未绑定
    await client.query('SAVEPOINT s3b');
    await seedReceipt(client, { impact_contract_id: null, impact_contract_hash: null });
    s = await capState(client);
    ok = ok && s.status !== 'green' && s.reason_code === 'receipt_impact_contract_unbound';
    lines.push(`RESULT S3b state=${s.status} reason=${s.reason_code}`);
    await client.query('ROLLBACK TO SAVEPOINT s3b');
    // (c) 陈旧 SHA
    await client.query('SAVEPOINT s3c');
    await seedReceipt(client, { source_sha: 'c'.repeat(40) });
    s = await capState(client);
    ok = ok && s.status !== 'green' && s.reason_code === 'receipt_revision_mismatch';
    lines.push(`RESULT S3c state=${s.status} reason=${s.reason_code}`);
    await client.query('ROLLBACK TO SAVEPOINT s3c');
    return { lines, ok };
  },
  'S5-steplink': async (client) => {
    await seedReceipt(client);
    await client.query(`UPDATE journey_step_links SET assertion_ref=NULL WHERE id=$1`, [ctx.linkId]);
    const s = await capState(client);
    const ok = s.status !== 'green' && s.reason_code === 'step_link_unbound';
    return { lines: [`RESULT S5-steplink state=${s.status} reason=${s.reason_code}`], ok };
  },
  'S6-evaluator-write': async (client) => {
    const { attempt, result } = evaluatorBundle('b'.repeat(40));
    const receipts = await persistTrustedEvaluatorReceipts(client, { attempt, result });
    const bound = receipts.length > 0
      && receipts[0].gp_contract_id === ctx.signedContractId
      && receipts[0].gp_contract_hash === ctx.signedContractHash;
    return { lines: [`RESULT S6-evaluator-write gp_bound=${bound}`], ok: bound };
  },
  'INV1-identity-failclosed': async (client) => {
    const { attempt, result } = evaluatorBundle('b'.repeat(40));
    delete attempt.task_bundle.inputs.impact_gate.contract_id; // 破坏 impact identity
    let rejected = false;
    try {
      await persistTrustedEvaluatorReceipts(client, { attempt, result });
    } catch (e) {
      rejected = String(e?.code || e?.message || '').includes('assertion_receipt_evidence_invalid')
        || /identity|evidence/i.test(String(e?.message || ''));
    }
    return { lines: [`RESULT INV-1 rejected=${rejected}`], ok: rejected };
  },
};

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  const client = await pool.connect();
  let allOk = true;
  try {
    await client.query('BEGIN');
    await seedBase(client);
    const names = modeFull
      ? ['S0-happy', 'S1-unsigned', 'S3-receipt-binding', 'S5-steplink', 'S6-evaluator-write', 'INV1-identity-failclosed']
      : [scenarioArg];
    if (!modeFull && (!scenarioArg || !SCENARIOS[scenarioArg])) {
      console.error(`FAIL: 未知 scenario=${scenarioArg}`); process.exitCode = 2; return;
    }
    for (const name of names) {
      await client.query('SAVEPOINT sc');
      try {
        const { lines, ok } = await SCENARIOS[name](client);
        lines.forEach((l) => console.log(l));
        if (!ok) { allOk = false; console.log(`SCENARIO ${name} FAIL (fail-closed 未生效或写侧未绑定)`); }
        else console.log(`SCENARIO ${name} PASS`);
      } catch (e) {
        allOk = false;
        console.log(`SCENARIO ${name} ERROR ${String(e?.message || e)}`);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT sc');
      }
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
