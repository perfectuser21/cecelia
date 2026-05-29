#!/usr/bin/env bash
# check-tdd-commit-order.sh — Harness v5 CI check
#
# 规则（仅对 harness PR）：
#   1. Red commit（message 含 (Red) 或 test( 开头）只能 touch：
#      sprints/*/tests/**/*.test.ts + DoD.md + sprints/*/contract-dod-ws*.md
#      禁含 packages/ apps/ 等实现目录
#      注意：Red commit 之前的 "import contract" 预提交（chore(harness)）
#      允许含任何 sprints/ 文件（sprint-prd.md/task-plan.json/contract-draft.md）
#   2. Red commit 之后的 commit 必须包含实现代码（packages/ 或 apps/ 下的 *.{ts,js,cjs,mjs,sh,sql}）
#   3. Red commit 之后，任何 commit 都不许修改 sprints/*/tests/**/*.test.ts
#   4. 至少一个 commit message 含 "(Green)" 或 "feat("
#
# 跳过条件：
#   - PR diff 里没有 sprints/*/tests/**/*.test.ts 改动（非 harness 产出的普通 PR）
#
# 用法：
#   bash check-tdd-commit-order.sh
#
# 环境：
#   BASE_REF — 比较基点，默认 origin/main
#   HEAD_REF — PR 顶端，默认 HEAD

set -euo pipefail

RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
RESET="\033[0m"

BASE="${BASE_REF:-origin/main}"
HEAD="${HEAD_REF:-HEAD}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TDD Commit Order Check (v5.1)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  base: ${BASE}"
echo "  head: ${HEAD}"
echo ""

# 列出 PR commits（按时间顺序，旧 → 新）
COMMITS=$(git log --reverse --format=%H "${BASE}..${HEAD}" 2>/dev/null || echo "")
if [ -z "$COMMITS" ]; then
  echo -e "${YELLOW}ℹ️  无 PR commit，跳过${RESET}"
  exit 0
fi

# 判断这是不是 harness PR：看 PR 里有没有 sprints/*/tests/**/*.test.ts 改动
HARNESS_TEST_CHANGES=$(git diff --name-only "${BASE}...${HEAD}" | grep -E '^sprints/[^/]+/tests/.*\.test\.ts$' || true)
if [ -z "$HARNESS_TEST_CHANGES" ]; then
  echo -e "${YELLOW}ℹ️  无 sprints/*/tests/*.test.ts 改动，非 harness PR，跳过${RESET}"
  exit 0
fi

echo "📋 PR 含 harness 测试改动，执行 TDD commit 顺序检查"
echo ""

