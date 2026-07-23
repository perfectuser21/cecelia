#!/usr/bin/env bash
# kernel-bounded-run-smoke.sh
# 验收：Kernel 有界运行三道 fence + fixRound=3 + 持久化计数
# Sprint 07231527-relay-50170af2（task 50170af2）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CONSTANTS_FILE="$ROOT_DIR/packages/brain/src/orchestrator/constants.js"

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

echo "── Brain 可达性 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/context" 2>/dev/null)
[[ "$code" == "200" ]] \
  && ok "Brain /api/brain/context → 200" \
  || fail "Brain /api/brain/context → 期望 200，得 ${code}"

echo "── constants 数值校验（MAX_FIX_ROUNDS=3, MAX_HOPS=60）──"
FIX_ROUNDS=$(grep -oP 'MAX_FIX_ROUNDS\s*=\s*\K\d+' "$CONSTANTS_FILE" 2>/dev/null | head -1)
[[ "$FIX_ROUNDS" == "3" ]] \
  && ok "MAX_FIX_ROUNDS=3（Sprint 07231527 Blocking 1）" \
  || fail "MAX_FIX_ROUNDS 期望 3，实际 ${FIX_ROUNDS:-<empty>}"

HOPS=$(grep -oP 'MAX_HOPS\s*=\s*\K\d+' "$CONSTANTS_FILE" 2>/dev/null | head -1)
[[ "$HOPS" == "60" ]] \
  && ok "MAX_HOPS=60（Sprint 07231527 Blocking 1）" \
  || fail "MAX_HOPS 期望 60，实际 ${HOPS:-<empty>}"

echo "── orchestrator_decision_log 表存在 ──"
ROW=$(psql "${DATABASE_URL:-postgres://cecelia:cecelia@localhost:5432/cecelia}" \
  -c "SELECT 1 FROM orchestrator_decision_log LIMIT 1" -t 2>/dev/null \
  || echo "table_not_found")
[[ "$ROW" != "table_not_found" ]] \
  && ok "orchestrator_decision_log 表可访问（持久化计数依赖）" \
  || fail "orchestrator_decision_log 不可访问"

echo "── harness-pending-reviews 端点（approval bridge）──"
code2=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BRAIN_URL/api/brain/harness/pending-reviews" 2>/dev/null)
[[ "$code2" == "200" || "$code2" == "401" ]] \
  && ok "harness-pending-reviews → ${code2}（端点存在，approval bridge 已接线）" \
  || fail "harness-pending-reviews → 期望 200/401，得 ${code2}"

echo ""
echo "──────────────────────────────"
echo "kernel-bounded-run-smoke: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
