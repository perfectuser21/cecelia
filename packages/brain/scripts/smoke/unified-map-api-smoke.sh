#!/usr/bin/env bash
# test/scratch-only 真验火：通过运行中的 Brain 验证 Unified Map 唯一读入口。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
: "${BRAIN_URL:?BRAIN_URL is required}"
NODE_EXECUTABLE="$(command -v node)"
PSQL_EXECUTABLE="$(command -v psql)"
CURL_EXECUTABLE="$(command -v curl)"
JQ_EXECUTABLE="$(command -v jq)"
INTERNAL_AUTH_HELPER="$ROOT_DIR/scripts/lib/internal-auth-token.sh"
INTERNAL_AUTH_ENV_FILE="${CECELIA_INTERNAL_ENV_FILE:-$HOME/.credentials/cecelia-internal.env}"
if [[ -z "${CECELIA_INTERNAL_TOKEN:-}" && -f "$INTERNAL_AUTH_HELPER" ]]; then
  # shellcheck source=../../../../scripts/lib/internal-auth-token.sh
  source "$INTERNAL_AUTH_HELPER"
  load_cecelia_internal_token "$INTERNAL_AUTH_ENV_FILE" || true
fi
brain_curl() {
  if [[ -n "${CECELIA_INTERNAL_TOKEN:-}" ]]; then
    "$CURL_EXECUTABLE" -H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}" "$@"
  else
    "$CURL_EXECUTABLE" "$@"
  fi
}
DATABASE_NAME="$($NODE_EXECUTABLE -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DATABASE_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DATABASE_NAME:-<empty>}"
[[ "$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')" == "$DATABASE_NAME" ]] \
  || fail '数据库连接目标不一致'
