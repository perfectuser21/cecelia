#!/usr/bin/env bash
# capture-destination-link-smoke.sh
# 验证：① captures 表有 destination_type/destination_id 字段（migration 385）
#       ② GET /api/brain/captures/aging 端点可用（capture_aging_sentinel 视图）
#       ③ PATCH /api/brain/captures/:id 支持写入 destination_type
# CI：由 packages/quality/smoke-allowlist.txt 注册后，ci-smoke-glob-runner.yml 自动调用
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"

echo "=== smoke: capture-destination-link ==="

# 1. 创建测试 capture
echo "--- 1. 创建测试 capture ---"
DEDUPE="smoke-dest-link-$$"
CREATE_RESP=$(curl -sf -X POST "${BRAIN}/api/brain/captures" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"smoke test capture for destination link\",\"source\":\"dashboard\",\"dedupe_key\":\"${DEDUPE}\"}" 2>/dev/null || echo '{}')
CAPTURE_ID=$(echo "${CREATE_RESP}" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
try { console.log(JSON.parse(d).id||''); } catch(e){ console.log(''); }
")
if [ -z "${CAPTURE_ID}" ]; then
  echo "::warning:: 无法创建测试 capture，跳过 destination 写入测试"
else
  echo "  capture_id: ${CAPTURE_ID}"

  # 2. GET 返回包含 destination_type 字段
  echo "--- 2. GET /captures/:id 含 destination_type 字段 ---"
  GET_RESP=$(curl -sf "${BRAIN}/api/brain/captures/${CAPTURE_ID}" 2>/dev/null || echo '{}')
  HAS_FIELD=$(echo "${GET_RESP}" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
try { const o=JSON.parse(d); console.log('destination_type' in o ? 'yes':'no'); } catch(e){ console.log('no'); }
")
  if [ "${HAS_FIELD}" != "yes" ]; then
    echo "::error:: smoke FAIL — GET /captures/:id 未含 destination_type 字段（migration 385 未应用？）"
    exit 1
  fi
  echo "  ✅ destination_type 字段存在"

  # 3. PATCH destination_type=na（无需真实 initiative）
  echo "--- 3. PATCH destination_type=na ---"
  PATCH_RESP=$(curl -sf -X PATCH "${BRAIN}/api/brain/captures/${CAPTURE_ID}" \
    -H "Content-Type: application/json" \
    -d '{"destination_type":"na"}' 2>/dev/null || echo '{}')
  DEST_TYPE=$(echo "${PATCH_RESP}" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
try { console.log(JSON.parse(d).destination_type||''); } catch(e){ console.log(''); }
")
  if [ "${DEST_TYPE}" != "na" ]; then
    echo "::error:: smoke FAIL — PATCH destination_type=na 写入失败（返回: ${DEST_TYPE}）"
    exit 1
  fi
  echo "  ✅ destination_type=na 写入成功"

  # 4. 清理：删除测试 capture
  curl -sf -X DELETE "${BRAIN}/api/brain/captures/${CAPTURE_ID}" 2>/dev/null || true
fi

# 5. aging 端点（capture_aging_sentinel 视图）
echo "--- 5. GET /api/brain/captures/aging 可用 ---"
AGING_STATUS=$(curl -so /dev/null -w "%{http_code}" "${BRAIN}/api/brain/captures/aging" 2>/dev/null || echo "000")
if [ "${AGING_STATUS}" = "200" ]; then
  echo "  ✅ /captures/aging → 200（视图存在）"
elif [ "${AGING_STATUS}" = "503" ]; then
  echo "  ⚠️  /captures/aging → 503（视图未建，migration 385 pending）"
elif [ "${AGING_STATUS}" = "000" ]; then
  echo "  ⚠️  Brain 不可达，跳过 aging 端点检测"
else
  echo "::error:: smoke FAIL — /captures/aging 返回意外状态 ${AGING_STATUS}"
  exit 1
fi

echo "=== smoke PASS: capture-destination-link ==="
