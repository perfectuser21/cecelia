#!/usr/bin/env bash
# notion-mapping-r4-smoke.sh — Brain↔Notion 属性映射修复 (R4) smoke check
# 验证：schema 动态查询 + 属性降级逻辑在源码中存在
set -euo pipefail

BRAIN="${BRAIN:-http://localhost:5221}"
NOTES_JS="packages/brain/src/routes/notes.js"
SYNC_JS="packages/brain/src/notion-push-sync.js"

# 静态检查：notes.js 含 getDbSchemaProperties 函数 + Initiative ID 降级判断
node -e "
const fs = require('fs');
const src = fs.readFileSync('${NOTES_JS}', 'utf8');
if (!src.includes('getDbSchemaProperties')) {
  console.error('FAIL: notes.js 缺少 getDbSchemaProperties 函数'); process.exit(1);
}
if (!src.includes(\"'Initiative ID' in schemaProperties\")) {
  console.error('FAIL: notes.js 缺少 Initiative ID 属性降级判断'); process.exit(1);
}
if (!src.includes('warnings')) {
  console.error('FAIL: notes.js 缺少 warnings 字段'); process.exit(1);
}
console.log('✓ notes.js schema 动态查询 + 属性降级逻辑存在');
"

# 静态检查：notion-push-sync.js 含 Order 条件写入（降级）
node -e "
const fs = require('fs');
const src = fs.readFileSync('${SYNC_JS}', 'utf8');
if (!src.includes(\"'Order' in schemaProps\")) {
  console.error('FAIL: notion-push-sync.js 缺少 Order 属性降级判断'); process.exit(1);
}
console.log('✓ notion-push-sync.js Order 条件写入逻辑存在');
"

# 可选：如果 Brain 正在运行，验证 POST /notes 返回 warnings 数组
if curl -sf --max-time 3 "${BRAIN}/api/brain/tick/status" >/dev/null 2>&1; then
  RESP=$(curl -sf --max-time 10 -X POST "${BRAIN}/api/brain/notes" \
    -H "Content-Type: application/json" \
    -d '{"title":"[smoke-r4] notion-mapping","content":"smoke test","type":"Note"}' || echo '{}')
  node -e "
    const p = JSON.parse(process.argv[1]);
    if (!Array.isArray(p.warnings)) { console.error('FAIL: warnings 非 array:', JSON.stringify(p)); process.exit(1); }
    console.log('✓ POST /notes 返回 warnings 数组');
  " "${RESP}"
else
  echo "ℹ️  Brain 未运行，跳过 API 验证（仅静态检查）"
fi

echo "✅ notion-mapping-r4 smoke 通过"
