#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑。
# 背景：CI 通用 auto-merge 与 harness 自己的 evaluator+DeepSeek 裁判 gate 是两条
# 独立的 PR 合并通道。harness generator 产出的 PR 也用 cp-* 分支命名，会触发同一个
# ci.yml；通用通道只看「cp-* 分支 + CI 绿」就 squash merge，比裁判 gate 快，会抢先
# 合并、架空裁判裁决权。此脚本把「该不该由通用 auto-merge 合并」的判据抽出来单独测。
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
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

# 普通手动 /dev 的 fix 类 PR → 正常走 auto-merge（不能误伤 /dev 流程，关键）。
assert_decision "MERGE" "普通 fix(brain) PR → 正常 auto-merge" \
  "cp-0704084753-abc" "fix(brain): 修复调度队头阻塞"

# 手动 /dev 的 fix(ci) PR（就是本次这个 PR 的类型）→ 正常走 auto-merge。
assert_decision "MERGE" "fix(ci) PR → 正常 auto-merge" \
  "cp-0704084753-abc" "fix(ci): auto-merge 跳过 harness PR"

# feat 类但非 harness 的手动 PR → 正常走 auto-merge（只拦 feat(harness): 精确前缀）。
assert_decision "MERGE" "普通 feat(dashboard) PR → 正常 auto-merge" \
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

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
