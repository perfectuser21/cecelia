#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/harness/ping 端点健康检查
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/harness/ping"
OUT=/tmp/smoke-harness-ping.json

printf '%s\n' "▶️  smoke: harness-ping-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200)"
  cat "$OUT"
  exit 1
fi

jq -e '.ok == true' "$OUT" > /dev/null || {
  printf '%s\n' "❌ .ok != true"
  jq . "$OUT"
  exit 1
}

jq -e '.ts | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ .ts is not a string"
  jq . "$OUT"
  exit 1
}

jq -e 'keys == ["ok","ts"]' "$OUT" > /dev/null || {
  printf '%s\n' "❌ keys != [\"ok\",\"ts\"]"
  jq . "$OUT"
  exit 1
}

printf '%s\n' "✅ /api/brain/harness/ping smoke passed"
