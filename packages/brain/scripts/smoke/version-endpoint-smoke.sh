#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/version 端点健康检查
#
# 验证 version 端点返回正确 schema：{version, schema_version}。
# 失败条件：
#   - HTTP code != 200
#   - 缺少 version 或 schema_version 字段
#   - version 不符合 semver x.y.z 格式
#
# 依赖约束（蓝绿 pre-swap 在 brain 容器内跑）：只许 bash+curl+node，禁 jq。
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/version"
OUT=/tmp/smoke-version-endpoint.json

printf '%s\n' "▶️  smoke: version-endpoint-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200)"
  printf '%s\n' "   body:"
  cat "$OUT" 2>/dev/null || true
  exit 1
fi

node -e '
const fs=require("fs");
let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
catch(e){ console.error("❌ 响应不是合法 JSON: "+e.message); process.exit(1); }
const fail=m=>{ console.error("❌ "+m); console.error(JSON.stringify(j,null,2)); process.exit(1); };
if(typeof j.version!=="string") fail("Missing or non-string \"version\" field");
if(typeof j.schema_version!=="string") fail("Missing or non-string \"schema_version\" field");
if(!/^\d+\.\d+\.\d+$/.test(j.version)) fail("FAIL: not semver: "+j.version);
' "$OUT"

VER=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$OUT")

printf '%s\n' "✅ smoke pass: $URL → 200, version=$VER"
node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),null,2))' "$OUT"
