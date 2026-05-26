#!/usr/bin/env bash
# harness-pipeline-task-type-smoke.sh
# 验证 GET /api/brain/harness-pipelines 响应包含 task_type 字段
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 smoke: harness-pipelines task_type 字段"

# 1. 源码验证：buildPipelineRecord 返回 task_type
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/status.js', 'utf8');
const fnStart = c.indexOf('function buildPipelineRecord');
const fnEnd = c.indexOf('\nrouter.', fnStart);
const fn = c.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
if (!fn.includes('task_type: task.task_type')) {
  console.error('FAIL: buildPipelineRecord 未返回 task_type');
  process.exit(1);
}
console.log('✅ buildPipelineRecord 含 task_type 字段');
"

# 2. HTTP 验证（Brain 起后才跑）
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/harness-pipelines?limit=1" \
  || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  echo "⏭️  Brain 未运行，跳过 HTTP 检查（仅源码验证模式）"
  exit 0
fi

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ GET /api/brain/harness-pipelines 返回 $HTTP_CODE，期望 200"
  exit 1
fi

echo "✅ GET /api/brain/harness-pipelines 返回 200"

# 3. 验证响应包含 task_type 字段（若有 pipeline 记录）
BODY=$(curl -s "${BRAIN_URL}/api/brain/harness-pipelines?limit=1")
TOTAL=$(echo "$BODY" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).total||0))" 2>/dev/null || echo "0")

if [ "$TOTAL" = "0" ]; then
  echo "⏭️  无 pipeline 记录，跳过字段验证"
  exit 0
fi

HAS_TASK_TYPE=$(echo "$BODY" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const p = d.pipelines && d.pipelines[0];
if (p && 'task_type' in p) { process.stdout.write('yes'); } else { process.stdout.write('no'); }
" 2>/dev/null || echo "no")

if [ "$HAS_TASK_TYPE" = "yes" ]; then
  echo "✅ pipeline 记录含 task_type 字段"
else
  echo "❌ pipeline 记录缺少 task_type 字段"
  exit 1
fi

echo "✅ harness-pipeline-task-type smoke PASSED"
