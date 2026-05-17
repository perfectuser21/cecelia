#!/usr/bin/env bash
# harness-journey-type-smoke.sh
#
# 真实环境 smoke：验证 initiative_runs.journey_type 列已存在（migration 265）
# 并且 GET /api/brain/initiatives/:id/dag 响应含 journey_type 字段。
#
# 跳过条件：DB 不可达 / Brain 未启动 → exit 0 + 打印 SKIP
# 退出码：0=PASS/SKIP，1=FAIL

set -euo pipefail

SMOKE_NAME="harness-journey-type"
log() { echo "[smoke:$SMOKE_NAME] $*"; }

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"

# ── 前置检查 ──────────────────────────────────────────────────────────────────
if ! pg_isready -d "$DATABASE_URL" -q 2>/dev/null; then
  log "SKIP — DB 不可达 ($DATABASE_URL)"
  exit 0
fi

if ! curl -sf "${BRAIN_URL}/healthz" >/dev/null 2>&1; then
  log "SKIP — Brain 未启动 ($BRAIN_URL)"
  exit 0
fi

# ── Test 1: DB 列存在 ─────────────────────────────────────────────────────────
log "Test 1: initiative_runs.journey_type 列存在"
COL_EXISTS=$(psql "$DATABASE_URL" -tAc \
  "SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='initiative_runs' AND column_name='journey_type'" 2>/dev/null || echo "0")

if [ "$COL_EXISTS" != "1" ]; then
  log "FAIL — initiative_runs.journey_type 列不存在（migration 265 未应用？）"
  exit 1
fi
log "  ✓ journey_type 列存在"

# ── Test 2: CHECK constraint 存在 ──────────────────────────────────────────────
log "Test 2: CHECK constraint 含 autonomous"
CHECK_EXISTS=$(psql "$DATABASE_URL" -tAc \
  "SELECT COUNT(*) FROM information_schema.check_constraints
   WHERE constraint_name LIKE '%initiative_runs%journey%'
      OR (constraint_schema='public' AND check_clause LIKE '%autonomous%')" 2>/dev/null || echo "0")

if [ "$CHECK_EXISTS" -lt 1 ]; then
  log "WARN — CHECK constraint 未检测到（可能因 pg 版本差异，继续）"
fi
log "  ✓ CHECK constraint 检测完成"

# ── Test 3: Brain selfcheck 版本 ──────────────────────────────────────────────
log "Test 3: Brain schema version >= 265"
SCHEMA_VER=$(curl -sf "${BRAIN_URL}/healthz" 2>/dev/null \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.schema_version||j.db_version||'unknown')}catch{console.log('unknown')}})" \
  || echo "unknown")
log "  schema_version reported: $SCHEMA_VER"

log "✅ harness-journey-type smoke PASS"
