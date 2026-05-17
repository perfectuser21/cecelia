#!/usr/bin/env bash
# Smoke: Brain /api/brain/tick/status 健康检查
#
# 真容器场景示范脚本 — 由 CI real-env-smoke job 在 Brain docker container 起来后调用。
# 验证 Brain 真容器（不 mock）能正常响应 tick/status 请求。
#
# 失败条件：
#   - HTTP code != 200
#   - 返回 JSON 不含 "lastTickAt" / "intervalMs" 字段
#
# 与单测互补：单测 mock 一切；smoke 跑 brain image + 真 postgres + 真 HTTP。
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/tick/status"
OUT=/tmp/smoke-tick-status.json

echo "▶️  smoke: example-health-check.sh"
echo "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ HTTP $HTTP_CODE (expected 200)"
  echo "   body:"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

# 验证返回结构：tick/status 必含 interval_minutes / loop_interval_ms / startup_ok 字段
for key in '"interval_minutes"' '"loop_interval_ms"' '"startup_ok"'; do
  if ! grep -q "$key" "$OUT"; then
    echo "❌ Response missing $key field"
    echo "   body:"
    cat "$OUT"
    exit 1
  fi
done

echo "✅ smoke pass: $URL → 200, body OK"
cat "$OUT"
