#!/usr/bin/env bash
# test/scratch-only：证明第二个 repo 用同一四类扫描器、Manifest adapter 与 Projector。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required}"
NODE_EXECUTABLE="$(command -v node)"
PSQL_EXECUTABLE="$(command -v psql)"
DATABASE_NAME="$($NODE_EXECUTABLE -e "const u=new URL(process.argv[1]);process.stdout.write(u.pathname.slice(1))" "$DATABASE_URL")"
[[ "$DATABASE_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: $DATABASE_NAME"

SMOKE_SCOPE="map-second-repo-$$"
SMOKE_REPO="${SMOKE_SCOPE}-repo"
SMOKE_DECISION_ID="$($NODE_EXECUTABLE -e "process.stdout.write(require('node:crypto').randomUUID())")"
TMP_REPO="$(mktemp -d "${TMPDIR:-/tmp}/map-second-repo.XXXXXX")"
MANIFEST_FILE="$TMP_REPO/manifest.json"
export DATABASE_URL SMOKE_SCOPE SMOKE_REPO SMOKE_DECISION_ID MANIFEST_FILE

cleanup() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DELETE FROM map_projection_runs WHERE scope_key='$SMOKE_SCOPE'" \
    -c "DELETE FROM map_manifest_versions WHERE scope_key='$SMOKE_SCOPE'" \
    -c "DELETE FROM map_scope_repositories WHERE scope_key='$SMOKE_SCOPE'" \
    -c "DELETE FROM api_registry WHERE repo='$SMOKE_REPO'" \
    -c "DELETE FROM db_schema_registry WHERE repo='$SMOKE_REPO'" \
    -c "DELETE FROM test_registry WHERE repo='$SMOKE_REPO'" \
    -c "DELETE FROM graph_edges WHERE repo='$SMOKE_REPO'" \
    -c "DELETE FROM fact_snapshot_headers WHERE repo='$SMOKE_REPO'" \
    -c "DELETE FROM decisions WHERE id='$SMOKE_DECISION_ID'" >/dev/null 2>&1 || true
  rm -rf "$TMP_REPO"
}
trap cleanup EXIT

mkdir -p "$TMP_REPO/apps/api/src"
printf '%s\n' "export const helper = true;" > "$TMP_REPO/apps/api/src/helper.js"
printf '%s\n' "import './helper.js';" "router.get('/ready', handler);" > "$TMP_REPO/apps/api/src/api.js"
printf '%s\n' "test('second repo works', () => expect(true).toBe(true));" > "$TMP_REPO/apps/api/src/api.test.js"
printf '%s\n' '{"name":"map-second-repo-fixture","type":"module"}' > "$TMP_REPO/package.json"
git -C "$TMP_REPO" init -q
git -C "$TMP_REPO" config user.email smoke@example.invalid
git -C "$TMP_REPO" config user.name smoke
git -C "$TMP_REPO" add .
git -c core.hooksPath=/dev/null -C "$TMP_REPO" commit -qm fixture
REVISION="$(git -C "$TMP_REPO" rev-parse HEAD)"

printf '%s\n' \
  'apps:' \
  '  - id: customer' \
  '    name: 客户端' \
  '    lines:' \
  '      - { id: line01, name: 首次成功 }' \
  '  - id: staff' \
  '    name: 员工后台' \
  '    lines:' \
  '      - { id: line00, name: 运营系统 }' \
  'golden_paths:' \
  '  - { id: first_success, app_id: customer, line_id: line01, name: 首次成功, status: active }' \
  '  - { id: operations, app_id: staff, line_id: line00, name: 运营系统, status: proposed }' \
  '  - { id: retired, app_id: staff, line_id: line00, name: 已废弃, status: deprecated }' \
  > "$TMP_REPO/product-map.yaml"

for scanner in scan-api-registry.js scan-db-schema.js scan-test-registry.js; do
  SCAN_REPO_NAME="$SMOKE_REPO" SCAN_REPO_ROOT="$TMP_REPO" \
    SOURCE_DATABASE_URL="$DATABASE_URL" "$NODE_EXECUTABLE" "scripts/scan/$scanner" >/dev/null
done
SCAN_REPO_NAME="$SMOKE_REPO" SCAN_REPO_ROOT="$TMP_REPO" GRAPH_REPOS="$SMOKE_REPO" \
  "$NODE_EXECUTABLE" scripts/scan/scan-graph.mjs >/dev/null

HEADER_CHECK="$($PSQL_EXECUTABLE "$DATABASE_URL" -Atc "
  SELECT count(*) || '|' || count(DISTINCT source_revision) || '|' || min(source_revision)
    FROM fact_snapshot_headers WHERE repo='$SMOKE_REPO' AND row_count > 0")"
[[ "$HEADER_CHECK" == "4|1|$REVISION" ]] || fail "四类事实头不一致: $HEADER_CHECK"
pass '第二 repo 四类事实快照共享同一 Git revision 且都有真实行'

"$NODE_EXECUTABLE" scripts/map/product-map-adapter.mjs \
  --input "$TMP_REPO/product-map.yaml" --scope "$SMOKE_SCOPE" \
  --decision-id "$SMOKE_DECISION_ID" --output "$MANIFEST_FILE" >/dev/null

"$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { submitMapManifest, activateMapManifest } from './packages/brain/src/lib/map-manifest-store.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(
    `INSERT INTO decisions(id,category,topic,decision,reason,status,author,made_by,priority)
     VALUES($1,'feature',$2,'test fixture','second repo projector smoke','active','codex','user','P2')`,
    [process.env.SMOKE_DECISION_ID, process.env.SMOKE_SCOPE],
  );
  await pool.query(
    `INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config)
     VALUES($1,$2,'legacy-ledger-v1',$3::jsonb)`,
    [process.env.SMOKE_SCOPE, process.env.SMOKE_REPO, JSON.stringify({ ledger_partition: process.env.SMOKE_SCOPE })],
  );
  const manifest = JSON.parse(readFileSync(process.env.MANIFEST_FILE, 'utf8'));
  const submitted = await submitMapManifest(pool, manifest);
  await activateMapManifest(pool, submitted.manifest_version.id);
} finally {
  await pool.end();
}
NODE

SUMMARY="$($PSQL_EXECUTABLE "$DATABASE_URL" -Atc "
  SELECT count(*) FILTER (WHERE node_type='value_stream') || '|' ||
         count(*) FILTER (WHERE node_type='capability')
    FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id
   WHERE r.scope_key='$SMOKE_SCOPE' AND r.status='active'")"
[[ "$SUMMARY" == '2|2' ]] || fail "第二 repo 投影摘要错误: $SUMMARY"
pass '同一 Projector 从适配 Manifest 生成 2×2 结构，deprecated 未进入投影'

cleanup
trap - EXIT
printf '%s\n' 'ALL PASS: map second repo smoke'
