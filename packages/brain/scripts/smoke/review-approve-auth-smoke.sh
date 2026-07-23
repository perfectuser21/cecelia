#!/usr/bin/env bash
# review-approve-auth-smoke.sh
# 验收（issue afc50c30）：review 门批准路由必须 fail-closed——
# 无认证 POST approve/reject 绝不能得到 2xx（1b997ed6 曾借裸奔路由伪造批准 self-merge）。
# 期望：env 未配置 → 503；已配置但无 token → 401。任何 2xx = 洞复发 = FAIL。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

FAKE_TASK="00000000-0000-0000-0000-000000000000"

echo "── approve 无认证必须被拒 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$API/harness/pending-reviews/$FAKE_TASK/approve" \
  -H "Content-Type: application/json" -d '{"approved_by":"smoke"}')
if [[ "$code" == "401" || "$code" == "503" ]]; then
  ok "无 token POST approve → ${code}（fail-closed）"
else
  fail "无 token POST approve → 期望 401/503，得 ${code}（2xx=自批洞复发！）"
fi

echo "── reject 无认证必须被拒 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$API/harness/pending-reviews/$FAKE_TASK/reject" \
  -H "Content-Type: application/json" -d '{"approved_by":"smoke"}')
if [[ "$code" == "401" || "$code" == "503" ]]; then
  ok "无 token POST reject → ${code}（fail-closed）"
else
  fail "无 token POST reject → 期望 401/503，得 ${code}"
fi

echo "── 错 token 必须被拒 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$API/harness/pending-reviews/$FAKE_TASK/approve" \
  -H "x-approver-token: definitely-wrong-token" \
  -H "Content-Type: application/json" -d '{"approved_by":"smoke"}')
if [[ "$code" == "401" || "$code" == "503" ]]; then
  ok "错 token POST approve → $code"
else
  fail "错 token POST approve → 期望 401/503，得 ${code}"
fi

echo ""
echo "📊 review-approve-auth-smoke — PASS: $PASS, FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
