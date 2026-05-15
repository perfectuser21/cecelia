#!/usr/bin/env bash
# Smoke: Brain /api/brain/ping 轻量健康检查
#
# 真容器场景 — 验证 GET /ping 返回正确 JSON schema，POST /ping 返 405。
#
# 失败条件：
#   - GET HTTP code != 200
#   - pong 字段不为 true
#   - ts 不在 Unix seconds 范围（1e9 < ts < 1e10）
#   - response keys 不恰好为 ["pong","ts"]
#   - POST HTTP code != 405
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/ping"
OUT=/tmp/smoke-ping.json

echo "▶️  smoke: ping-smoke.sh"
echo "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ GET /ping HTTP $HTTP_CODE (expected 200)"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

# 验证 pong == true
PONG=$(node -e "const b=require('fs').readFileSync('$OUT','utf8');const j=JSON.parse(b);process.exit(j.pong===true?0:1)" 2>/dev/null && echo ok || echo fail)
if [ "$PONG" != "ok" ]; then
  echo "❌ pong 字段不为 true"
  cat "$OUT"
  exit 1
fi

# 验证 ts 在 Unix seconds 范围
TS_OK=$(node -e "const b=require('fs').readFileSync('$OUT','utf8');const j=JSON.parse(b);process.exit(j.ts>1e9&&j.ts<1e10?0:1)" 2>/dev/null && echo ok || echo fail)
if [ "$TS_OK" != "ok" ]; then
  echo "❌ ts 不在 Unix seconds 范围（1e9 < ts < 1e10）"
  cat "$OUT"
  exit 1
fi

# 验证 keys 恰好 ["pong","ts"]
KEYS_OK=$(node -e "const b=require('fs').readFileSync('$OUT','utf8');const j=JSON.parse(b);const k=Object.keys(j).sort().join(',');process.exit(k==='pong,ts'?0:1)" 2>/dev/null && echo ok || echo fail)
if [ "$KEYS_OK" != "ok" ]; then
  echo "❌ response keys 不恰好为 [pong,ts]"
  cat "$OUT"
  exit 1
fi

# 验证 POST → 405
POST_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$URL")
if [ "$POST_CODE" != "405" ]; then
  echo "❌ POST /ping HTTP $POST_CODE (expected 405)"
  exit 1
fi

echo "✅ smoke pass: GET /ping → 200 (pong=true, ts OK, keys OK), POST /ping → 405"
cat "$OUT"
