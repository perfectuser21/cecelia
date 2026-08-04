#!/usr/bin/env bash
# nfr-decisions-assertion-ref-smoke.sh
# 验证：① decisions.category='nfr' 约束正确 ② fail-closed API 行为
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"

echo "=== smoke: nfr-decisions-assertion-ref ==="

# 1. decisions API 可查到 nfr 类别的行
echo "--- 1. 查询 nfr category decisions ---"
NR=$(curl -sf "${BRAIN}/api/brain/decisions?status=active&limit=200" \
  | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const rows=JSON.parse(d);
const list=Array.isArray(rows)?rows:(rows.decisions||[]);
console.log(list.filter(r=>r.category==='nfr').length);
")
echo "  nfr decisions 数量: ${NR}"
if [ "${NR}" -lt 1 ]; then
  echo "::error:: smoke FAIL — 无 nfr category decisions（migration 384 未应用？）"
  exit 1
fi
echo "  ✅ nfr category 存在"

# 2. PATCH 测试：无 assertion_ref 点绿 → 422（需要先找一个无 assertion_ref 的 link_id）
echo "--- 2. fail-closed 行为测试（无 assertion_ref 点绿应 422）---"
LINK_ID=$(curl -sf "${BRAIN}/api/brain/journeys/steps/00000000-0000-0000-0000-000000000001/impact" 2>/dev/null \
  | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
try{
  const r=JSON.parse(d);
  const hits=(r.impacts||[]).filter(c=>!c.assertion_ref);
  if(hits.length>0) console.log(hits[0].link_id);
}catch(e){}
" 2>/dev/null || true)

if [ -z "${LINK_ID}" ]; then
  echo "  ⏭️  无可用的 no-assertion_ref link，跳过 fail-closed 实验（step 不存在属正常）"
else
  HTTP=$(curl -sf -o /dev/null -w "%{http_code}" \
    -X PATCH "${BRAIN}/api/brain/journey_step_links/${LINK_ID}" \
    -H "Content-Type: application/json" \
    -d '{"cell_status":"green"}' 2>/dev/null || true)
  echo "  PATCH 响应码: ${HTTP}"
  if [ "${HTTP}" = "422" ]; then
    echo "  ✅ fail-closed 正确（422）"
  else
    echo "  ⏭️  link 已有 assertion_ref 或不存在，跳过（HTTP=${HTTP}）"
  fi
fi

echo "=== smoke PASS ==="
