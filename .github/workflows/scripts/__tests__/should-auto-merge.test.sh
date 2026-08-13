#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑（fail-closed 身份闸版本）。
#
# 背景（双通道竞态历史根因，别当多余代码删掉）：CI 通用 auto-merge 与 harness 自己的
# evaluator+DeepSeek 裁判 gate 是两条独立的 PR 合并通道。harness generator 产出的 PR 也用
# cp-* 分支命名，会触发同一个 ci.yml；通用通道只看「cp-* 分支 + CI 绿」就 squash merge，比
# 裁判 gate 快，会抢先合并、架空裁判裁决权。
#
# 事故根因（PR #4870）：旧脚本只识别精确 `feat(harness):` 标题，其余 cp-*（含手动 /dev 的
# fix(harness):/fix(brain): 等）无条件落入通用 MERGE，把 harness 的 evaluator+裁判 gate 架空。
# 本刀改为 entitlement 驱动 + 四态 fail-closed：
#   - 通用 cp-*（无受信 entitlement）默认 → SKIP
#   - Harness identity 缺失 / 写入延迟 / 陈旧 head_sha / Brain 不可达 → SKIP
#   - 仅受信通道签发且精确绑定 repo+PR+head_sha 的 entitlement → MERGE
#   - label / 标题不能单独授权 merge
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
AUTO_MERGE_JOB="$(awk '
  /^  auto-merge:/ { capture=1; next }
  capture && /^  [a-zA-Z0-9_-]+:/ { exit }
  capture { print }
' "$WORKFLOW")"
PASS=0; FAIL=0

# 建 curl 替身：按 MOCK_BRAIN_EXIT / MOCK_BRAIN_BODY 决定「Brain 不可达」或返回体。
# 只用 PATH 上的 curl 替身注入 Brain 的返回/不可达（模拟真实 HTTP 边界的对端），
# 判据逻辑本身不 mock，确定性且离线可跑。
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

# 2) 通用 cp-* 无 entitlement（entitled:false）→ SKIP（本刀核心）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="{\"entitled\":false}" \
  assert_decision "SKIP" "通用 cp-* 无 entitlement → 默认 SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 3) Brain 不可达（curl 非 0）→ SKIP（fail-closed）
MOCK_BRAIN_EXIT=7 MOCK_BRAIN_BODY="" \
  assert_decision "SKIP" "Brain 不可达 → fail-closed SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 4) 陈旧 head_sha（entitlement 绑定旧 sha）→ SKIP（force-push 后陈旧）
MOCK_BRAIN_EXIT=0 MOCK_BRAIN_BODY="{\"entitled\":true,\"trusted\":true,\"repo\":\"$REPO\",\"pr_number\":$PR,\"head_sha\":\"deadbeef\"}" \
  assert_decision "SKIP" "陈旧 head_sha 不匹配 → SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度" "$REPO" "$PR" "$SHA"

# 5) 不受信通道签发（trusted:false）→ SKIP（label/标题不能单独授权）
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

# 8) 缺 repo/pr/head_sha 绑定参数 → entitlement_unverifiable SKIP（fail-closed，不 fail-open）
assert_decision "SKIP" "缺绑定参数 → entitlement_unverifiable SKIP" \
  -- "cp-0813-abc" "fix(brain): 修复调度"

# ─── ci.yml 工作流结构守卫（沿用旧断言，不得回退）──────────────────────
# ci-passed 的依赖包含按路径跳过的 jobs。GitHub 会把 skip 沿 needs 链传播，
# 所以下游 auto-merge 必须显式使用 always()，再自行检查 ci-passed 的结果。
if grep -Fq "if: always() && needs.ci-passed.result == 'success' && github.event_name == 'pull_request'" "$WORKFLOW"; then
  echo "PASS: auto-merge 可越过 needs 链中的 skipped jobs"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 缺少 always()，会被 needs 链中的 skipped jobs 连带跳过"; FAIL=$((FAIL+1))
fi

# ci-passed 只覆盖本 workflow；Smoke Glob、CodeQL 等必需检查可能仍在运行。
# 必须启用 GitHub 原生 auto-merge 排队，不能用短重试赌其他 workflow 已结束。
if echo "$AUTO_MERGE_JOB" | grep -Fq 'gh pr merge "$PR_NUMBER" --auto --squash --delete-branch'; then
  echo "PASS: auto-merge 排队等待全部分支保护条件"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 未使用 --auto，会在其他 workflow 尚未完成时失败"; FAIL=$((FAIL+1))
fi

if echo "$AUTO_MERGE_JOB" | grep -Fq "contents: write" \
  && echo "$AUTO_MERGE_JOB" | grep -Fq "pull-requests: write"; then
  echo "PASS: auto-merge job 具备最小写权限"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge job 缺少启用原生 auto-merge 所需的写权限"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
