#!/usr/bin/env bash
# sprint-docs-smoke.sh
# 验证 GET /api/brain/harness/sprint-docs 端点已注册（非 404）
# 目标：确保路由在 Brain 启动后可访问，schema 字段正确
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/cecelia-sprint-visibility-0528}"
echo "🔍 sprint-docs-smoke — target: $BRAIN_URL"

# 有效 sprint_dir 返回 200 + 正确 schema
RESP=$(curl -sf "${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=${SPRINT_DIR}" 2>/dev/null) || {
  echo "❌ /api/brain/harness/sprint-docs 请求失败（端点未注册或服务不可达）"
  exit 1
}

echo "$RESP" | jq -e '.sprint_dir | type == "string"' > /dev/null || {
  echo "❌ sprint_dir 字段缺失或非 string"
  exit 1
}
echo "✅ sprint_dir OK"

echo "$RESP" | jq -e '.docs | type == "object"' > /dev/null || {
  echo "❌ docs 字段缺失或非 object"
  exit 1
}
echo "✅ docs OK"

echo "$RESP" | jq -e '.docs | keys == ["contract","harness_report","prep_prd","sprint_prd"]' > /dev/null || {
  echo "❌ docs keys 不匹配（期望 [contract,harness_report,prep_prd,sprint_prd]）"
  exit 1
}
echo "✅ docs keys 匹配"

# 无效路径返回 200 + all null
RESP2=$(curl -sf "${BRAIN_URL}/api/brain/harness/sprint-docs?sprint_dir=sprints/nonexistent-smoke-xyz" 2>/dev/null) || {
  echo "❌ 不存在 sprint_dir 时端点返回非 200"
  exit 1
}
echo "$RESP2" | jq -e '.docs.prep_prd == null' > /dev/null || {
  echo "❌ 不存在文件时 prep_prd 应为 null"
  exit 1
}
echo "✅ null-path OK"

# 缺 sprint_dir 返回 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/harness/sprint-docs")
[ "$CODE" = "400" ] || {
  echo "❌ 缺 sprint_dir 时应返 400，实际 $CODE"
  exit 1
}
echo "✅ 400 on missing sprint_dir OK"

echo "✅ sprint-docs-smoke 全部通过"
