#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── notion-property-map smoke ──"

# ARTIFACT: notion-property-map.js 模块可导入
node --input-type=module << 'JSEOF' && ok "notion-property-map.js 模块导入正常" || fail "notion-property-map.js 模块导入失败"
import { stripUnknownProperties, NOTION_PROPERTY_MAP } from '../../src/notion-property-map.js';
if (typeof stripUnknownProperties !== 'function') process.exit(1);
if (!NOTION_PROPERTY_MAP || typeof NOTION_PROPERTY_MAP !== 'object') process.exit(1);
if ((NOTION_PROPERTY_MAP.notionTask?.allowedKeys || []).includes('Status')) process.exit(1);
JSEOF

# ARTIFACT: stripUnknownProperties 语义
r=$(node --input-type=module << 'JSEOF' 2>&1
import { stripUnknownProperties } from '../../src/notion-property-map.js';
const { props, warnings } = stripUnknownProperties({ Title: { title: [] }, Bad: {} }, ['Title']);
if (!props.Title || props.Bad || !warnings.some(w => w.includes('Bad'))) process.exit(1);
console.log('OK');
JSEOF
) && ok "stripUnknownProperties 语义正确" || fail "stripUnknownProperties 语义错误"

# BEHAVIOR: POST /notes 响应含 warnings（Brain 运行时）
r=$(curl -sf -X POST "$BRAIN/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[smoke] notion-map","content":"smoke test","type":"Note"}' 2>/dev/null) \
  && echo "$r" | jq -e '.warnings | type == "array"' >/dev/null 2>&1 \
  && ok "POST /notes response 含 warnings array" \
  || fail "POST /notes response 不含 warnings（或 Brain 未运行）"

# BEHAVIOR: POST /notion/task 响应含 warnings
r2=$(curl -sf -X POST "$BRAIN/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d '{"title":"[smoke] notion-task","ws_number":0}' 2>/dev/null) \
  && echo "$r2" | jq -e '.warnings | type == "array"' >/dev/null 2>&1 \
  && ok "POST /notion/task response 含 warnings array" \
  || fail "POST /notion/task response 不含 warnings（或 Brain 未运行）"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
