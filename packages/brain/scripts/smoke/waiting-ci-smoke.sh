#!/usr/bin/env bash
# waiting-ci-smoke.sh
# 验收：Pool C waiting_ci 等待态——等 CI/merge 任务不占执行槽
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

echo "=== Pool C waiting_ci smoke ==="

# 1. GET /api/brain/slots 返回 200
echo "── slots API ──"
RESP=$(curl -s -o /tmp/waiting-ci-slots.json -w "%{http_code}" "$API/slots")
if [[ "$RESP" != "200" ]]; then
  fail "GET /slots → 期望 200，得 $RESP"
else
  ok "GET /slots → 200"
  # 2. taskPool 包含 waiting 字段
  WAITING=$(jq '.pools.task_pool.waiting // "MISSING"' /tmp/waiting-ci-slots.json)
  if [[ "$WAITING" == "MISSING" ]] || [[ "$WAITING" == "null" ]]; then
    fail "pools.task_pool.waiting 字段缺失或为 null"
  else
    ok "pools.task_pool.waiting = $WAITING（字段存在）"
  fi
fi

echo ""
echo "Smoke 结果: ${PASS} passed, ${FAIL} failed"
exit $FAIL
