/**
 * F1 Capability 可信认证闭环 — 真实 PostgreSQL 集成测试（TDD 红 → 绿）。
 *
 * 禁 mock 被改的边：resolver ↔ journey_assertion_receipts / golden_path_contract_versions /
 * journey_step_links，以及 evaluator writer ↔ journey_assertion_receipts —— 全部真库真行。
 *
 * 运行：需 TEST_DATABASE_URL 指向 *_test / *_scratch 库（brain-integration job 提供）；
 * 未设置时 describe.skip（本地/无 PG 环境不误红）。
 *
 * 红证据（闸未实现时）：当前 loadMapNodeStates 只要 PASS receipt + revision 匹配即投 green，
 * 不校验 signed GP contract 存在性 / receipt gp_contract_id / impact_contract_id / step-link 绑定，
 * 故下列 fail-closed 断言现全部 FAIL（capability 现为 green）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it,
} from 'vitest';
import pg from 'pg';

import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { digestMapManifest } from '../../../packages/brain/src/lib/map-manifest-schema.js';
import { projectMapManifest } from '../../../packages/brain/src/lib/map-projection-store.js';
import { loadMapNodeStates } from '../../../packages/brain/src/lib/map-state-resolver.js';
import { persistTrustedEvaluatorReceipts } from '../../../packages/brain/src/impact-contract/assertion-receipts.js';

const testConnectionString = process.env.TEST_DATABASE_URL;
const databaseName = testConnectionString
  ? decodeURIComponent(new URL(testConnectionString).pathname.slice(1))
  : DB_DEFAULTS.database;
const describePg = testConnectionString && /(_test|_scratch)$/.test(databaseName)
  ? describe
  : describe.skip;

const fixtureManifest = JSON.parse(readFileSync(
  new URL('../../../packages/brain/config/map-manifests/cecelia.v1.json', import.meta.url),
  'utf8',
));

const pool = new pg.Pool(testConnectionString
  ? { connectionString: testConnectionString, max: 2 }
  : { ...DB_DEFAULTS, max: 2 });

const scopeKey = `f1-cert-itest-${process.pid}-${randomUUID().slice(0, 8)}`;
const repo = `${scopeKey}-repo`;
const capabilityKey = `IT_${randomUUID().replaceAll('-', '')}`;
const testPath = `tests/${randomUUID()}.test.js`;
const sourcePath = `src/${randomUUID()}.js`;
const revision = 'a'.repeat(40);
const now = new Date();

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

let client: pg.PoolClient;
let journeyId: string;
let stepId: string;
let featureId: string;
let linkId: string;
let signedContractId: string;
let signedContractHash: string;

/** 落一条 PASS receipt，绑定项可选（用于逐前提破坏） */
async function seedReceipt(overrides: Record<string, unknown> = {}): Promise<void> {
  const binding = {
    gp_contract_id: signedContractId,
    gp_contract_hash: signedContractHash,
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
     ) VALUES (
       $1,$2,1,$3,$4,$5,$6,$7::jsonb,'PASS',0,1,$8::jsonb,
       'f1-cert-integration',$9,'integration receipt',$10,$11,$12,$13,$14,$15
     )`,
    [
      linkId,
      `${scopeKey}-${randomUUID()}`,
      testPath,
      digest(testPath),
      repo,
      binding.source_sha,
      JSON.stringify(['npx', 'vitest', 'run', testPath]),
      JSON.stringify({ kind: 'vitest', scenario: testPath }),
      digest(`pass-${randomUUID()}`),
      new Date(now.getTime()),
      new Date(now.getTime() + 1000),
      binding.gp_contract_id,
      binding.gp_contract_hash,
      binding.impact_contract_id,
      binding.impact_contract_hash,
    ],
  );
}

function findState(result: { states: Array<{ node_key: string; status: string; reason_code: string }> }, key: string) {
  return result.states.find((item) => item.node_key === key);
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const decisionId = randomUUID();
  await client.query(
    `INSERT INTO decisions (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1,'feature',$2,'f1 cert fixture','fail-closed proof','active','codex','user','P2')`,
    [decisionId, scopeKey],
  );
  await client.query(
    `INSERT INTO map_scope_repositories (scope_key, repo, adapter_key, adapter_config)
     VALUES ($1,$2,'legacy-ledger-v1','{"ledger_partition":"infrastructure"}'::jsonb)`,
    [scopeKey, repo],
  );
  const journey = await client.query(
    `INSERT INTO journeys (name, biz_area, capability_code)
     VALUES ($1,'infrastructure',$2) RETURNING id`,
    [scopeKey, capabilityKey],
  );
  journeyId = journey.rows[0].id;
  const step = await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number)
     VALUES ($1,'cert step',1) RETURNING id`,
    [journeyId],
  );
  stepId = step.rows[0].id;
  const feature = await client.query(
    `INSERT INTO journey_features (journey_id, step_id, name, unit_test_path)
     VALUES ($1,$2,'cert feature',$3) RETURNING id`,
    [journeyId, stepId, testPath],
  );
  featureId = feature.rows[0].id;
  const link = await client.query(
    `INSERT INTO journey_step_links
      (journey_id, step_id, feature_id, cell_kind, cell_key, cell_status, assertion_ref)
     VALUES ($1,$2,$3,'capability',$4,'green',$5) RETURNING id`,
    [journeyId, stepId, featureId, capabilityKey, testPath],
  );
  linkId = link.rows[0].id;
  // Owner-signed Golden Path contract（golden_paths.journey_id → contract status='signed'）
  const gp = await client.query(
    `INSERT INTO golden_paths (title, one_liner, journey_id)
     VALUES ('f1 cert gp','fail-closed cert',$1) RETURNING id`,
    [journeyId],
  );
  const contract = await client.query(
    `INSERT INTO golden_path_contract_versions
      (golden_path_id, version, contract_json, content_hash, status, signed_by, signed_at)
     VALUES ($1,1,'{"gp":"f1"}'::jsonb,$2,'signed','owner',NOW())
     RETURNING id, content_hash`,
    [gp.rows[0].id, digest(`gp-contract-${scopeKey}`)],
  );
  signedContractId = contract.rows[0].id;
  signedContractHash = contract.rows[0].content_hash;
  // fresh facts
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
  manifest.boundaries = manifest.boundaries.map((b: { from: string; to: string }) => ({
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
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

// 每个用例在 SAVEPOINT 内隔离 receipt/contract 变动
beforeEach(async () => { await client.query('SAVEPOINT tc'); });
afterEach(async () => { await client.query('ROLLBACK TO SAVEPOINT tc'); });

describePg('F1 Capability 认证闭环 — fail-closed [PostgreSQL]', () => {
  const readAt = new Date(now.getTime() + 2000);

  it('四前提齐备时 F1 green', async () => {
    await seedReceipt();
    const result = await loadMapNodeStates(client, { scopeKey, now: readAt });
    expect(findState(result, capabilityKey)).toMatchObject({ status: 'green' });
  });

  it('无 signed GP contract 时 F1 非绿', async () => {
    await client.query(
      `UPDATE golden_path_contract_versions SET status='pending_signature', signed_at=NULL
        WHERE id=$1`,
      [signedContractId],
    );
    await seedReceipt();
    const result = await loadMapNodeStates(client, { scopeKey, now: readAt });
    const cap = findState(result, capabilityKey);
    expect(cap?.status).not.toBe('green');
  });

  it('receipt 未绑定 gp_contract_id 时非绿', async () => {
    await seedReceipt({ gp_contract_id: null, gp_contract_hash: null });
    const result = await loadMapNodeStates(client, { scopeKey, now: readAt });
    expect(findState(result, capabilityKey)?.status).not.toBe('green');
  });

  it('receipt 未绑定 impact 时非绿', async () => {
    await seedReceipt({ impact_contract_id: null, impact_contract_hash: null });
    const result = await loadMapNodeStates(client, { scopeKey, now: readAt });
    expect(findState(result, capabilityKey)?.status).not.toBe('green');
  });

  it('step link 未绑定 feature/assertion 时非绿', async () => {
    await seedReceipt();
    await client.query(
      `UPDATE journey_step_links SET assertion_ref=NULL WHERE id=$1`,
      [linkId],
    );
    const result = await loadMapNodeStates(client, { scopeKey, now: readAt });
    expect(findState(result, capabilityKey)?.status).not.toBe('green');
  });

  it('evaluator writer 绑定 gp_contract_id', async () => {
    // 真实 persistTrustedEvaluatorReceipts 落 PASS receipt 时必须绑定 gp_contract_id/hash。
    const sha = 'b'.repeat(40);
    const impactHash = digest(`impact-${scopeKey}`);
    const attempt = {
      role: 'evaluator',
      id: randomUUID(),
      run_id: `run-${randomUUID()}`,
      actual_machine_id: 'itest-machine',
      task_bundle: {
        inputs: {
          pull_request: { head_sha: sha },
          impact_gate: {
            contract_id: randomUUID(),
            contract_hash: impactHash,
            repo,
            head_revision: sha,
          },
          required_assertions: [{
            assertion_id: testPath,
            journey_step_link_id: linkId,
            assertion_revision: 1,
            assertion_digest: digest(testPath),
            source_bindings: [{
              journey_step_link_id: linkId,
              assertion_revision: 1,
              assertion_digest: digest(testPath),
            }],
          }],
        },
      },
    };
    const result = {
      status: 'completed',
      decision: { outcome: 'PASS' },
      checks: [{
        assertion_id: testPath,
        journey_step_link_id: linkId,
        assertion_revision: 1,
        assertion_digest: digest(testPath),
        command_argv: ['npx', 'vitest', 'run', testPath],
        exit_code: 0,
        output_digest: digest(`out-${scopeKey}`),
        output_tail: 'ok',
        scenario_count: 1,
        scenario_evidence: { pr_head_sha: sha, machine: 'itest-machine', cases: ['case-1'] },
        started_at: new Date(now.getTime()).toISOString(),
        completed_at: new Date(now.getTime() + 1000).toISOString(),
      }],
    };
    const receipts = await persistTrustedEvaluatorReceipts(client, { attempt, result });
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts[0].gp_contract_id).toBe(signedContractId);
    expect(receipts[0].gp_contract_hash).toBe(signedContractHash);
  });
});
