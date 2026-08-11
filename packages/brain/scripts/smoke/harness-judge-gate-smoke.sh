#!/usr/bin/env bash
# harness-judge-gate-smoke.sh — 合并权收归单一裁决闸 smoke 验证（#4755/#4759 修法）
# 验证四处接线在位：Brain 归属端点、通道 1 脚本改 Brain 求证、ci.yml 传 PR_NUMBER、
# kernel merge_pr 置 harness-judge status。静态检查（grep），无需真实环境。
set -euo pipefail

echo "[smoke] harness-judge 裁决闸接线验证..."

ROUTE_SRC="packages/brain/src/routes/harness.js"
SCRIPT_SRC=".github/workflows/scripts/should-auto-merge.sh"
CI_SRC=".github/workflows/ci.yml"
KERNEL_SRC="packages/brain/src/orchestrator/kernel-handlers.js"

# 1. Brain 归属端点已注册（凭 initiative_runs.pr_url 精确匹配）
if ! grep -q "'/pr-ownership'" "$ROUTE_SRC" && ! grep -q '/pr-ownership' "$ROUTE_SRC"; then
  echo "❌ $ROUTE_SRC 未注册 /pr-ownership 归属端点"
  exit 1
fi
if ! grep -q 'initiative_runs' "$ROUTE_SRC" || ! grep -q "/pull/" "$ROUTE_SRC"; then
  echo "❌ $ROUTE_SRC 归属端点未按 initiative_runs.pr_url（/pull/<n>）精确匹配"
  exit 1
fi

# 2. 通道 1 脚本改向 Brain 求证（curl pr-ownership）+ --max-time 超时 + fail-closed
if ! grep -q 'pr-ownership' "$SCRIPT_SRC" || ! grep -q -- '--max-time' "$SCRIPT_SRC"; then
  echo "❌ $SCRIPT_SRC 未向 Brain 求证归属（pr-ownership + --max-time）"
  exit 1
fi
if ! grep -q 'fail-closed' "$SCRIPT_SRC"; then
  echo "❌ $SCRIPT_SRC 缺 fail-closed 语义（Brain 不可达须 SKIP）"
  exit 1
fi

# 3. ci.yml auto-merge step 以 $PR_NUMBER（非 $PR_TITLE）调脚本
if ! grep -Fq 'should-auto-merge.sh "$HEAD_BRANCH" "$PR_NUMBER"' "$CI_SRC"; then
  echo "❌ $CI_SRC auto-merge step 未以 \$PR_NUMBER 调脚本"
  exit 1
fi

# 4. kernel merge_pr 合并前置 harness-judge status
if ! grep -q 'harness-judge' "$KERNEL_SRC" || ! grep -q 'statuses' "$KERNEL_SRC"; then
  echo "❌ $KERNEL_SRC merge_pr 未置 harness-judge status（statuses state=success）"
  exit 1
fi

echo "✅ harness-judge 裁决闸 smoke 通过（归属端点 + 脚本求证 + ci PR_NUMBER + kernel 置闸）"
