#!/usr/bin/env bash
# scratch-only 真验火：完整 Map Manifest 校验、幂等 draft 与原子激活。
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

SMOKE_SCOPE="map-manifest-smoke-$$"
SMOKE_DECISION_ID="$($NODE_EXECUTABLE -e "process.stdout.write(require('node:crypto').randomUUID())")"

cleanup() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DELETE FROM map_projection_runs WHERE scope_key = '$SMOKE_SCOPE'" \
    -c "DELETE FROM map_manifest_versions WHERE scope_key = '$SMOKE_SCOPE'" \
    -c "DELETE FROM map_scope_repositories WHERE scope_key = '$SMOKE_SCOPE'" \
    -c "DELETE FROM decisions WHERE id = '$SMOKE_DECISION_ID'" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

db_scalar() {
  "$PSQL_EXECUTABLE" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"
}

printf '%s\n' '── map manifest scratch smoke ──'
printf 'database=%s scope=%s\n' "$DATABASE_NAME" "$SMOKE_SCOPE"

[[ "$(db_scalar "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version='407')")" == 't' ]] \
  || fail 'schema_version 407 不存在'
[[ "$(db_scalar "SELECT to_regclass('public.map_manifest_versions') IS NOT NULL")" == 't' ]] \
  || fail 'map_manifest_versions 不存在'
[[ "$(db_scalar "SELECT to_regclass('public.map_scope_repositories') IS NOT NULL")" == 't' ]] \
  || fail 'map_scope_repositories 不存在'
pass 'migration 402/407 与 manifest/repo adapter tables'

DATABASE_URL="$DATABASE_URL" SMOKE_SCOPE="$SMOKE_SCOPE" SMOKE_DECISION_ID="$SMOKE_DECISION_ID" \
  "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { validateMapManifest } from './packages/brain/src/lib/map-manifest-schema.js';
import { activateMapManifest, submitMapManifest } from './packages/brain/src/lib/map-manifest-store.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const manifest = JSON.parse(await readFile(
  './packages/brain/config/map-manifests/cecelia.v1.json', 'utf8',
));
manifest.scope_key = process.env.SMOKE_SCOPE;
manifest.source_decision_id = process.env.SMOKE_DECISION_ID;

try {
  const validation = validateMapManifest(manifest);
  if (!validation.valid) throw new Error(`frozen manifest invalid: ${JSON.stringify(validation.errors)}`);
  if (manifest.value_streams.length !== 2 || manifest.capabilities.length !== 11
    || manifest.boundaries.length !== 2 || manifest.crosscut_pool.length !== 7
    || manifest.shared_prerequisites.applicable !== false) {
    throw new Error('frozen manifest shape is not 2x11x2x7/applicable=false');
  }

  await pool.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', 'map-manifest-smoke', 'scratch fixture',
       'verify map manifest contract', 'active', 'codex', 'user', 'P2')`,
    [process.env.SMOKE_DECISION_ID],
  );
  await pool.query(
    `INSERT INTO map_scope_repositories
      (scope_key, repo, adapter_key, adapter_config)
     VALUES ($1, $1, 'legacy-ledger-v1',
       '{"ledger_partition":"infrastructure"}'::jsonb)`,
    [process.env.SMOKE_SCOPE],
  );

  const first = await submitMapManifest(pool, manifest);
  const duplicate = await submitMapManifest(pool, manifest);
  if (!first.created || duplicate.created) throw new Error('draft idempotency flags are invalid');
  if (first.manifest_version.id !== duplicate.manifest_version.id
    || first.manifest_version.version !== 1 || first.manifest_version.status !== 'draft') {
    throw new Error('duplicate submission did not return the original draft');
  }

  const beforeActivation = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status='draft')::int AS drafts,
            count(*) FILTER (WHERE status='active')::int AS active
       FROM map_manifest_versions WHERE scope_key=$1`,
    [process.env.SMOKE_SCOPE],
  );
  if (JSON.stringify(beforeActivation.rows[0]) !== JSON.stringify({ total: 1, drafts: 1, active: 0 })) {
    throw new Error(`unexpected draft counts: ${JSON.stringify(beforeActivation.rows[0])}`);
  }

  const activation = await activateMapManifest(pool, first.manifest_version.id);
  if (!activation.activated || activation.manifest_version.status !== 'active') {
    throw new Error('manifest activation did not produce an active version');
  }

  const afterActivation = await pool.query(
    `SELECT status, activated_at FROM map_manifest_versions WHERE scope_key=$1`,
    [process.env.SMOKE_SCOPE],
  );
  if (afterActivation.rows[0]?.status !== 'active' || afterActivation.rows[0]?.activated_at === null) {
    throw new Error(`activation did not persist active state: ${JSON.stringify(afterActivation.rows)}`);
  }
} finally {
  await pool.end();
}
NODE
pass '冻结 2×11×2×7 manifest 校验、幂等 draft 与原子激活'

cleanup
trap - EXIT
RESIDUE="$(db_scalar "
  SELECT
    (SELECT count(*) FROM map_manifest_versions WHERE scope_key='$SMOKE_SCOPE')::text
    || '|' ||
    (SELECT count(*) FROM map_scope_repositories WHERE scope_key='$SMOKE_SCOPE')::text
    || '|' ||
    (SELECT count(*) FROM decisions WHERE id='$SMOKE_DECISION_ID')::text")"
[[ "$RESIDUE" == '0|0|0' ]] || fail "fixture 残留: $RESIDUE"
pass 'scratch fixture 清理'

printf '%s\n' 'ALL PASS'