COMMIT_ARR=($COMMITS)
COMMIT_COUNT=${#COMMIT_ARR[@]}
VIOLATIONS=0

# ── 查找第一个 Red commit（含 (Red) 或 test( 前缀）────────────────────────
# 允许在 Red commit 之前存在 "import contract" 预提交（chore(harness): import contract）
# 这些预提交被允许含任何 sprints/ 文件
RED_IDX=-1
for ((i = 0; i < COMMIT_COUNT; i++)); do
  MSG=$(git log -1 --format=%s "${COMMIT_ARR[$i]}")
  if echo "$MSG" | grep -qE '\(Red\)|^test\('; then
    RED_IDX=$i
    break
  fi
done

# 打印所有 commits 供调试
for ((i = 0; i < COMMIT_COUNT; i++)); do
  C=${COMMIT_ARR[$i]}
  MSG=$(git log -1 --format=%s "$C")
  FILES=$(git show --name-only --format= "$C")
  echo "Commit $((i + 1)): $C"
  echo "  message: $MSG"
  echo "  files:"
  echo "$FILES" | sed 's/^/    /'
  echo ""
done

if [ $RED_IDX -eq -1 ]; then
  echo -e "${RED}❌ 没有找到 Red commit（含 (Red) 或 test( 前缀的 commit）${RESET}"
  VIOLATIONS=$((VIOLATIONS + 1))
  # Fallback: use first commit as Red commit
  RED_IDX=0
fi

# ── Check 1: Red commit 只能 touch tests/ + DoD.md + contract-dod-ws ────
RED_COMMIT=${COMMIT_ARR[$RED_IDX]}
RED_COMMIT_MSG=$(git log -1 --format=%s "$RED_COMMIT")
RED_COMMIT_FILES=$(git show --name-only --format= "$RED_COMMIT")

echo "🔴 Red commit detected at position $((RED_IDX + 1)): $RED_COMMIT"
echo "  message: $RED_COMMIT_MSG"

BAD_FILES_RED=$(echo "$RED_COMMIT_FILES" | grep -vE '^(sprints/[^/]+/tests/.*\.test\.ts|DoD\.md|sprints/[^/]+/contract-dod-ws[0-9]+\.md|)$' || true)
if [ -n "$BAD_FILES_RED" ]; then
  echo -e "  ${RED}❌ Red commit 含非测试/DoD 的文件（应只含 tests + DoD.md）：${RESET}"
  echo "$BAD_FILES_RED" | sed 's/^/      /'
  VIOLATIONS=$((VIOLATIONS + 1))
fi

echo ""

# ── Check 2: Red commit 之后不许修改测试文件，必须含实现 ─────────────────
HAS_GREEN=0
IMPL_FOUND=0
for ((i = RED_IDX + 1; i < COMMIT_COUNT; i++)); do
  C=${COMMIT_ARR[$i]}
  MSG=$(git log -1 --format=%s "$C")
  FILES=$(git show --name-only --format= "$C")

  # 检测是否含 (Green) 或 feat(
  if echo "$MSG" | grep -qE '\(Green\)|^feat\('; then
    HAS_GREEN=1
  fi

  # 检测本 commit 有无 touch sprints/*/tests/*.test.ts（不许）
  TEST_TOUCHED=$(echo "$FILES" | grep -E '^sprints/[^/]+/tests/.*\.test\.ts$' || true)
  if [ -n "$TEST_TOUCHED" ]; then
    echo -e "  ${RED}❌ commit $((i + 1)) 修改了测试文件（违反 CONTRACT IS LAW — 测试 Red 后不可改）：${RESET}"
    echo "$TEST_TOUCHED" | sed 's/^/      /'
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # 检测本 commit 有无实现代码（包含 .sql 迁移文件）
  # sprints/*.sh 也算实现（harness 任务可交付 sprint 脚本而非 packages/ 代码）
  IMPL_TOUCHED=$(echo "$FILES" | grep -E '^(packages|apps|sprints)/.+\.(ts|tsx|js|jsx|cjs|mjs|py|sh|sql)$' || true)
  if [ -n "$IMPL_TOUCHED" ]; then
    IMPL_FOUND=1
  fi
done

# ── Check 3: Red commit 之后必须有一个 commit 含实现 ───────────────────────
if [ $IMPL_FOUND -eq 0 ] && [ "$RED_IDX" -lt "$((COMMIT_COUNT - 1))" ]; then
  echo -e "${RED}❌ Red commit 之后未找到实现代码（packages/ 或 apps/ 或 sprints/*.{sh,sql}）${RESET}"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# ── Check 4: 至少一个 commit 含 (Green) 或 feat( ──────────────────────────
if [ $HAS_GREEN -eq 0 ] && [ $COMMIT_COUNT -gt 1 ]; then
  echo -e "${RED}❌ 没有 commit message 含 (Green) 或 feat( 前缀${RESET}"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $VIOLATIONS -eq 0 ]; then
  echo -e "${GREEN}✅ TDD Commit Order 检查通过${RESET} ($COMMIT_COUNT 个 commit)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo -e "${RED}❌ TDD Commit Order 检查失败${RESET} ($VIOLATIONS 处违规)"
  echo ""
  echo "  TDD 规则："
  echo "    Red commit: 只含 tests/ + DoD.md + contract-dod-ws，message 含 (Red)"
  echo "    Red 之后: 含实现代码，测试文件不许改，至少一个 message 含 (Green)"
  echo "    允许 Red 前有 chore(harness): import contract 预提交（可含 sprint-prd 等）"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
