#!/usr/bin/env bash
# scratch-only 真验火：完整 Manifest 激活、精确结构与确定性 Projection 重建。
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

ACTIVE_DATABASE="$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')"
[[ "$ACTIVE_DATABASE" == "$DATABASE_NAME" ]] \
  || fail "连接目标不一致: expected=$DATABASE_NAME actual=$ACTIVE_DATABASE"

SMOKE_SCOPE="map-projection-smoke-$$"
SMOKE_DECISION_ID="$($NODE_EXECUTABLE -e "process.stdout.write(require('node:crypto').randomUUID())")"

cleanup() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DELETE FROM map_projection_runs WHERE scope_key = '$SMOKE_SCOPE'" \
    -c "DELETE FROM map_manifest_versions WHERE scope_key = '$SMOKE_SCOPE'" \
    -c "DELETE FROM decisions WHERE id = '$SMOKE_DECISION_ID'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

db_scalar() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"
}

printf '%s\n' '── map projection scratch smoke ──'
printf 'database=%s scope=%s\n' "$DATABASE_NAME" "$SMOKE_SCOPE"

[[ "$(db_scalar "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version='405')")" == 't' ]] \
  || fail 'schema_version 405 不存在'
TABLE_COUNT="$(db_scalar "
  SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('map_projection_runs','map_projection_nodes','map_projection_edges')")"
[[ "$TABLE_COUNT" == '3' ]] || fail "projection 表不完整: $TABLE_COUNT/3"
pass 'migration 405 与 projection 三表'

DATABASE_URL="$DATABASE_URL" SMOKE_SCOPE="$SMOKE_SCOPE" SMOKE_DECISION_ID="$SMOKE_DECISION_ID" \
  "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import pg from 'pg';

import { activateMapManifest, submitMapManifest } from './packages/brain/src/lib/map-manifest-store.js';
import { projectMapManifest } from './packages/brain/src/lib/map-projection-store.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const manifest = JSON.parse(await readFile(
  './packages/brain/config/map-manifests/cecelia.v1.json', 'utf8',
));
manifest.scope_key = process.env.SMOKE_SCOPE;
manifest.source_decision_id = process.env.SMOKE_DECISION_ID;

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

async function activeSnapshot() {
  const runResult = await pool.query(
    `SELECT id, manifest_digest, fact_revisions, projector_version, projection_digest, status
       FROM map_projection_runs WHERE scope_key=$1 AND status='active'`,
    [manifest.scope_key],
  );
  if (runResult.rows.length !== 1) throw new Error(`active run count=${runResult.rows.length}`);
  const run = runResult.rows[0];
  const nodes = await pool.query(
    `SELECT node_id, node_type, node_key FROM map_projection_nodes
      WHERE run_id=$1 ORDER BY node_id`,
    [run.id],
  );
  const edges = await pool.query(
    `SELECT edge_id, edge_type, edge_key, attributes FROM map_projection_edges
      WHERE run_id=$1 ORDER BY edge_id`,
    [run.id],
  );
  return { run, nodes: nodes.rows, edges: edges.rows };
}

try {
  await pool.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', 'map-projection-smoke', 'scratch fixture',
       'verify deterministic projection', 'active', 'codex', 'user', 'P2')`,
    [manifest.source_decision_id],
  );

  const submitted = await submitMapManifest(pool, manifest);
  const activated = await activateMapManifest(pool, submitted.manifest_version.id);
  if (!submitted.created || !activated.activated || activated.manifest_version.status !== 'active') {
    throw new Error('complete manifest did not activate with a projection');
  }

  const first = await activeSnapshot();
  const nodeCounts = Object.fromEntries(
    ['value_stream', 'capability', 'crosscut', 'prerequisite']
      .map((type) => [type, first.nodes.filter((node) => node.node_type === type).length]),
  );
  assertEqual(nodeCounts, {
    value_stream: 2, capability: 11, crosscut: 7, prerequisite: 0,
  }, 'node counts');
  const edgeCounts = Object.fromEntries(
    ['contains', 'hands_off_to', 'serves', 'owned_by', 'requires']
      .map((type) => [type, first.edges.filter((edge) => edge.edge_type === type).length]),
  );
  assertEqual(edgeCounts, {
    contains: 11, hands_off_to: 2, serves: 14, owned_by: 4, requires: 0,
  }, 'edge counts');
  if (first.nodes.some((node) => manifest.boundaries.some((item) => item.key === node.node_key))) {
    throw new Error('Boundary was persisted as a node');
  }
  if (first.edges.filter((edge) => edge.edge_type === 'hands_off_to')
    .some((edge) => typeof edge.attributes.statement !== 'string')) {
    throw new Error('Boundary statement missing from edge attributes');
  }
  if (![...first.nodes, ...first.edges].every((item) => /^[0-9a-f]{64}$/.test(item.node_id ?? item.edge_id))) {
    throw new Error('projection contains a non-stable id');
  }

  const firstNodeIds = first.nodes.map((node) => node.node_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM map_projection_edges WHERE run_id=$1', [first.run.id]);
    await client.query('DELETE FROM map_projection_nodes WHERE run_id=$1', [first.run.id]);
    await projectMapManifest({ client, manifestVersion: submitted.manifest_version });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const rebuilt = await activeSnapshot();
  assertEqual(rebuilt.nodes.map((node) => node.node_id), firstNodeIds, 'rebuilt stable node ids');
  if (rebuilt.run.projection_digest !== first.run.projection_digest) {
    throw new Error(`projection digest changed: ${first.run.projection_digest} -> ${rebuilt.run.projection_digest}`);
  }
  const runStatuses = await pool.query(
    `SELECT status, count(*)::int AS count FROM map_projection_runs
      WHERE scope_key=$1 GROUP BY status ORDER BY status`,
    [manifest.scope_key],
  );
  assertEqual(runStatuses.rows, [
    { status: 'active', count: 1 }, { status: 'superseded', count: 1 },
  ], 'run statuses');
  const manifestTruth = await pool.query(
    `SELECT count(*)::int AS count, min(status) AS status, min(digest) AS digest
       FROM map_manifest_versions WHERE scope_key=$1`,
    [manifest.scope_key],
  );
  assertEqual(manifestTruth.rows[0], {
    count: 1, status: 'active', digest: submitted.manifest_version.digest,
  }, 'manifest truth source');
} finally {
  await pool.end();
}
NODE
pass '完整 Manifest 激活精确生成 2×11×2×7 与 Boundary/Cross-cut 关系'
pass '清空派生结构后原子重建 stable IDs/digest 不变'

cleanup
trap - EXIT
RESIDUE="$(db_scalar "
  SELECT
    (SELECT count(*) FROM map_projection_runs WHERE scope_key='$SMOKE_SCOPE')::text
    || '|' ||
    (SELECT count(*) FROM map_manifest_versions WHERE scope_key='$SMOKE_SCOPE')::text
    || '|' ||
    (SELECT count(*) FROM decisions WHERE id='$SMOKE_DECISION_ID')::text")"
[[ "$RESIDUE" == '0|0|0' ]] || fail "fixture 残留: $RESIDUE"
pass 'scratch fixture 清理'

printf '%s\n' 'ALL PASS'
