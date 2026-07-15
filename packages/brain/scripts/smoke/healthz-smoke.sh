#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/healthz 端点健康检查
#
# 验证 healthz 端点返回正确 schema：{status, db, tick, last_tick_at, checked_at}。
# 失败条件：
#   - HTTP code != 200 且 HTTP code != 503（任意状态均应有 JSON 响应）
#   - 缺少 status / db / tick 字段
#   - status 不是 ok/degraded/critical
#
# 依赖约束（蓝绿 pre-swap 在 brain 容器内跑）：只许 bash+curl+node，禁 jq。
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

node -e '
const fs=require("fs");
let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
catch(e){ console.error("❌ 响应不是合法 JSON: "+e.message); process.exit(1); }
const fail=m=>{ console.error("❌ "+m); console.error(JSON.stringify(j,null,2)); process.exit(1); };
if(typeof j.status!=="string") fail("Missing or non-string \"status\" field");
if(typeof j.db!=="string") fail("Missing or non-string \"db\" field");
if(typeof j.tick!=="string") fail("Missing or non-string \"tick\" field");
if(!["ok","degraded","critical"].includes(j.status)) fail("status must be ok/degraded/critical, got: "+j.status);
if(typeof j.checked_at!=="string") fail("Missing \"checked_at\" field");
' "$OUT"

STATUS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$OUT")

printf '%s\n' "✅ smoke pass: $URL → HTTP $HTTP_CODE, status=$STATUS"
node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),null,2))' "$OUT"
