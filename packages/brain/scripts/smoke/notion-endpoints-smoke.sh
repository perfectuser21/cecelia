#!/usr/bin/env bash
# notion-endpoints-smoke.sh
# 验证 POST /api/brain/notes、/notion/project、/notion/task 三个端点已注册（非 404）
# 目标：确保路由在 Brain 启动后可访问（201 或 502，绝不 404）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
echo "🔍 notion-endpoints-smoke — target: $BRAIN_URL"

# /notes 端点检查
CODE_NOTES=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke-test","content":"c","type":"Note"}')
[ "$CODE_NOTES" = "201" ] || [ "$CODE_NOTES" = "502" ] || {
  echo "❌ /api/brain/notes 返回 $CODE_NOTES（应为 201 或 502）"
  exit 1
}
echo "✅ /api/brain/notes OK (HTTP $CODE_NOTES)"

# /notion/project 端点检查
CODE_PROJ=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/notion/project" \
  -H "Content-Type: application/json" \
  -d '{"title":"SmokeRun"}')
[ "$CODE_PROJ" = "201" ] || [ "$CODE_PROJ" = "502" ] || {
  echo "❌ /api/brain/notion/project 返回 $CODE_PROJ（应为 201 或 502）"
  exit 1
}
echo "✅ /api/brain/notion/project OK (HTTP $CODE_PROJ)"

# /notion/task 端点检查
CODE_TASK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke task","ws_number":1}')
[ "$CODE_TASK" = "201" ] || [ "$CODE_TASK" = "502" ] || {
  echo "❌ /api/brain/notion/task 返回 $CODE_TASK（应为 201 或 502）"
  exit 1
}
echo "✅ /api/brain/notion/task OK (HTTP $CODE_TASK)"

# 400 验证：缺 title → 必须返回 400
CODE_400=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"content":"c","type":"Note"}')
[ "$CODE_400" = "400" ] || {
  echo "❌ /api/brain/notes 缺 title 应返 400，实际 $CODE_400"
  exit 1
}
echo "✅ /api/brain/notes 缺 title → 400 OK"

echo ""
echo "✅ notion-endpoints-smoke 全部通过"
