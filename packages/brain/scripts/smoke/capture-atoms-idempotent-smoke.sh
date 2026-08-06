#!/usr/bin/env bash
# capture-atoms-idempotent-smoke.sh
# 验证 capture_atoms 幂等修复（migration 390 + ON CONFLICT DO NOTHING）
# task: ed911a7c — F6加厚 capture_atoms 双 token 幂等
#
# 验证：
#   1. capture-inbox.js 含 ON CONFLICT (capture_id, target_type) DO NOTHING
#   2. migration 390 文件存在且含 UNIQUE 约束定义
#   3. DB schema_version 390 已执行（DATABASE_URL 可用时）
#   4. capture_atoms.uq_capture_atoms_capture_target 约束存在（DATABASE_URL 可用时）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATABASE_URL="${DATABASE_URL:-}"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── capture-atoms-idempotent smoke ──"

# 1. 代码层幂等子句
grep -q "ON CONFLICT (capture_id, target_type) DO NOTHING" \
  "$ROOT/src/capture-inbox.js" \
  && ok "capture-inbox.js 含 ON CONFLICT DO NOTHING" \
  || bad "capture-inbox.js 缺 ON CONFLICT DO NOTHING"

# 2. migration 390 文件 + UNIQUE 约束定义
MIGRATION_FILE="$ROOT/migrations/390_capture_atoms_dedup_constraint.sql"
[ -f "$MIGRATION_FILE" ] \
  && ok "migration 390 文件存在" \
  || bad "migration 390 文件不存在"

grep -q "UNIQUE" "$MIGRATION_FILE" 2>/dev/null \
  && ok "migration 390 含 UNIQUE 定义" \
  || bad "migration 390 缺 UNIQUE 定义"

grep -q "uq_capture_atoms_capture_target" "$MIGRATION_FILE" 2>/dev/null \
  && ok "migration 390 含约束名 uq_capture_atoms_capture_target" \
  || bad "migration 390 缺约束名"

# 3. DB 验证（仅 DATABASE_URL 可用时）
if [ -n "${DATABASE_URL}" ]; then
  VERSION=$(psql "${DATABASE_URL}" -t -c \
    "SELECT version FROM schema_version WHERE version='390';" \
    2>/dev/null | tr -d ' \n')
  [ "${VERSION}" = "390" ] \
    && ok "schema_version 390 已执行" \
    || bad "schema_version 390 不存在（migration 未执行）"

  # 4. UNIQUE 约束在 information_schema 可查
  CONSTR_CNT=$(psql "${DATABASE_URL}" -t -c "
    SELECT COUNT(*) FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'capture_atoms'
      AND tc.constraint_type = 'UNIQUE'
      AND kcu.column_name = 'capture_id'
  " 2>/dev/null | tr -d ' \n')
  [ "${CONSTR_CNT:-0}" -ge 1 ] 2>/dev/null \
    && ok "capture_atoms UNIQUE(capture_id,...) 约束存在" \
    || bad "capture_atoms UNIQUE 约束不存在（count=${CONSTR_CNT:-?}）"
else
  echo "  ⏭️  DATABASE_URL 未配置，跳过 DB 验证"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[ "${FAIL}" -eq 0 ] || exit 1
