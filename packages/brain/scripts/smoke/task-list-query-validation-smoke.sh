#!/usr/bin/env bash
# task-list-query-validation-smoke.sh
# 验证 GET /api/brain/tasks 的 status/limit 集中校验（parseTaskListQuery）：
#   非法 status / limit → 400 + error 码；合法筛选 → 200 + 数组。只读，不写库。
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── tasks 列表查询参数校验 smoke ──"

# $1=查询串 $2=期望 HTTP 码 $3=期望 error 码（空=期望返回数组）
check() {
  local qs="$1" want_code="$2" want_err="$3" body code
  body=$(mktemp)
  code=$(curl -q -s -o "$body" -w "%{http_code}" "$BRAIN/api/brain/tasks?$qs") || code="000"
  if [[ "$code" != "$want_code" ]]; then
    fail "?$qs 返回 HTTP ${code}（期望 ${want_code}）"
    rm -f "$body"; return
  fi
  local got
  got=$(node -e "
    const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    console.log(Array.isArray(d) ? '__array__' : (d.error || ''));
  " "$body" 2>/dev/null || echo "__unparsable__")
  rm -f "$body"
  local expect="${want_err:-__array__}"
  [[ "$got" == "$expect" ]] && ok "?$qs → ${code} ${expect}" || fail "?$qs 响应体为 ${got}（期望 ${expect}）"
}

check "status=queud"            400 invalid_status
check "limit=abc"               400 invalid_limit
check "limit=0"                 400 invalid_limit
check "limit=1001"              400 invalid_limit
check "status=queued&limit=5"   200 ""
check "limit=1"                 200 ""

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 ${FAIL} 项失败"; exit 1; }
