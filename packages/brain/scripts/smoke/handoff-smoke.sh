#!/usr/bin/env bash
# handoff-smoke.sh — 方案B handoff 真环境冒烟：
# 真 DB 插临时任务行 → node 调 buildHandoff+saveHandoff → 查回 result.handoff →
# getRecentHandoffs 命中 → trap 清理临时行。镜像目录用 mktemp（不污染 docs/handoffs）。
# 连接：优先 DATABASE_URL（CI real-env-smoke 提供，用户 cecelia）；无则本机默认 postgres。
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain

if [ -n "${DATABASE_URL:-}" ]; then
  PSQL="psql ${DATABASE_URL} -tA"
else
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  PSQL="${PSQL:-psql -h localhost -p 5432 -U postgres -d cecelia -tA}"
fi
SMOKE_ID="eeeeeeee-0000-4000-8000-$(date +%H%M%S)000000"
SMOKE_JOURNEY="eeeeeeee-0000-4000-8000-000000000001"
export HANDOFF_DOCS_DIR="$(mktemp -d)"
export SMOKE_DATABASE_URL="${DATABASE_URL:-}"

cleanup() {
  $PSQL -c "DELETE FROM tasks WHERE id='${SMOKE_ID}';" >/dev/null 2>&1 || true
  rm -rf "$HANDOFF_DOCS_DIR"
}
trap cleanup EXIT

echo "[1/4] 插入临时任务行 ${SMOKE_ID}"
$PSQL -c "INSERT INTO tasks (id, title, status, task_type, completed_at, payload)
  VALUES ('${SMOKE_ID}', '[SMOKE] handoff', 'completed', 'dev', NOW(),
          '{\"journey_id\":\"${SMOKE_JOURNEY}\"}'::jsonb);" >/dev/null

echo "[2/4] node 调 buildHandoff + saveHandoff"
node --input-type=module -e "
import { buildHandoff, saveHandoff } from './src/handoff.js';
import pg from 'pg';
const pool = process.env.SMOKE_DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.SMOKE_DATABASE_URL })
  : new pg.Pool({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'cecelia' });
const h = buildHandoff({ task_id: '${SMOKE_ID}', journey_id: '${SMOKE_JOURNEY}', title: 'smoke', verdict: 'PASS', done: ['smoke done'] });
const r = await saveHandoff({ pool }, h);
if (!r.dbWritten) { console.error('dbWritten=false'); process.exit(1); }
if (!r.mirrorPath) { console.error('mirrorPath=null'); process.exit(1); }
await pool.end();
console.log('saved, mirror=' + r.mirrorPath);
"

echo "[3/4] 查回 result.handoff"
GOT=$($PSQL -c "SELECT result->'handoff'->>'verdict' FROM tasks WHERE id='${SMOKE_ID}';")
[ "$GOT" = "PASS" ] || { echo "FAIL: verdict=$GOT"; exit 1; }

echo "[4/4] getRecentHandoffs 命中"
node --input-type=module -e "
import { getRecentHandoffs } from './src/handoff.js';
import pg from 'pg';
const pool = process.env.SMOKE_DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.SMOKE_DATABASE_URL })
  : new pg.Pool({ host: 'localhost', port: 5432, user: 'postgres', password: process.env.PGPASSWORD, database: 'cecelia' });
const rows = await getRecentHandoffs({ pool }, { journeyId: '${SMOKE_JOURNEY}', limit: 3 });
await pool.end();
if (rows.length < 1 || rows[0].handoff?.verdict !== 'PASS') { console.error('recent handoffs miss'); process.exit(1); }
console.log('hit: ' + rows.length);
"

echo "✅ handoff-smoke 全过"
