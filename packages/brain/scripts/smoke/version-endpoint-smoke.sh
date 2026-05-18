#!/usr/bin/env bash
# Smoke: Brain GET /api/brain/version 端点健康检查
#
# 验证 version 端点返回正确 schema：{version, schema_version}。
# 失败条件：
#   - HTTP code != 200
#   - 缺少 version 或 schema_version 字段
#   - version 不符合 semver x.y.z 格式
set -euo pipefail

URL="${BRAIN_URL:-http://localhost:5221}/api/brain/version"
OUT=/tmp/smoke-version-endpoint.json

printf '%s\n' "▶️  smoke: version-endpoint-smoke.sh"
printf '%s\n' "   target: $URL"

HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  printf '%s\n' "❌ HTTP $HTTP_CODE (expected 200)"
  printf '%s\n' "   body:"
  jq . "$OUT" 2>/dev/null || true
  exit 1
fi

jq -e '.version | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'version' field"
  jq . "$OUT"
  exit 1
}

jq -e '.schema_version | type == "string"' "$OUT" > /dev/null || {
  printf '%s\n' "❌ Missing or non-string 'schema_version' field"
  jq . "$OUT"
  exit 1
}

VER=$(jq -r '.version' "$OUT")
printf '%s' "$VER" | node -e "const v=require('fs').readFileSync('/dev/stdin','utf8').trim();if(!/^\d+\.\d+\.\d+$/.test(v)){process.stderr.write('FAIL: not semver: '+v+'\n');process.exit(1)}"

printf '%s\n' "✅ smoke pass: $URL → 200, version=$VER"
jq . "$OUT"
