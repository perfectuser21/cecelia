#!/usr/bin/env bash
# smoke: GET /api/brain/langfuse/trace/:id 真实链路验证
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== langfuse-trace-detail smoke ==="

# 1. 先拿一个真实 trace id
echo "[1] 获取最新 trace id..."
RECENT=$(curl -sf "${BRAIN_URL}/api/brain/langfuse/recent?limit=1")
TRACE_ID=$(echo "$RECENT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')" 2>/dev/null || echo "")

if [ -z "$TRACE_ID" ]; then
  echo "⚠️  无 trace 数据，跳过详情验证（Langfuse 可能未配置）"
  exit 0
fi

echo "    trace_id=$TRACE_ID"

# 2. 调用 trace 详情端点
echo "[2] GET /api/brain/langfuse/trace/$TRACE_ID..."
RESP=$(curl -sf "${BRAIN_URL}/api/brain/langfuse/trace/${TRACE_ID}")
echo "    response=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('success=' + str(d.get('success')) + ' trace_id=' + str(d.get('data',{}).get('trace',{}).get('id','?') if d.get('data') else 'null'))")"

# 3. 验证 success:true
echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d.get('success') == True, f'success should be True, got: {d}'
assert d.get('data') is not None, 'data should not be null'
assert 'trace' in d['data'], 'data.trace missing'
print('[OK] trace detail endpoint works')
"

echo "=== smoke PASSED ==="
