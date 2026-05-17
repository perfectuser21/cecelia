#!/usr/bin/env bash
# lint-no-mock-only-test.sh — 拦"全 mock 测试"
#
# 4 agent 审计找出 brain 单测可信度 28/100 的核心症状：
# - 49 个 heavy mock 文件（vi.mock >= 10）
# - 平均每文件 5.28 mock
# - 即使有 expect / await 调用，全 mock 路径下 prod 行为完全无验证
# - PR #2660 dispatcher Phase 2.5 drain bug 就是 mock 全过 prod 真挂
#
# Tier 2 PR-A 的 lint-test-quality 拦了 stub（只 grep src 不调函数）和 .skip。
# 本 lint 补漏：拦"调函数但所有依赖全 mock"的 heavy-mock 测试，
# 强制配套真路径覆盖（smoke.sh 或 integration test）。
#
# 规则（仅作用于新增 test 文件，老的 grandfather）：
#
#   HARD FAIL: 新增 test 文件 vi.mock 数 ≥ HEAVY_MOCK_THRESHOLD (默认 30)
#              且 PR diff 中无配套真覆盖（任一）：
#                - 同 PR 加了 packages/brain/scripts/smoke/*.sh
#                - 同 PR 加了 src/__tests__/integration/*.test.js
#                - 文件本身在 /integration/ 路径下
#
# 用法：bash lint-no-mock-only-test.sh [BASE_REF]
# 环境变量：HEAVY_MOCK_THRESHOLD（默认 30）

set -euo pipefail

BASE_REF="${1:-origin/main}"
HEAVY_MOCK_THRESHOLD="${HEAVY_MOCK_THRESHOLD:-30}"
echo "🔍 lint-no-mock-only-test — base: $BASE_REF heavy_threshold: $HEAVY_MOCK_THRESHOLD"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# 新增 test 文件
NEW_TESTS=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E '\.(test|spec)\.(js|ts)$' \
  || true)

if [ -z "$NEW_TESTS" ]; then
  echo "⏭️  无新增 test 文件，跳过"
  exit 0
fi

# PR diff 中是否有 smoke.sh / integration test（任一即视为有真覆盖）
PR_HAS_SMOKE=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -cE '^packages/brain/scripts/smoke/.+\.sh$' || true)
PR_HAS_SMOKE="${PR_HAS_SMOKE:-0}"

PR_HAS_INTEGRATION=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -cE '/__tests__/integration/.*\.(test|spec)\.(js|ts)$' || true)
PR_HAS_INTEGRATION="${PR_HAS_INTEGRATION:-0}"

echo "  PR_HAS_SMOKE=$PR_HAS_SMOKE PR_HAS_INTEGRATION=$PR_HAS_INTEGRATION"

# 扫每个新增 test 的 mock 数
HEAVY_MOCK_FILES=()
while IFS= read -r tf; do
  [ -z "$tf" ] && continue
  [ ! -f "$tf" ] && continue

  # 文件本身在 /integration/ → 跳过（integration 真路径，重 mock 也 OK）
  if echo "$tf" | grep -qE '/integration/'; then
    continue
  fi

  MOCK_COUNT=$(grep -cE "vi\.mock\s*\(" "$tf" 2>/dev/null || true)
  MOCK_COUNT="${MOCK_COUNT:-0}"

  if [ "$MOCK_COUNT" -ge "$HEAVY_MOCK_THRESHOLD" ]; then
    HEAVY_MOCK_FILES+=("$tf  (vi.mock=$MOCK_COUNT)")
  fi
done <<< "$NEW_TESTS"

if [ "${#HEAVY_MOCK_FILES[@]}" -eq 0 ]; then
  echo "✅ lint-no-mock-only-test 通过（无 heavy-mock 新测试）"
  exit 0
fi

# Heavy mock 存在 — 检查是否有配套真覆盖
if [ "$PR_HAS_SMOKE" -gt 0 ] || [ "$PR_HAS_INTEGRATION" -gt 0 ]; then
  echo "✅ lint-no-mock-only-test 通过（heavy mock 但 PR 含真覆盖）："
  printf "  ⚠️  heavy mock: %s\n" "${HEAVY_MOCK_FILES[@]}"
  echo "  ✓ 配套：smoke.sh=$PR_HAS_SMOKE  integration=$PR_HAS_INTEGRATION"
  exit 0
fi

# Heavy mock + 无真覆盖 → fail
echo ""
echo "::error::lint-no-mock-only-test 失败 — heavy-mock 测试无配套真路径覆盖"
printf "  ❌ %s\n" "${HEAVY_MOCK_FILES[@]}"
echo ""
echo "  治"全 mock 测试通过 prod 真挂"风险（PR #2660 dispatcher Phase 2.5 教训）"
echo "  添加任一即可放行："
echo "    1. 同 PR 加 packages/brain/scripts/smoke/<feature>-smoke.sh（推荐）"
echo "    2. 同 PR 加 src/__tests__/integration/<name>.test.js"
echo "    3. 把 test 文件移到 /integration/ 子目录（标识为 integration test）"
echo "    4. 减少 vi.mock 数到 < $HEAVY_MOCK_THRESHOLD（重新设计依赖注入）"
exit 1