[[ "$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version='407')")" == 't' ]] \
  || fail 'schema_version 407 不存在'

SMOKE_SCOPE="unified-map-api-smoke-$$"
SMOKE_REPO="${SMOKE_SCOPE}-repo"
SMOKE_DECISION_ID="$($NODE_EXECUTABLE -e "process.stdout.write(require('node:crypto').randomUUID())")"
export DATABASE_URL SMOKE_SCOPE SMOKE_REPO SMOKE_DECISION_ID

cleanup() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DELETE FROM map_projection_runs WHERE scope_key='$SMOKE_SCOPE'" \
    -c "DELETE FROM map_manifest_versions WHERE scope_key='$SMOKE_SCOPE'" \
    -c "DELETE FROM map_scope_repositories WHERE scope_key='$SMOKE_SCOPE'" \
    -c "DELETE FROM fact_snapshot_headers WHERE repo='$SMOKE_REPO'" \
    -c "DELETE FROM decisions WHERE id='$SMOKE_DECISION_ID'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '%s\n' '── unified map API smoke ──'
printf 'database=%s scope=%s brain=%s\n' "$DATABASE_NAME" "$SMOKE_SCOPE" "$BRAIN_URL"

"$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import pg from 'pg';

import { activateMapManifest, submitMapManifest } from './packages/brain/src/lib/map-manifest-store.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const scopeKey = process.env.SMOKE_SCOPE;
const repo = process.env.SMOKE_REPO;
const decisionId = process.env.SMOKE_DECISION_ID;
const revision = 'a'.repeat(40);
const manifest = JSON.parse(await readFile(
  './packages/brain/config/map-manifests/cecelia.v1.json', 'utf8',
));
manifest.scope_key = scopeKey;
manifest.source_decision_id = decisionId;

try {
  await pool.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', $2, 'test fixture', 'verify Unified Map HTTP authority',
       'active', 'codex', 'user', 'P2')`,
    [decisionId, scopeKey],
  );
  await pool.query(
    `INSERT INTO map_scope_repositories
      (scope_key, repo, adapter_key, adapter_config)
     VALUES ($1,$2,'legacy-ledger-v1','{"ledger_partition":"infrastructure"}'::jsonb)`,
    [scopeKey, repo],
  );
  await pool.query(
    `INSERT INTO fact_snapshot_headers
      (kind,repo,source_revision,scanner_version,scanned_at,row_count)
     VALUES
      ('api',$1,$2,'api-registry-v2',NOW(),0),
      ('db_schema',$1,$2,'db-schema-v2',NOW(),0),
      ('graph',$1,$2,'graph-v3',NOW(),0),
      ('test',$1,$2,'test-registry-v2',NOW(),0)`,
    [repo, revision],
  );
  const submitted = await submitMapManifest(pool, manifest);
  const activated = await activateMapManifest(pool, submitted.manifest_version.id);
  if (!activated.activated) throw new Error('manifest activation failed');
} finally {
  await pool.end();
}
NODE
pass '独立 scope 的 Manifest、四类事实头和 Projection 已激活'

MAP_JSON="$(brain_curl -fsS --get "$BRAIN_URL/api/brain/map" --data-urlencode "scope=$SMOKE_SCOPE")"
# jq variables are passed with --arg, not expanded by Bash.
# shellcheck disable=SC2016
printf '%s' "$MAP_JSON" | "$JQ_EXECUTABLE" -e \
  --arg scope "$SMOKE_SCOPE" --arg repo "$SMOKE_REPO" '
    .scope_key == $scope
    and .manifest_version == 1
    and (.manifest_digest | test("^[0-9a-f]{64}$"))
    and (.projection_digest | test("^[0-9a-f]{64}$"))
    and .summary == {value_streams:2,capabilities:11,boundaries:2,crosscuts:7,prerequisites:0}
    and .freshness.status == "fresh"
    and .freshness.repos[$repo].status == "fresh"
    and (.generated_at | type == "string")' >/dev/null \
  || fail 'GET /map 未返回精确结构、统一 envelope 或 fresh 事实状态'
ORIGINAL_DIGEST="$(printf '%s' "$MAP_JSON" | "$JQ_EXECUTABLE" -r '.projection_digest')"
pass 'GET /map 返回 2×11×2×7、统一 envelope 与 fresh 状态'

NODE_JSON="$(brain_curl -fsS --get "$BRAIN_URL/api/brain/map/nodes/F0" --data-urlencode "scope=$SMOKE_SCOPE")"
printf '%s' "$NODE_JSON" | "$JQ_EXECUTABLE" -e '
  .node.key == "F0"
  and .node.type == "capability"
  and any(.boundaries[]; .key == "F0_TO_G1" and .from == "F0" and .to == "G1")
  and (.manifest_digest | test("^[0-9a-f]{64}$"))' >/dev/null \
  || fail 'GET /nodes/F0 未返回节点或 F0→G1 边界'
pass 'GET /nodes/F0 返回能力详情与 F0→G1 边界'

RADIUS_JSON="$(brain_curl -fsS -X POST "$BRAIN_URL/api/brain/map/radius" \
  -H 'Content-Type: application/json' \
  -d "{\"scope\":\"$SMOKE_SCOPE\",\"repo\":\"$SMOKE_REPO\",\"changed_files\":[],\"node_keys\":[\"heartbeat_bus\"]}")"
printf '%s' "$RADIUS_JSON" | "$JQ_EXECUTABLE" -e '
  .freshness.status == "fresh"
  and (.affected_business_nodes | length) > 1
  and any(.affected_business_nodes[]; .node_key == "factory")
  and any(.affected_business_nodes[]; .node_key == "butler")' >/dev/null \
  || fail 'POST /radius 未返回 Cross-cut 影响范围'
pass 'POST /radius 仅用 node_key 返回 Cross-cut 影响范围'

HEALTH_JSON="$(brain_curl -fsS --get "$BRAIN_URL/api/brain/map/health" --data-urlencode "scope=$SMOKE_SCOPE")"
printf '%s' "$HEALTH_JSON" | "$JQ_EXECUTABLE" -e '
  .overall == "healthy"
  and .layers.manifest.status == "ok"
  and .layers.facts.status == "ok"
  and .layers.projection.status == "ok"
  and .layers.state_resolver.status == "ok"' >/dev/null \
  || fail 'GET /health 未返回四层 healthy'
pass 'GET /health 四层均 healthy'

UNCLAIMED_JSON="$(brain_curl -fsS --get "$BRAIN_URL/api/brain/map/unclaimed" --data-urlencode "scope=$SMOKE_SCOPE")"
printf '%s' "$UNCLAIMED_JSON" | "$JQ_EXECUTABLE" -e '
  (.unclaimed_count | type == "number")
  and (.unclaimed | type == "array")
  and (.projection_digest | test("^[0-9a-f]{64}$"))' >/dev/null \
  || fail 'GET /unclaimed 未返回统一 envelope'
pass 'GET /unclaimed 返回统一 envelope'

REBUILD_JSON="$(brain_curl -fsS -X POST "$BRAIN_URL/api/brain/map/rebuild" \
  -H 'Content-Type: application/json' -d "{\"scope_key\":\"$SMOKE_SCOPE\"}")"
# jq variables are passed with --arg, not expanded by Bash.
# shellcheck disable=SC2016
printf '%s' "$REBUILD_JSON" | "$JQ_EXECUTABLE" -e --arg digest "$ORIGINAL_DIGEST" '
  .rebuilt == true
  and .projection_digest == $digest
  and .freshness.status == "fresh"' >/dev/null \
  || fail 'POST /rebuild 未保持确定性 digest 或统一 envelope'
pass 'POST /rebuild 保持确定性 Projection digest'

cleanup
trap - EXIT
RESIDUE="$($PSQL_EXECUTABLE "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT
    (SELECT count(*) FROM map_projection_runs WHERE scope_key='$SMOKE_SCOPE')::text || '|' ||
    (SELECT count(*) FROM map_manifest_versions WHERE scope_key='$SMOKE_SCOPE')::text || '|' ||
    (SELECT count(*) FROM map_scope_repositories WHERE scope_key='$SMOKE_SCOPE')::text || '|' ||
    (SELECT count(*) FROM fact_snapshot_headers WHERE repo='$SMOKE_REPO')::text || '|' ||
    (SELECT count(*) FROM decisions WHERE id='$SMOKE_DECISION_ID')::text")"
[[ "$RESIDUE" == '0|0|0|0|0' ]] || fail "fixture 残留: $RESIDUE"
pass 'test/scratch fixture 全清零'

printf '%s\n' 'ALL PASS: unified map API smoke'
