#!/usr/bin/env bash
# scratch-only 真验火：四类事实快照、provenance、原子替换与 freshness fail-closed。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE_EXECUTABLE="$(command -v node)"
PSQL_EXECUTABLE="$(command -v psql)"
REPO_ROOT_CECELIA="${REPO_ROOT_CECELIA:-$ROOT_DIR}"
DATABASE_NAME="$("$NODE_EXECUTABLE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DATABASE_NAME" =~ (_test|_scratch)$ ]] \
  || fail "拒绝连接非测试库: ${DATABASE_NAME:-<empty>}"

ACTIVE_DATABASE="$("$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')"
[[ "$ACTIVE_DATABASE" == "$DATABASE_NAME" ]] \
  || fail "连接目标不一致: expected=$DATABASE_NAME actual=$ACTIVE_DATABASE"

TARGET_REVISION="$(git -C "$REPO_ROOT_CECELIA" rev-parse HEAD)"
[[ "$TARGET_REVISION" =~ ^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$ ]] \
  || fail "目标 repo HEAD 不是完整 Git object id"

SMOKE_REPO="map-fact-snapshot-smoke-$$"
cleanup() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DELETE FROM api_registry WHERE repo = '$SMOKE_REPO'" \
    -c "DELETE FROM fact_snapshot_headers WHERE kind = 'api' AND repo = '$SMOKE_REPO'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

db_scalar() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"
}

verify_headers_and_facts() {
  local header_output header_count=0
  local kind revision scanner header_count_value fact_count expected_scanner

  header_output="$(db_scalar "
    WITH fact_counts AS (
      SELECT 'api'::text AS kind, count(*)::int AS fact_count FROM api_registry WHERE repo = 'cecelia'
      UNION ALL SELECT 'db_schema', count(*)::int FROM db_schema_registry WHERE repo = 'cecelia'
      UNION ALL SELECT 'test', count(*)::int FROM test_registry WHERE repo = 'cecelia'
      UNION ALL SELECT 'graph', count(*)::int FROM graph_edges WHERE repo = 'cecelia'
    )
    SELECT h.kind, h.source_revision, h.scanner_version, h.row_count, f.fact_count
      FROM fact_snapshot_headers h
      JOIN fact_counts f USING (kind)
     WHERE h.repo = 'cecelia'
     ORDER BY h.kind")"

  while IFS='|' read -r kind revision scanner header_count_value fact_count; do
    [[ -n "$kind" ]] || continue
    header_count=$((header_count + 1))
    case "$kind" in
      api) expected_scanner='api-registry-v2' ;;
      db_schema) expected_scanner='db-schema-v2' ;;
      test) expected_scanner='test-registry-v2' ;;
      graph) expected_scanner='graph-v3' ;;
      *) fail "未知 header kind: $kind" ;;
    esac
    [[ "$revision" == "$TARGET_REVISION" ]] \
      || fail "$kind revision 不等于目标 HEAD: $revision"
    [[ "$scanner" == "$expected_scanner" && "$scanner" != 'legacy' ]] \
      || fail "$kind scanner_version 异常: $scanner"
    [[ "$header_count_value" == "$fact_count" ]] \
      || fail "$kind row_count=$header_count_value 与事实数=$fact_count 不一致"
    [[ "$fact_count" =~ ^[0-9]+$ && "$fact_count" -gt 0 ]] \
      || fail "$kind 事实数必须大于 0: $fact_count"
  done <<< "$header_output"
  [[ "$header_count" -eq 4 ]] || fail "cecelia header 不完整: expected=4 actual=$header_count"

  local bad_metadata
  bad_metadata="$(db_scalar "
    WITH metadata AS (
      SELECT repo, source_revision, scanner_version, scanned_at FROM api_registry WHERE repo = 'cecelia'
      UNION ALL SELECT repo, source_revision, scanner_version, scanned_at FROM db_schema_registry WHERE repo = 'cecelia'
      UNION ALL SELECT repo, source_revision, scanner_version, scanned_at FROM test_registry WHERE repo = 'cecelia'
      UNION ALL SELECT repo, source_revision, scanner_version, scanned_at FROM graph_edges WHERE repo = 'cecelia'
    )
    SELECT count(*) FROM metadata
     WHERE repo <> 'cecelia'
        OR source_revision <> '$TARGET_REVISION'
        OR scanner_version = 'legacy'
        OR scanned_at IS NULL")"
  [[ "$bad_metadata" == '0' ]] || fail "存在 $bad_metadata 条 provenance 异常事实"
}

