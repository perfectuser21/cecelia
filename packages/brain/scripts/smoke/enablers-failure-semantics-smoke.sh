#!/usr/bin/env bash
# Smoke: 仓库物件故障处置读写（技能工厂第③棒，决策 1b469079，任务 dca8ebda）
# 对运行中的 Brain 发真实请求，验证行为而不是 grep 源码：
#   GET /enablers 带 shelf / failure_semantics；?keys= 取片；GET /activity_uses 参数校验；
#   POST 新建 → 重复 409 → PATCH 写处置 → 非法分类 400 → ?keys= 读回为对象。
# 含写操作：开头先过 smoke-production-guard（只放行本机测试容器），不放行整体跳过——
# 本机 localhost:5221 直通生产 Brain，不能在生产仓库里造测试物件。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi

BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "── enablers failure_semantics smoke ──"

code=$(curl -q -s -o "$TMP/all.json" -w '%{http_code}' "$BRAIN/api/brain/enablers") || code=000
if [ "$code" = "200" ] && jq -e '.enablers | type == "array"' "$TMP/all.json" >/dev/null 2>&1; then
  ok "GET /enablers 返回数组"
else
  fail "GET /enablers 期望 200 + 数组，got $code"
fi
if jq -e '(.enablers | length) == 0 or (.enablers[0] | has("shelf") and has("failure_semantics"))' "$TMP/all.json" >/dev/null 2>&1; then
  ok "物件带 shelf 与 failure_semantics 两列"
else
  fail "物件缺 shelf 或 failure_semantics"
fi

code=$(curl -q -s -o /dev/null -w '%{http_code}' "$BRAIN/api/brain/activity_uses?activity_id=not-a-uuid") || code=000
[ "$code" = "400" ] && ok "GET /activity_uses 非 uuid → 400" || fail "GET /activity_uses 非 uuid 期望 400 got $code"

key="smoke_fs_$(date +%s)_$$"
body=$(jq -n --arg k "$key" '{key:$k, name:"smoke 故障处置", kind:"infra", shelf:"external_dependency",
  failure_semantics:{rows:[{symptom:"网络慢 / 转圈", class:"retryable", wait_s:10, retries:3}]}}')
code=$(curl -q -s -o "$TMP/post.json" -w '%{http_code}' -X POST "$BRAIN/api/brain/enablers" -H 'Content-Type: application/json' -d "$body") || code=000
[ "$code" = "201" ] && ok "POST /enablers 新建 → 201" || fail "POST /enablers 期望 201 got $code $(head -c 200 "$TMP/post.json")"

code=$(curl -q -s -o /dev/null -w '%{http_code}' -X POST "$BRAIN/api/brain/enablers" -H 'Content-Type: application/json' -d "$body") || code=000
[ "$code" = "409" ] && ok "重复 key → 409" || fail "重复 key 期望 409 got $code"

curl -q -s "$BRAIN/api/brain/enablers?keys=${key},__no_such_item__" -o "$TMP/slice.json" || true
if jq -e --arg k "$key" '.count == 1 and .enablers[0].key == $k' "$TMP/slice.json" >/dev/null 2>&1; then
  ok "?keys= 只取到存在的那一件"
else
  fail "?keys= 取片结果不对：$(head -c 200 "$TMP/slice.json")"
fi

patch='{"failure_semantics":{"rows":[{"symptom":"页面写着暂无结果","class":"empty_ok"},{"symptom":"账号不对","class":"fatal"}]}}'
code=$(curl -q -s -o "$TMP/patch.json" -w '%{http_code}' -X PATCH "$BRAIN/api/brain/enablers/$key" -H 'Content-Type: application/json' -d "$patch") || code=000
[ "$code" = "200" ] && ok "PATCH 写处置 → 200" || fail "PATCH 期望 200 got $code $(head -c 200 "$TMP/patch.json")"

code=$(curl -q -s -o /dev/null -w '%{http_code}' -X PATCH "$BRAIN/api/brain/enablers/$key" -H 'Content-Type: application/json' \
  -d '{"failure_semantics":{"rows":[{"symptom":"x","class":"maybe"}]}}') || code=000
[ "$code" = "400" ] && ok "非法分类 → 400" || fail "非法分类期望 400 got $code"

curl -q -s "$BRAIN/api/brain/enablers?keys=$key" -o "$TMP/readback.json" || true
if jq -e '.enablers[0].failure_semantics.rows | length == 2 and .[0].class == "empty_ok" and .[1].class == "fatal"' "$TMP/readback.json" >/dev/null 2>&1; then
  ok "读回为对象且是 PATCH 写入的内容"
else
  fail "读回不对：$(head -c 300 "$TMP/readback.json")"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
