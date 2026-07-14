#!/usr/bin/env bash
# quality-test-pyramid-smoke.sh
# 验收：测试金字塔快照端点（brain 1.261.0，PR #3876）POST 存 / GET 读全链可用
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

# 快照保护：先取走当前生产快照，测完原样还回去（post-deploy 在生产跑，
# 不还会用 fixture 覆盖真数据——07-14 面板上线当天实证翻车）
ORIG=$(curl -s --max-time 5 "$API/quality/test-pyramid" 2>/dev/null || echo '')
restore_snapshot() {
  if echo "$ORIG" | grep -q '"available":true'; then
    echo "$ORIG" | python3 -c 'import sys,json;d=json.load(sys.stdin);d.pop("available",None);d.pop("updated_at",None);print(json.dumps(d))' \
      | curl -s --max-time 5 -X POST "$API/quality/test-pyramid" -H "Content-Type: application/json" -d @- >/dev/null 2>&1 || true
  fi
}
trap restore_snapshot EXIT

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. POST 合法快照 → 200
echo "── POST snapshot ──"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/quality/test-pyramid" \
  -H "Content-Type: application/json" \
  -d '{"pass":true,"failures":[],"orphans":{"total":0},"smoke":{"total":2,"unwired":[]},"permanent":{"total":1,"layers":{"unit":1}}}')
[[ "$code" == "200" ]] \
  && ok "POST /quality/test-pyramid → 200" \
  || fail "POST /quality/test-pyramid → 期望 200，得 $code"

# 2. POST 缺 pass 布尔 → 400（校验面活着）
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/quality/test-pyramid" \
  -H "Content-Type: application/json" -d '{"foo":1}')
[[ "$code" == "400" ]] \
  && ok "POST 无 pass 字段 → 400" \
  || fail "POST 无 pass 字段 → 期望 400，得 $code"

# 3. GET → 200 且 available=true、pass 字段回读一致
echo "── GET snapshot ──"
body=$(curl -s "$API/quality/test-pyramid")
echo "$body" | grep -q '"available":true' \
  && ok "GET → available:true（快照已落 working_memory 并可回读）" \
  || fail "GET → 期望 available:true，得 $body"

echo "── 结果: $PASS 通过 / $FAIL 失败 ──"
[[ "$FAIL" -eq 0 ]]