verify_freshness() {
  local expected_status="$1"
  local expected_reason="${2:-}"
  local target_repo="${3:-cecelia}"
  local target_kinds="${4:-api,db_schema,test,graph}"
  EXPECTED_STATUS="$expected_status" EXPECTED_REASON="$expected_reason" \
    TARGET_REPO="$target_repo" TARGET_KINDS="$target_kinds" DATABASE_URL="$DATABASE_URL" \
    "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import pg from 'pg';
import { computeFreshness } from './packages/brain/src/lib/registry-freshness.js';
import { listPhotoLayer } from './packages/brain/src/lib/registry-photo-layer.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const expectedStatus = process.env.EXPECTED_STATUS;
const expectedReason = process.env.EXPECTED_REASON || null;
const repo = process.env.TARGET_REPO;
const kinds = process.env.TARGET_KINDS.split(',');
const requiredKeys = [
  'status', 'reason_code', 'last_success_at', 'source_revision', 'scanner_version',
  'latest_scan', 'age_hours', 'stale', 'warning', 'row_count',
];
try {
  for (const kind of kinds) {
    let freshness;
    if (kind === 'graph') {
      const { rows } = await pool.query(
        `SELECT source_revision, scanner_version, scanned_at, row_count
           FROM fact_snapshot_headers WHERE kind = 'graph' AND repo = $1`,
        [repo],
      );
      freshness = computeFreshness(rows[0] ?? null);
    } else {
      freshness = (await listPhotoLayer(pool, kind, { repo, limit: 1 })).freshness;
    }
    for (const key of requiredKeys) {
      if (!(key in freshness)) throw new Error(`${kind} freshness 缺少 ${key}`);
    }
    if (freshness.status !== expectedStatus) {
      throw new Error(`${kind} status=${freshness.status}, expected=${expectedStatus}`);
    }
    if (freshness.reason_code !== expectedReason) {
      throw new Error(`${kind} reason=${freshness.reason_code}, expected=${expectedReason}`);
    }
    if (expectedStatus === 'fresh' && freshness.stale !== false) {
      throw new Error(`${kind} fresh 但 stale=${freshness.stale}`);
    }
    if (expectedStatus === 'unknown' && freshness.stale !== true) {
      throw new Error(`${kind} unknown 但 stale=${freshness.stale}`);
    }
  }
} finally {
  await pool.end();
}
NODE
}

printf '%s\n' '── map fact snapshot scratch smoke ──'
printf 'database=%s revision=%s\n' "$DATABASE_NAME" "$TARGET_REVISION"

/bin/bash scripts/__tests__/run-all-scans.test.sh
pass 'sanitized PATH runner 合同'

[[ "$(db_scalar "SELECT to_regclass('public.fact_snapshot_headers') IS NOT NULL")" == 't' ]] \
  || fail 'fact_snapshot_headers 不存在（scratch 尚未迁移到 400）'

METADATA_COLUMN_COUNT="$(db_scalar "
  WITH expected(table_name, column_name) AS (VALUES
    ('api_registry','repo'),('api_registry','source_revision'),('api_registry','scanner_version'),('api_registry','scanned_at'),
    ('db_schema_registry','repo'),('db_schema_registry','source_revision'),('db_schema_registry','scanner_version'),('db_schema_registry','scanned_at'),
    ('test_registry','repo'),('test_registry','source_revision'),('test_registry','scanner_version'),('test_registry','scanned_at'),
    ('graph_edges','repo'),('graph_edges','source_revision'),('graph_edges','scanner_version'),('graph_edges','scanned_at')
  )
  SELECT count(*) FROM expected e
  JOIN information_schema.columns c USING (table_name, column_name)
  WHERE c.table_schema = 'public'")"
