#!/usr/bin/env bash
# harness-echo-smoke.sh
# Smoke test: GET /api/brain/harness/echo 端点存在且返回正确 schema
# exit 1 if any check fails
#
# 依赖约束（蓝绿 pre-swap 在 brain 容器内跑）：只许 bash+curl+node，禁 jq。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== harness-echo smoke ==="
echo "Brain: $BRAIN_URL"

# 健康检查
curl -sf "$BRAIN_URL/api/brain/health" > /dev/null || {
  echo "❌ Brain 未运行在 $BRAIN_URL"
  exit 1
}

# Happy path
RESP=$(curl -sf "$BRAIN_URL/api/brain/harness/echo?msg=smoke") || {
  echo "❌ GET /api/brain/harness/echo?msg=smoke 返回非 200"
  exit 1
}

node -e '
let j; try { j=JSON.parse(process.argv[1]); }
catch(e){ console.error("❌ 响应不是合法 JSON: "+e.message); process.exit(1); }
if(j.ok!==true){ console.error("❌ ok 不为 true"); process.exit(1); }
if(j.echo!=="smoke"){ console.error("❌ echo 不等于 smoke"); process.exit(1); }
if(JSON.stringify(Object.keys(j).sort())!==JSON.stringify(["echo","ok"])){ console.error("❌ keys 不合规"); process.exit(1); }
' "$RESP"

# 空 msg 边界
RESP2=$(curl -sf "$BRAIN_URL/api/brain/harness/echo") || { echo "❌ 空 msg 返回非 200"; exit 1; }
node -e '
let j; try { j=JSON.parse(process.argv[1]); }
catch(e){ console.error("❌ 空 msg 响应不是合法 JSON: "+e.message); process.exit(1); }
if(j.ok!==true){ console.error("❌ 空 msg ok 不为 true"); process.exit(1); }
' "$RESP2"

echo "✅ harness-echo smoke 通过"
