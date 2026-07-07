#!/usr/bin/env bash
# judge-api-smoke.sh — 验证 POST /harness/judge 和 POST /orchestrator/relay-runs 端点存在
#
# proven-to-fire：改错路由名运行此脚本会红（400 ≠ 404）。
# 参数缺失应答 400 而非 404，证明路由已注册（404 = 路由未找到）。
#
# 使用方式：
#   bash packages/brain/scripts/smoke/judge-api-smoke.sh
#   BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/judge-api-smoke.sh

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local status="$2"
  local expected="$3"
  if [[ "$status" == "$expected" ]]; then
    echo "  ✓ $label (HTTP $status)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — expected HTTP $expected, got $status"
    FAIL=$((FAIL + 1))
  fi
}

echo "[judge-api-smoke] BRAIN_URL=$BRAIN_URL"

# 1. POST /harness/judge — 参数缺失 → 400（非 404，证明路由已注册）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BRAIN_URL}/api/brain/harness/judge" \
  -H "Content-Type: application/json" \
  -d '{}')
check "POST /harness/judge 缺参数 → 400" "$STATUS" "400"

# 2. POST /orchestrator/relay-runs/:id — 不存在的 initiative → 404（路由注册 + task 不存在）
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BRAIN_URL}/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000" \
  -H "Content-Type: application/json" \
  -d '{}')
check "POST /orchestrator/relay-runs/{nonexistent} → 404" "$STATUS" "404"

echo ""
echo "[judge-api-smoke] 完成：✓ $PASS  ✗ $FAIL"
[[ $FAIL -eq 0 ]]