[[ "$METADATA_COLUMN_COUNT" == '16' ]] || fail "metadata 列不完整: $METADATA_COLUMN_COUNT/16"
pass '四类事实 metadata 列与 snapshot header schema'

DATABASE_URL="$DATABASE_URL" REPO_ROOT_CECELIA="$REPO_ROOT_CECELIA" \
  REPO_ROOT_ZJ_WORKSPACE='/nonexistent/map-smoke-zj-workspace' \
  REPO_ROOT_ZJ_SKILLS='/nonexistent/map-smoke-zj-skills' \
  GRAPH_REPOS=cecelia SKIP_GIT_PULL=1 MAP_REBUILD_DISABLED=1 \
  FACT_SNAPSHOT_TEST_MODE=1 /bin/bash scripts/scan/run-all-scans.sh
pass '四 scanner 自包含刷新'

verify_headers_and_facts
pass '四类 header revision/version/row_count 与事实一致'

verify_freshness fresh
pass '四类 freshness shape 为 fresh'

SMOKE_REPO="$SMOKE_REPO" SMOKE_REVISION="$TARGET_REVISION" DATABASE_URL="$DATABASE_URL" \
  "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import pg from 'pg';
import { replaceFactSnapshot } from './packages/brain/src/lib/fact-snapshot-store.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const repo = process.env.SMOKE_REPO;
const base = { method: 'GET', file_path: 'smoke.js', line_number: 1, area: 'smoke' };
try {
  await replaceFactSnapshot(pool, 'api', {
    repo, sourceRevision: process.env.SMOKE_REVISION, scannerVersion: 'smoke-v1',
    rows: [{ ...base, path: '/kept' }, { ...base, path: '/gone' }],
  });
  await replaceFactSnapshot(pool, 'api', {
    repo, sourceRevision: process.env.SMOKE_REVISION, scannerVersion: 'smoke-v1',
    rows: [{ ...base, path: '/kept' }],
  });
  const facts = await pool.query('SELECT path FROM api_registry WHERE repo = $1 ORDER BY path', [repo]);
  const header = await pool.query(
    `SELECT row_count FROM fact_snapshot_headers WHERE kind = 'api' AND repo = $1`, [repo],
  );
  if (JSON.stringify(facts.rows) !== JSON.stringify([{ path: '/kept' }])) {
    throw new Error(`消失事实未删除: ${JSON.stringify(facts.rows)}`);
  }
  if (header.rows[0]?.row_count !== 1) throw new Error('演习 header row_count 不等于1');
} finally {
  await pool.end();
}
NODE
pass '消失事实原子替换演习'

verify_freshness fresh '' "$SMOKE_REPO" api
db_scalar "UPDATE fact_snapshot_headers SET scanned_at = NOW() - interval '16 minutes' WHERE kind = 'api' AND repo = '$SMOKE_REPO'" >/dev/null
verify_freshness unknown snapshot_stale "$SMOKE_REPO" api
pass '16 分钟快照 fail-closed unknown/snapshot_stale'

SMOKE_REPO="$SMOKE_REPO" SMOKE_REVISION="$TARGET_REVISION" DATABASE_URL="$DATABASE_URL" \
  "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import pg from 'pg';
import { replaceFactSnapshot } from './packages/brain/src/lib/fact-snapshot-store.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await replaceFactSnapshot(pool, 'api', {
    repo: process.env.SMOKE_REPO,
    sourceRevision: process.env.SMOKE_REVISION,
    scannerVersion: 'smoke-v1',
    rows: [{
      method: 'GET', path: '/kept', file_path: 'smoke.js', line_number: 1, area: 'smoke',
    }],
  });
} finally {
  await pool.end();
}
NODE
verify_freshness fresh '' "$SMOKE_REPO" api
pass '重扫恢复 fresh 且 provenance/count 保持一致'

printf '%s\n' 'ALL PASS: map fact snapshot scratch smoke'
