#!/usr/bin/env bash
# RED-A 永久回归 — should-auto-merge.sh 通用 auto-merge 身份闸 fail-closed。
#
# 事故根因（PR #4870）：should-auto-merge.sh 只识别精确 `feat(harness):` 标题，其余
#   cp-*（含手动 /dev 的 fix(harness):/fix(brain): 等）无条件落入通用 MERGE，把 harness
#   的 evaluator+裁判 gate 架空。本刀改为 entitlement 驱动 + 四态 fail-closed：
#     - 通用 cp-*（无受信 entitlement）默认 → SKIP
#     - Harness identity 缺失 / 写入延迟 / 陈旧 head_sha / Brain 不可达 → SKIP
#     - 仅受信通道签发且精确绑定 repo+PR+head_sha 的 entitlement → MERGE
#     - label / 标题不能单独授权 merge
#
# 契约（Generator 实现）：
#   should-auto-merge.sh <head_branch> <pr_title> [repo] [pr_number] [head_sha]
#   非 cp-* → SKIP；feat(harness): → SKIP（交 harness gate）；其余 cp-* 必须查
#   ${BRAIN_BASE_URL:-http://localhost:5221}/api/brain/harness/merge-entitlement
#   （curl -fsS -m ${BRAIN_TIMEOUT:-5}），按 entitled/trusted/repo/pr_number/head_sha 判定。
#
# 禁 mock 边：被改的是「脚本 ↔ Brain entitlement 查询」这条真实边——本测试不 mock 该判据
#   逻辑，只用 PATH 上的 curl 替身注入 Brain 的返回/不可达（模拟真实 HTTP 边界的对端），
#   确定性且离线可跑。
#
# 永久落位（Generator 实现时迁入/更新）：
#   .github/workflows/scripts/__tests__/should-auto-merge.test.sh
#   （并更新旧「cp-* + fix → MERGE」用例：那些用例编码的正是本刀要修的 fail-open 行为，
#    需改为带受信 entitlement 才 MERGE。）
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/../../.." && pwd)/.github/workflows/scripts/should-auto-merge.sh"
PASS=0; FAIL=0

# 建 curl 替身：按 MOCK_BRAIN_EXIT / MOCK_BRAIN_BODY 决定「Brain 不可达」或返回体。
SHIM_DIR="$(mktemp -d)"
trap 'rm -rf "$SHIM_DIR"' EXIT
cat > "$SHIM_DIR/curl" <<'SHIM'
#!/usr/bin/env bash
if [ "${MOCK_BRAIN_EXIT:-0}" != "0" ]; then exit "${MOCK_BRAIN_EXIT}"; fi
printf '%s' "${MOCK_BRAIN_BODY:-}"
exit 0
SHIM
chmod +x "$SHIM_DIR/curl"

# assert_decision <期望关键词> <描述> -- <传给脚本的参数...>
assert_decision() {
  local expect="$1" desc="$2"; shift 2; shift  # 丢弃 '--'
  local out
  out="$(PATH="$SHIM_DIR:$PATH" bash "$SCRIPT" "$@" 2>&1)"
  # 精确区分 MERGE 与 SKIP：SKIP 断言时必须确保输出不是纯 MERGE 决定
  if [ "$expect" = "MERGE" ]; then
    if printf '%s' "$out" | grep -qx "MERGE"; then
      echo "PASS: $desc"; PASS=$((PASS+1)); return
    fi
  else
    if printf '%s' "$out" | grep -q "SKIP" && ! printf '%s' "$out" | grep -qx "MERGE"; then
      echo "PASS: $desc"; PASS=$((PASS+1)); return
    fi
  fi
  echo "FAIL: $desc (期望 '$expect'，实际: $out)"; FAIL=$((FAIL+1))
}

REPO="perfectuser21/cecelia"; PR="4870"; SHA="0a6ed21c"
ENT_OK="{\"entitled\":true,\"trusted\":true,\"repo\":\"$REPO\",\"pr_number\":$PR,\"head_sha\":\"$SHA\"}"

# 1) 受信 + 精确绑定 → MERGE（合法 /dev 放行，guard）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="$ENT_OK" \
  assert_decision "MERGE" "受信 entitlement 精确绑定 repo+PR+head_sha → MERGE" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 2) 通用 cp-* 无 entitlement（entitled:false）→ SKIP（本刀核心；当前 fail-open 输出 MERGE → RED）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="{\"entitled\":false}" \
  assert_decision "SKIP" "通用 cp-* 无 entitlement → 默认 SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 3) Brain 不可达（curl 非 0）→ SKIP（fail-closed，当前 fail-open → RED）
MOCK_BRAIN_EXIT=7 MOCK_BRAIN_BODY="" \
  assert_decision "SKIP" "Brain 不可达 → fail-closed SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 4) 陈旧 head_sha（entitlement 绑定旧 sha）→ SKIP（force-push 后陈旧，当前 → RED）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="{\"entitled\":true,\"trusted\":true,\"repo\":\"$REPO\",\"pr_number\":$PR,\"head_sha\":\"deadbeef\"}" \
  assert_decision "SKIP" "陈旧 head_sha 不匹配 → SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 5) 不受信通道签发（trusted:false）→ SKIP（label/标题不能单独授权，当前 → RED）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="{\"entitled\":true,\"trusted\":false,\"repo\":\"$REPO\",\"pr_number\":$PR,\"head_sha\":\"$SHA\"}" \
  assert_decision "SKIP" "不受信通道签发 → SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 6) harness-owned PR（feat(harness):）→ SKIP（交 harness gate，旧标题保护，guard）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="$ENT_OK" \
  assert_decision "SKIP" "feat(harness): → 跳过通用 auto-merge" \
  -- "cp-0813-abc" "feat(harness): merge authority 修复" "$REPO" "$PR" "$SHA"

# 7) 非 cp-* 分支 → SKIP（guard）
assert_decision "SKIP" "非 cp-* 分支 → SKIP" \
  -- "feature/manual" "fix(brain): 随便改" "$REPO" "$PR" "$SHA"

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
