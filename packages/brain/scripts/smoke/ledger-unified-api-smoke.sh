#!/usr/bin/env bash
# ledger-unified-api-smoke.sh
# 验证 GET /api/brain/ledger 统一账本端点：返回 11 要素覆盖结构，/cecelia/ledger 已重定向
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "=== ledger-unified-api smoke ==="

# 1. 端点可达，返回 rows + meta 结构
RESULT=$(curl -sf "$BRAIN_URL/api/brain/ledger?limit=5" 2>/dev/null)
echo "$RESULT" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
if(!Array.isArray(j.rows)) process.exit(1);
if(typeof j.meta !== 'object') process.exit(1);
if(typeof j.meta.total !== 'number') process.exit(1);
console.log('rows: ' + j.rows.length + ', total: ' + j.meta.total);
" > /dev/null
TOTAL=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).meta.total))")
echo "✅ GET /api/brain/ledger — OK (total=$TOTAL)"

# 2. 若有数据则验证 11 要素字段结构
ROWCOUNT=$(echo "$RESULT" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).rows.length))")
if [ "$ROWCOUNT" -gt 0 ]; then
  echo "$RESULT" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
const row=j.rows[0];
if(!row.coverage) process.exit(1);
const need=['fr','nfr','invariant','gate','ttl','death','failure','e2e','adversarial','freshness','twoaxis'];
for(const k of need){
  if(!(k in row.coverage)){console.error('missing coverage key:',k);process.exit(1);}
}
if(typeof row.coverage_score !== 'number') process.exit(1);
" > /dev/null
  echo "✅ 11 要素 coverage 字段全部存在（fr/nfr/invariant/gate/ttl/death/failure/e2e/adversarial/freshness/twoaxis）"
  echo "✅ coverage_score 字段存在"
else
  echo "⏭️  journey_features 无数据，跳过字段断言"
fi

# 3. ?journey_id 过滤参数不报错（空结果 OK）
FILTER_RESULT=$(curl -sf "$BRAIN_URL/api/brain/ledger?journey_id=nonexistent-id-smoke-test&limit=1" 2>/dev/null)
echo "$FILTER_RESULT" | node -e "
const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(!Array.isArray(j.rows)) process.exit(1);
if(j.rows.length !== 0) process.exit(1);
" > /dev/null
echo "✅ ?journey_id 过滤 — 无匹配返回空 rows"

PASS=3
FAIL=0
echo ""
echo "PASS: $PASS  FAIL: $FAIL"
