#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/harness/ping 端点健康检查
#
# 依赖约束（蓝绿 pre-swap 在 brain 容器内跑）：只许 bash+curl+node，禁 jq。
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

node -e '
const fs=require("fs");
let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
catch(e){ console.error("❌ 响应不是合法 JSON: "+e.message); process.exit(1); }
const fail=m=>{ console.error("❌ "+m); console.error(JSON.stringify(j,null,2)); process.exit(1); };
if(j.ok!==true) fail(".ok != true");
if(typeof j.ts!=="string") fail(".ts is not a string");
if(JSON.stringify(Object.keys(j).sort())!==JSON.stringify(["ok","ts"])) fail("keys != [\"ok\",\"ts\"]");
' "$OUT"

printf '%s\n' "✅ /api/brain/harness/ping smoke passed"
