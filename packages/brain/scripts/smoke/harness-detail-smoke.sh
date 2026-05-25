#!/usr/bin/env bash
# harness-detail-smoke.sh
# 验证 GET /api/brain/harness/initiative/:id/detail 端点
# WS2: 404 for non-existent UUID, response shape correct for existing initiative
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== harness-detail-smoke ==="
echo "Brain: $BRAIN_URL"
echo ""

# Step 1: 健康检查
HTTP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BRAIN_URL/api/brain/health")
if [ "$HTTP_HEALTH" != "200" ]; then
  echo "❌ Brain health check failed: HTTP $HTTP_HEALTH"
  exit 1
fi
echo "✅ Brain health OK"

# Step 2: 不存在 UUID → 404 + error 字段
FAKE_UUID="00000000-0000-0000-0000-000000000000"
HTTP_CODE=$(curl -s -o /tmp/detail-404.json -w "%{http_code}" "$BRAIN_URL/api/brain/harness/initiative/$FAKE_UUID/detail")
if [ "$HTTP_CODE" != "404" ]; then
  echo "❌ Expected 404 for unknown UUID, got $HTTP_CODE"
  cat /tmp/detail-404.json
  exit 1
fi
node -e "
const r = JSON.parse(require('fs').readFileSync('/tmp/detail-404.json','utf8'));
if (typeof r.error !== 'string') { console.error('FAIL: error field missing or not string'); process.exit(1); }
console.log('  error field:', r.error.slice(0,60));
"
echo "✅ 404 path: unknown UUID returns 404 + error string"

# Step 3: 若有 harness_initiative 任务 → 验证 200 响应 shape
INIT_ID=$(curl -sf "$BRAIN_URL/api/brain/tasks?task_type=harness_initiative&limit=1" 2>/dev/null \
  | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks=d.tasks||d.data||d||[];
    const arr=Array.isArray(tasks)?tasks:(Array.isArray(tasks.tasks)?tasks.tasks:[]);
    process.stdout.write(arr.length>0?arr[0].id:'');
  " 2>/dev/null || true)

if [ -z "$INIT_ID" ]; then
  echo "ℹ️  No harness_initiative tasks found, skipping 200-path check"
else
  HTTP_200=$(curl -s -o /tmp/detail-200.json -w "%{http_code}" "$BRAIN_URL/api/brain/harness/initiative/$INIT_ID/detail")
  if [ "$HTTP_200" != "200" ]; then
    echo "❌ Expected 200 for existing initiative $INIT_ID, got $HTTP_200"
    cat /tmp/detail-200.json
    exit 1
  fi
  node -e "
    const r = JSON.parse(require('fs').readFileSync('/tmp/detail-200.json','utf8'));
    const keys = Object.keys(r).sort().join(',');
    const expected = 'contract_content,gan_rounds,initiative_id,prd_content,screenshot_urls,step_timing';
    if (keys !== expected) { console.error('FAIL: keys =', keys, '\\nexpected:', expected); process.exit(1); }
    if (typeof r.initiative_id !== 'string') { console.error('FAIL: initiative_id not string'); process.exit(1); }
    if (!Array.isArray(r.step_timing)) { console.error('FAIL: step_timing not array'); process.exit(1); }
    if (!Array.isArray(r.screenshot_urls)) { console.error('FAIL: screenshot_urls not array'); process.exit(1); }
    console.log('  initiative_id:', r.initiative_id.slice(0,8), '... step_timing:', r.step_timing.length, 'items');
  "
  echo "✅ 200 path: response shape correct for existing initiative"
fi

echo ""
echo "✅ harness-detail-smoke passed"
