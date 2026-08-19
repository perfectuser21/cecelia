#!/usr/bin/env bash
# lint-gp-anchor-artifact.sh — GP 锚「产物闸」（决策 109dd8eb ①）
#
# 为什么有这道闸（2026-08-19 实证）：
#   gp_anchor 早就是硬闸（branch-protect v31），但它卡的是**字段**——当天 20 个 PR 全以
#   none(infra) 放行。卡字段的闸必被最便宜的合法值满足。真正要保证的是：
#   流水线代码的修复守卫落在 Golden Path 的「边」上，用真零件跑——
#   publisher「发布后释放候选工作区」与 generator-fix「需要候选工作区」各自单测全绿
#   （邻居都被 mock 掉），边上的矛盾 workspace_source_attempt_unavailable 只能靠人撞。
#
# 规则（PR 触碰流水线路径时）：
#   1. 必须同时包含 tests/gp/<journey>/step<N>-<slug>.test.* 的新增/修改
#   2. 该步骤断言文件必须真 import 至少一个被改的流水线模块（守卫在边上，不在别处）
#   3. 该步骤断言文件不得 vi.mock / jest.mock 任何被改的流水线模块（不许把边 mock 掉）
#   仅改流水线路径下的 test 文件 / 未触碰流水线路径 → 跳过
#
# 逃生口：无。流水线路径不接受 none(infra)。文档/配置类改动本身不命中流水线路径。
#
# 使用：bash lint-gp-anchor-artifact.sh [BASE_REF]   退出码 0=通过/跳过 1=失败
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "🔍 lint-gp-anchor-artifact — base: $BASE_REF"

# 流水线路径（kernel harness 2.0 的执行面）
PIPELINE_RE='^(packages/brain/src/orchestrator/|packages/brain/src/routes/harness-|packages/brain/src/harness-|docker/|packages/brain/scripts/fleet-worker/)'
TEST_FILE_RE='(\.(test|spec)\.(c|m)?[jt]sx?$|/__tests__/|/tests/)'
STEP_TEST_RE='^tests/gp/[a-z0-9_-]+/step[0-9]+-[a-z0-9_-]+\.test\.(c|m)?[jt]sx?$'

# base 可能是远端引用或裸 sha，两种都兼容
if git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  BASE="$BASE_REF"
else
  git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true
  BASE="$BASE_REF"
fi

CHANGED_ALL=$(git diff --name-only --diff-filter=AMR "${BASE}...HEAD" 2>/dev/null || git diff --name-only --diff-filter=AMR "${BASE}" HEAD)
PIPELINE_CHANGED=$(echo "$CHANGED_ALL" | grep -E "$PIPELINE_RE" | grep -vE "$TEST_FILE_RE" || true)

if [ -z "$PIPELINE_CHANGED" ]; then
  echo "⏭️  未触碰流水线路径，跳过"
  exit 0
fi

echo "流水线改动："
echo "$PIPELINE_CHANGED" | sed 's/^/  - /'

STEP_TESTS=$(echo "$CHANGED_ALL" | grep -E "$STEP_TEST_RE" || true)
if [ -z "$STEP_TESTS" ]; then
  echo "::error::lint-gp-anchor-artifact 失败 — 触碰流水线路径但未带 GP 步骤断言文件"
  echo "  规则（决策 109dd8eb）：流水线修复的守卫必须落在 Golden Path 步骤上，不接受 none(infra)。"
  echo "  需新增/修改：tests/gp/<journey>/step<N>-<slug>.test.js（journey 目前=f1，工厂·开发闭环）"
  echo "  F1 五步：1 接单进车间即分档 / 2 合同即法律 / 3 造完真验 / 4 交付有回执 / 5 kernel-contract-a20"
  echo "  要求：该测试真 import 被改模块（守卫在边上），且不得 vi.mock 被改模块。"
  exit 1
fi

# 被改模块的 basename（不带扩展名），用于匹配 import / mock
declare -a MOD_BASES=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  b=$(basename "$f"); b="${b%.*}"
  MOD_BASES+=("$b")
done <<< "$PIPELINE_CHANGED"

FAIL=0
ANY_EDGE=0
while IFS= read -r t; do
  [ -z "$t" ] && continue
  [ -f "$t" ] || continue
  echo "步骤断言：$t"
  IMPORTS_CHANGED=0
  for b in "${MOD_BASES[@]}"; do
    # 被 mock → 拦
    if grep -nE "(vi|jest)\.mock\([[:space:]]*['\"][^'\"]*${b}(\.[cm]?[jt]sx?)?['\"]" "$t" >/dev/null 2>&1; then
      echo "::error::  $t 对被改模块 ${b} 做了 vi.mock/jest.mock —— 守卫必须用真零件跑，不许把边 mock 掉"
      FAIL=1
    fi
    # 真 import / require → 记为"在边上"
    if grep -nE "(from[[:space:]]+['\"][^'\"]*${b}(\.[cm]?[jt]sx?)?['\"]|require\([[:space:]]*['\"][^'\"]*${b}(\.[cm]?[jt]sx?)?['\"]|import\([[:space:]]*['\"][^'\"]*${b}(\.[cm]?[jt]sx?)?['\"])" "$t" >/dev/null 2>&1; then
      IMPORTS_CHANGED=1
    fi
  done
  if [ "$IMPORTS_CHANGED" -eq 1 ]; then
    ANY_EDGE=1
    echo "  ✅ 真 import 了被改模块"
  else
    echo "  ⚠️  未 import 任何被改模块：${MOD_BASES[*]}"
  fi
done <<< "$STEP_TESTS"

if [ "$ANY_EDGE" -eq 0 ]; then
  echo "::error::lint-gp-anchor-artifact 失败 — 步骤断言文件没有 import 任何被改的流水线模块（守卫不在这条边上）"
  echo "  被改模块：${MOD_BASES[*]}"
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then exit 1; fi
echo "✅ lint-gp-anchor-artifact 通过：流水线改动带 GP 步骤断言，且守卫落在真实的边上"
exit 0
