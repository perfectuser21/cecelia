#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== license + task-router smoke ==="

# license GET /
curl -sf "$BRAIN_URL/api/brain/license" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok', f'bad: {d}'" \
  || { echo "❌ GET /api/brain/license failed"; exit 1; }
echo "✅ GET /api/brain/license — OK"

# task-router GET /diagnose
curl -sf "$BRAIN_URL/api/brain/task-router/diagnose" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')=='ok', f'bad: {d}'" \
  || { echo "❌ GET /api/brain/task-router/diagnose failed"; exit 1; }
echo "✅ GET /api/brain/task-router/diagnose — OK"

echo "✅ smoke-fix-license-taskrouter PASSED"
