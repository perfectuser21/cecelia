#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== task-router smoke ==="

# license 段已移除：/api/brain/license 路由随迁移 486 收尾删除（#5654，决策 28674999）。

# task-router GET /diagnose
curl -sf "$BRAIN_URL/api/brain/task-router/diagnose" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok', f'bad: {d}'" \
  || { echo "❌ GET /api/brain/task-router/diagnose failed"; exit 1; }
echo "✅ GET /api/brain/task-router/diagnose — OK"

echo "✅ smoke-fix-license-taskrouter PASSED"
