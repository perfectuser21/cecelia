#!/usr/bin/env bash
# scratch-only 真验火：精确锚点、查询时五态、revision receipt 与影响半径。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE_EXECUTABLE="$(command -v node)"
PSQL_EXECUTABLE="$(command -v psql)"
DATABASE_NAME="$($NODE_EXECUTABLE -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DATABASE_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DATABASE_NAME:-<empty>}"
[[ "$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')" == "$DATABASE_NAME" ]] \
  || fail '数据库连接目标不一致'
[[ "$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version='407')")" == 't' ]] \
  || fail 'schema_version 407 不存在'

SMOKE_SCOPE="map-anchor-state-smoke-$$"
SMOKE_REPO="${SMOKE_SCOPE}-repo"
export DATABASE_URL SMOKE_SCOPE SMOKE_REPO

printf '%s\n' '── map anchor/state scratch smoke ──'
printf 'database=%s scope=%s repo=%s\n' "$DATABASE_NAME" "$SMOKE_SCOPE" "$SMOKE_REPO"

"$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

import { digestMapManifest } from './packages/brain/src/lib/map-manifest-schema.js';
import { loadMapImpactRadius } from './packages/brain/src/lib/map-impact-radius.js';
import { projectMapManifest } from './packages/brain/src/lib/map-projection-store.js';
import { loadMapNodeStates } from './packages/brain/src/lib/map-state-resolver.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const scopeKey = process.env.SMOKE_SCOPE;
const repo = process.env.SMOKE_REPO;
const decisionId = randomUUID();
const capabilityKey = `SMOKE_${randomUUID().replaceAll('-', '')}`;
const testPath = `tests/${randomUUID()}.test.js`;
const sourcePath = `src/${randomUUID()}.js`;
const revision = 'a'.repeat(40);
const now = new Date();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
let assertionId;
let featureId;

function requireState(result, nodeKey, expected, reason) {
  const actual = result.states.find((item) => item.node_key === nodeKey);
  if (actual?.status !== expected || (reason && actual.reason_code !== reason)) {
    throw new Error(`node=${nodeKey} state=${actual?.status}/${actual?.reason_code}, expected=${expected}/${reason}`);
  }
}

async function insertReceipt(verdict, offsetMs) {
  const completedAt = new Date(now.getTime() + offsetMs);
  await client.query(
    `INSERT INTO journey_assertion_receipts (
      journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
      assertion_digest, source_repo, source_sha, command_argv, verdict, exit_code,
      scenario_count, scenario_evidence, machine_id, output_digest, output_tail,
      started_at, completed_at
    ) VALUES ($1,$2,1,$3,$4,$5,$6,$7::jsonb,$8,$9,1,$10::jsonb,
      'map-anchor-state-smoke',$11,'smoke receipt',$12,$13)`,
    [
      assertionId, `${scopeKey}-${verdict}-${randomUUID()}`, testPath, sha256(testPath),
      repo, revision, JSON.stringify(['npx', 'vitest', 'run', testPath]), verdict,
      verdict === 'PASS' ? 0 : 1, JSON.stringify({ kind: 'vitest', scenario: testPath }),
      sha256(`${verdict}-${offsetMs}`), new Date(completedAt.getTime() - 1000), completedAt,
    ],
  );
}

try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', $2, 'scratch fixture', 'prove map state transitions',
       'active', 'codex', 'user', 'P2')`,
    [decisionId, scopeKey],
  );
  await client.query(
    `INSERT INTO map_scope_repositories
      (scope_key, repo, adapter_key, adapter_config)
     VALUES ($1,$2,'legacy-ledger-v1','{"ledger_partition":"infrastructure"}'::jsonb)`,
    [scopeKey, repo],
  );
  const journeyId = (await client.query(
    `INSERT INTO journeys (name, biz_area, capability_code)
     VALUES ($1,'infrastructure',$2) RETURNING id`,
    [scopeKey, capabilityKey],
  )).rows[0].id;
  const stepId = (await client.query(
    `INSERT INTO journey_steps (journey_id,name,step_number)
     VALUES ($1,'smoke step',1) RETURNING id`,
    [journeyId],
  )).rows[0].id;
  featureId = (await client.query(
    `INSERT INTO journey_features (journey_id,step_id,name,unit_test_path)
     VALUES ($1,$2,'smoke feature',$3) RETURNING id`,
    [journeyId, stepId, testPath],
  )).rows[0].id;
  assertionId = (await client.query(
    `INSERT INTO journey_step_links
      (journey_id,step_id,feature_id,cell_kind,cell_key,cell_status,assertion_ref)
     VALUES ($1,$2,$3,'capability',$4,'green',$5) RETURNING id`,
    [journeyId, stepId, featureId, capabilityKey, testPath],
  )).rows[0].id;
  await client.query(
    `INSERT INTO test_registry
      (repo,file_path,source_revision,scanner_version,scanned_at)
     VALUES ($1,$2,$3,'test-registry-v2',$4)`,
    [repo, testPath, revision, now],
  );
  await client.query(
    `INSERT INTO graph_edges
      (repo,src_path,dst_path,edge_type,source_revision,scanner_version,scanned_at)
     VALUES ($1,$2,$3,'import',$4,'graph-v3',$5)`,
    [repo, testPath, sourcePath, revision, now],
  );
  await client.query(
    `INSERT INTO fact_snapshot_headers
      (kind,repo,source_revision,scanner_version,scanned_at,row_count)
     VALUES
      ('test',$1,$2,'test-registry-v2',$3,1),
      ('graph',$1,$2,'graph-v3',$3,1)`,
    [repo, revision, now],
  );

  const manifest = JSON.parse(await readFile(
    './packages/brain/config/map-manifests/cecelia.v1.json', 'utf8',
  ));
  manifest.scope_key = scopeKey;
  manifest.source_decision_id = decisionId;
  const oldKey = manifest.capabilities[0].key;
  manifest.capabilities[0].key = capabilityKey;
  manifest.boundaries = manifest.boundaries.map((boundary) => ({
    ...boundary,
    from: boundary.from === oldKey ? capabilityKey : boundary.from,
    to: boundary.to === oldKey ? capabilityKey : boundary.to,
  }));
  const digest = digestMapManifest(manifest);
  const version = (await client.query(
    `INSERT INTO map_manifest_versions
      (scope_key,version,source_decision_id,manifest,digest,status,activated_at)
     VALUES ($1,1,$2,$3::jsonb,$4,'active',NOW())
     RETURNING id,scope_key,version,source_decision_id,manifest,digest,status,created_at,activated_at`,
    [scopeKey, decisionId, JSON.stringify(manifest), digest],
  )).rows[0];
  await projectMapManifest({ client, manifestVersion: version });
  await insertReceipt('PASS', 1000);

  requireState(await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 2000) }), assertionId, 'green', 'receipt_pass');

  await client.query('DELETE FROM test_registry WHERE repo=$1 AND file_path=$2', [repo, testPath]);
  await client.query(
    `UPDATE fact_snapshot_headers SET scanned_at=$2,row_count=0
      WHERE kind='test' AND repo=$1`,
    [repo, new Date(now.getTime() + 3000)],
  );
  requireState(await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 4000) }), assertionId, 'gray', 'anchor_target_missing');

  await client.query(
    `INSERT INTO test_registry
      (repo,file_path,source_revision,scanner_version,scanned_at)
     VALUES ($1,$2,$3,'test-registry-v2',$4)`,
    [repo, testPath, revision, new Date(now.getTime() + 5000)],
  );
  await client.query(
    `UPDATE fact_snapshot_headers SET scanned_at=$2,row_count=1
      WHERE kind='test' AND repo=$1`,
    [repo, new Date(now.getTime() + 5000)],
  );
  await insertReceipt('FAIL', 6000);
  requireState(await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 7000) }), assertionId, 'red', 'receipt_fail');

  await client.query(
    `UPDATE fact_snapshot_headers SET scanned_at=$2 WHERE kind='test' AND repo=$1`,
    [repo, new Date(now.getTime() - 16 * 60_000)],
  );
  requireState(await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 7000) }), assertionId, 'unknown', 'snapshot_stale');

  const radius = await loadMapImpactRadius(client, {
    scopeKey, repo, changedFiles: [sourcePath], now: new Date(now.getTime() + 7000),
  });
  if (radius.freshness.status !== 'fresh'
    || !radius.affected_business_nodes.some((node) => node.node_key === capabilityKey)
    || !radius.must_run_assertions.some((item) => item.node_key === assertionId)) {
    throw new Error('repo-isolated graph radius did not reach capability/assertion');
  }
  const crosscut = await loadMapImpactRadius(client, {
    scopeKey, repo, startNodeKeys: ['heartbeat_bus'], now: new Date(now.getTime() + 7000),
  });
  if (crosscut.affected_business_nodes.length <= 1) {
    throw new Error('Cross-cut radius is empty');
  }
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
NODE

pass '当前 revision PASS→green'
pass '删除测试并刷新→gray，不读取旧 cell_status'
pass '当前 revision 最新 FAIL→red'
pass '快照超过 15 分钟→unknown'
pass 'repo 隔离 radius 返回业务节点/必跑断言，Cross-cut radius 非空'

RESIDUE="$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT
    (SELECT count(*) FROM map_projection_runs WHERE scope_key='$SMOKE_SCOPE')::text || '|' ||
    (SELECT count(*) FROM map_manifest_versions WHERE scope_key='$SMOKE_SCOPE')::text || '|' ||
    (SELECT count(*) FROM map_scope_repositories WHERE scope_key='$SMOKE_SCOPE')::text || '|' ||
    (SELECT count(*) FROM fact_snapshot_headers WHERE repo='$SMOKE_REPO')::text || '|' ||
    (SELECT count(*) FROM graph_edges WHERE repo='$SMOKE_REPO')::text || '|' ||
    (SELECT count(*) FROM test_registry WHERE repo='$SMOKE_REPO')::text")"
[[ "$RESIDUE" == '0|0|0|0|0|0' ]] || fail "fixture 残留: $RESIDUE"
pass 'scratch fixture 全清零'

printf '%s\n' 'ALL PASS: map anchor/state scratch smoke'
