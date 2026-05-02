#!/usr/bin/env bash
# Smoke: Brain /api/brain/langfuse/recent 代理可用性
#
# 验证 Brain 暴露的 Langfuse trace 代理路由：
# 1. HTTP 200
# 2. body 含 success 字段
# 3. body 含 data 数组（fail-soft 保证：即使 Langfuse 不可达也返回 200 + data:[]）
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/langfuse/recent?limit=5"
OUT=/tmp/smoke-langfuse-recent.json

echo "▶️  smoke: langfuse-recent-smoke.sh"
echo "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" --max-time 10 "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ HTTP $HTTP_CODE (expected 200)"
  echo "   body:"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

for key in '"success"' '"data"'; do
  if ! grep -q "$key" "$OUT"; then
    echo "❌ Response missing $key field"
    echo "   body:"
    cat "$OUT"
    exit 1
  fi
done

echo "✅ smoke pass: $URL → 200, body has success+data"
cat "$OUT"
