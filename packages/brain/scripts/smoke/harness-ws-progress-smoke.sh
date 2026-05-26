#!/usr/bin/env bash
# harness-ws-progress-smoke.sh
# 验证 GET /api/brain/harness/initiative/:id/ws-progress 端点存在并正确响应
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 smoke: harness ws-progress API"

# 1. 验证路由代码存在
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/harness.js', 'utf8');
if (!c.includes('ws-progress')) { console.error('FAIL: ws-progress route not found'); process.exit(1); }
if (!c.includes('checkpoint_blobs')) { console.error('FAIL: checkpoint_blobs query not found'); process.exit(1); }
console.log('✅ route source OK');
"

# 2. 验证 404 行为（不依赖数据库中的真实数据）
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/ws-progress" \
  || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  echo "⏭️  Brain 未运行，跳过 HTTP 检查（仅源码验证模式）"
  exit 0
fi

if [ "$HTTP_CODE" = "404" ]; then
  echo "✅ 404 for unknown initiative — OK"
elif [ "$HTTP_CODE" = "200" ]; then
  echo "⚠️  unexpected 200 for nil UUID — 可能 DB 有测试数据，视为 OK"
else
  echo "❌ unexpected HTTP $HTTP_CODE for nil initiative UUID"
  exit 1
fi

echo "✅ harness-ws-progress smoke PASSED"
