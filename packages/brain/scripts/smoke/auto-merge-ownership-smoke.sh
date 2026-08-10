#!/usr/bin/env bash
# auto-merge-ownership-smoke.sh
# 验收：auto-merge 归属判据改向 Brain 求证（决策 e8f6134f / 事故 PR #4755）。
#   ① Brain 只读端点 /api/brain/harness/pr-ownership 可用、返回结构正确；
#   ② should-auto-merge.sh 的 fail-closed 红线：Brain 不可达时输出 SKIP（绝不 MERGE）。
# 说明：CI 空库下 pr-ownership 对未知 PR/分支返回 harness_owned=false（已知非 harness PR
#   的正确归属）；已知 harness PR→true 由 harness-pr-ownership.test.js 单测覆盖。
set -uo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
API="$BRAIN/api/brain"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
DECISION_SCRIPT="$REPO_ROOT/.github/workflows/scripts/should-auto-merge.sh"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── pr-ownership 端点 ──"
# 1. 无参数 → 400（无有效判据）
code=$(curl -s -o /dev/null -w "%{http_code}" "$API/harness/pr-ownership")
[[ "$code" == "400" ]] && ok "无参数 → 400" || fail "无参数 → 期望 400，得 $code"

# 2. PR 号查询 → 200 + harness_owned 为布尔
body=$(curl -s "$API/harness/pr-ownership?pr=999999")
echo "$body" | jq -e 'has("harness_owned") and (.harness_owned | type == "boolean")' >/dev/null 2>&1 \
  && ok "?pr=999999 → 200 且 harness_owned 为布尔" \
  || fail "?pr=999999 → harness_owned 结构异常：$body"

# 3. cp-* 分支查询 → 200 + harness_owned 为布尔
body=$(curl -s "$API/harness/pr-ownership?branch=cp-08101107-04e4690d")
echo "$body" | jq -e 'has("harness_owned") and (.harness_owned | type == "boolean")' >/dev/null 2>&1 \
  && ok "?branch=cp-08101107-04e4690d → 200 且 harness_owned 为布尔" \
  || fail "?branch=... → harness_owned 结构异常：$body"

# 4. 已知非 harness 分支（空库形状）→ harness_owned=false（正确归属：不属于任何 harness run）
body=$(curl -s "$API/harness/pr-ownership?branch=cp-08081317-gate3-deploy-fix-cd7e0028")
echo "$body" | jq -e '.harness_owned == false' >/dev/null 2>&1 \
  && ok "非 harness 分支 → harness_owned=false" \
  || fail "非 harness 分支 → 期望 false，得：$body"

echo "── should-auto-merge.sh fail-closed 红线 ──"
# 5. Brain 不可达 → 决策脚本必须 SKIP（fail-closed），绝不输出 MERGE
if [ -f "$DECISION_SCRIPT" ]; then
  out=$(BRAIN_URL="http://127.0.0.1:1" AUTO_MERGE_BRAIN_TIMEOUT=2 \
    bash "$DECISION_SCRIPT" "cp-08101107-04e4690d" "4755" 2>&1)
  if echo "$out" | grep -q "SKIP" && ! echo "$out" | grep -qx "MERGE"; then
    ok "Brain 不可达 → SKIP（fail-closed，绝不 MERGE）"
  else
    fail "Brain 不可达 → 期望 SKIP，实际：$out"
  fi
else
  fail "找不到决策脚本 $DECISION_SCRIPT"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
