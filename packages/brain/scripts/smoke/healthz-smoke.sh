#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/healthz 端点健康检查
#
# 验证 healthz 端点返回正确 schema：{status, db, tick, last_tick_at, checked_at}。
# 失败条件：
#   - HTTP code != 200 且 HTTP code != 503（任意状态均应有 JSON 响应）
#   - 缺少 status / db / tick 字段
#   - status 不是 ok/degraded/critical
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/healthz"
OUT=/tmp/smoke-healthz.json

printf '%s\n' "▶️  smoke: healthz-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "503" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200 or 503)"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

jq -e '.status | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'status' field"
  jq . "$OUT"
  exit 1
}

jq -e '.db | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'db' field"
  jq . "$OUT"
  exit 1
}

jq -e '.tick | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'tick' field"
  jq . "$OUT"
  exit 1
}

STATUS=$(jq -r '.status' "$OUT")
if [[ "$STATUS" != "ok" && "$STATUS" != "degraded" && "$STATUS" != "critical" ]]; then
  printf '%s\n' "❌ status must be ok/degraded/critical, got: $STATUS"
  jq . "$OUT"
  exit 1
fi

jq -e '.checked_at | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing 'checked_at' field"
  jq . "$OUT"
  exit 1
}

printf '%s\n' "✅ smoke pass: $URL → HTTP $HTTP_CODE, status=$STATUS"
jq . "$OUT"
