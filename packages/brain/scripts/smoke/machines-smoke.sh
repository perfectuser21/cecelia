#!/usr/bin/env bash
# machines-smoke.sh — 验证 /api/brain/machines 端点基本可用
set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== machines smoke ==="
echo "Brain: $BRAIN_URL"

# 1. GET 列表
MACHINES=$(curl -sf "$BRAIN_URL/api/brain/machines") || {
  echo "❌ GET /api/brain/machines 失败"
  exit 1
}

COUNT=$(echo "$MACHINES" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
if [ "$COUNT" -lt 1 ]; then
  echo "❌ 机器列表为空，期望至少 1 台"
  exit 1
fi
echo "✅ GET /api/brain/machines — $COUNT 台机器"

# 2. 验证每条记录有必要字段
MISSING=$(echo "$MACHINES" | python3 -c "
import json,sys
machines=json.load(sys.stdin)
for m in machines:
    for field in ['id','name','metadata','conflicts','tailscale_online']:
        if field not in m:
            print(f'missing field {field} in {m.get(\"name\",\"?\")}')
" 2>/dev/null)
if [ -n "$MISSING" ]; then
  echo "❌ 字段缺失: $MISSING"
  exit 1
fi
echo "✅ 所有机器记录字段完整"

# 3. GET 单台机器
FIRST_NAME=$(echo "$MACHINES" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['name'])")
SINGLE=$(curl -sf "$BRAIN_URL/api/brain/machines/$FIRST_NAME") || {
  echo "❌ GET /api/brain/machines/$FIRST_NAME 失败"
  exit 1
}
echo "✅ GET /api/brain/machines/$FIRST_NAME — OK"

# 4. 验证 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/machines/nonexistent-machine-xyz")
if [ "$STATUS" != "404" ]; then
  echo "❌ 不存在的机器应返回 404，实际: $STATUS"
  exit 1
fi
echo "✅ 不存在机器返回 404"

echo ""
echo "✅ machines smoke 全部通过"
