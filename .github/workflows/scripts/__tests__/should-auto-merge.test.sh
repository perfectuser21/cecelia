#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑。
# 背景：CI 通用 auto-merge 与 harness 自己的 evaluator+DeepSeek 裁判 gate 是两条
# 独立的 PR 合并通道。harness generator 产出的 PR 也用 cp-* 分支命名，会触发同一个
# ci.yml；通用通道只看「cp-* 分支 + CI 绿」就 squash merge，比裁判 gate 快，会抢先
# 合并、架空裁判裁决权。此脚本把「该不该由通用 auto-merge 合并」的判据抽出来单独测。
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
AUTO_VERSION_WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/auto-version.yml"
CLEANUP_WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/cleanup-merged-artifacts.yml"
AUTO_MERGE_JOB="$(awk '
  /^  auto-merge:/ { capture=1; next }
  capture && /^  [a-zA-Z0-9_-]+:/ { exit }
  capture { print }
' "$WORKFLOW")"
PASS=0; FAIL=0

# assert_decision <期望关键词> <描述> <head_branch> <pr_title>
assert_decision() {
  local expect="$1" desc="$2" branch="$3" title="$4"
  local out
  out="$(bash "$SCRIPT" "$branch" "$title" 2>&1)"
  if echo "$out" | grep -q "$expect"; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望含 '$expect'，实际: $out)"; FAIL=$((FAIL+1))
  fi
}

# harness generator 产出的 PR（标题 feat(harness): 前缀）→ 跳过通用 auto-merge，
# 交给 harness 自己的 gate。这是本次 bug 修复的核心断言。
assert_decision "SKIP" "harness PR（feat(harness):）→ 跳过 auto-merge" \
  "cp-0704084753-abc" "feat(harness): 抖音发布 skeleton"

# Phase 0 fail-closed：在统一的 SHA-bound merge authorization receipt 上线前，
# 标题、分支和 PR body 都不是可信授权。所有 cp-* 都必须停在显式 merge gate。
assert_decision "SKIP" "普通 fix(brain) PR → 无授权 receipt 时不得 auto-merge" \
  "cp-0704084753-abc" "fix(brain): 修复调度队头阻塞"

# 改标题不能把 Kernel/Harness PR 洗成普通 PR。
assert_decision "SKIP" "标题漂移不能绕过 merge gate" \
  "cp-0704084753-abc" "fix(ci): auto-merge 跳过 harness PR"

# 普通 feat 也先 fail-closed，后续只能由统一风险策略签发 SHA-bound receipt 解锁。
assert_decision "SKIP" "普通 feat(dashboard) PR → 无授权 receipt 时不得 auto-merge" \
  "cp-0704084753-abc" "feat(dashboard): 新增设备页字段"

# 非 cp-* 分支 → 跳过（保留原有行为，stop hook 删除后统一由 cp-* 判据处理）。
assert_decision "SKIP" "非 cp-* 分支 → 跳过 auto-merge" \
  "feature/manual-branch" "fix(brain): 随便改"

# ci-passed 的依赖包含按路径跳过的 jobs。GitHub 会把 skip 沿 needs 链传播，
# 所以下游 auto-merge 必须显式使用 always()，再自行检查 ci-passed 的结果。
if grep -Fq "if: always() && needs.ci-passed.result == 'success' && github.event_name == 'pull_request'" "$WORKFLOW"; then
  echo "PASS: auto-merge 可越过 needs 链中的 skipped jobs"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 缺少 always()，会被 needs 链中的 skipped jobs 连带跳过"; FAIL=$((FAIL+1))
fi

# 此兼容 job 只能观察 eligibility，不能保留任何 merge effect。
if ! echo "$AUTO_MERGE_JOB" | grep -Eq '^[[:space:]]*gh pr merge ' \
  && echo "$AUTO_MERGE_JOB" | grep -Fq 'Kernel-only'; then
  echo "PASS: auto-merge job 已撤销 merge effect"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge job 仍可执行 merge effect"; FAIL=$((FAIL+1))
fi

if echo "$AUTO_MERGE_JOB" | grep -Fq "contents: read" \
  && echo "$AUTO_MERGE_JOB" | grep -Fq "pull-requests: read" \
  && ! echo "$AUTO_MERGE_JOB" | grep -Fq "contents: write" \
  && ! echo "$AUTO_MERGE_JOB" | grep -Fq "pull-requests: write"; then
  echo "PASS: auto-merge 兼容 job 只保留只读权限"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 兼容 job 仍持有写权限"; FAIL=$((FAIL+1))
fi

# 聚合门必须只把 success / 显式允许的 skipped 当绿；cancelled、timed_out、
# action_required、空值和未来新增状态一律 fail-closed。
if grep -Fq 'case "$r" in' "$WORKFLOW" \
  && grep -Fq 'success)' "$WORKFLOW" \
  && grep -Fq 'skipped)' "$WORKFLOW" \
  && grep -Fq '*) echo "❌ $n ($r)"; FAILED=true ;;' "$WORKFLOW"; then
  echo "PASS: ci-passed 对非 success/skipped 状态 fail-closed"; PASS=$((PASS+1))
else
  echo "FAIL: ci-passed 仍可能把 cancelled/timed_out/unknown 当绿"; FAIL=$((FAIL+1))
fi

# Scheduled/bot automation also lacks a Kernel merge receipt. It may open only
# draft PRs and must not request auto-merge independently.
for workflow in "$AUTO_VERSION_WORKFLOW" "$CLEANUP_WORKFLOW"; do
  if grep -Fq -- '--draft' "$workflow" && ! grep -Eq '^[[:space:]]*gh pr merge ' "$workflow"; then
    echo "PASS: $(basename "$workflow") 只开 draft，不自授 merge"; PASS=$((PASS+1))
  else
    echo "FAIL: $(basename "$workflow") 仍可绕过 Kernel merge authorization"; FAIL=$((FAIL+1))
  fi
done

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
