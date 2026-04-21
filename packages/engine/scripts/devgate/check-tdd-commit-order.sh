#!/usr/bin/env bash
# check-tdd-commit-order.sh — Harness v5 CI check
#
# 规则（仅对 harness PR）：
#   1. commit 1 只能 touch：sprints/*/tests/**/*.test.ts + DoD.md
#      禁含 packages/ apps/ 等实现目录
#   2. commit 2+ 必须包含实现代码（packages/ 或 apps/ 下的 *.{ts,js,cjs,mjs,sh}）
#   3. commit 1 之后，任何 commit 都不许修改 sprints/*/tests/**/*.test.ts
#   4. commit 1 message 必须含 "(Red)" 或 "test(" 开头
#   5. 至少一个 commit message 含 "(Green)" 或 "feat("
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
echo "  TDD Commit Order Check (v5.0)"
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

# ── Check 1: commit 1 只能 touch tests/ + DoD.md ─────────────────────
COMMIT_1=${COMMIT_ARR[0]}
COMMIT_1_MSG=$(git log -1 --format=%s "$COMMIT_1")
COMMIT_1_FILES=$(git show --name-only --format= "$COMMIT_1")

echo "Commit 1: $COMMIT_1"
echo "  message: $COMMIT_1_MSG"
echo "  files:"
echo "$COMMIT_1_FILES" | sed 's/^/    /'

BAD_FILES_C1=$(echo "$COMMIT_1_FILES" | grep -vE '^(sprints/[^/]+/tests/.*\.test\.ts|DoD\.md|sprints/[^/]+/contract-dod-ws[0-9]+\.md|)$' || true)
if [ -n "$BAD_FILES_C1" ]; then
  echo -e "  ${RED}❌ commit 1 含非测试/DoD 的文件（应只含 tests + DoD.md）：${RESET}"
  echo "$BAD_FILES_C1" | sed 's/^/      /'
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# ── Check 2: commit 1 message 含 (Red) 或 test( ──────────────────────
if ! echo "$COMMIT_1_MSG" | grep -qE '\(Red\)|^test\('; then
  echo -e "  ${RED}❌ commit 1 message 缺 (Red) 或 test( 前缀${RESET}"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

echo ""

# ── Check 3: commit 2+ 必须含实现 + 测试文件不许改 ─────────────────────
HAS_GREEN=0
IMPL_FOUND=0
for ((i = 1; i < COMMIT_COUNT; i++)); do
  C=${COMMIT_ARR[$i]}
  MSG=$(git log -1 --format=%s "$C")
  FILES=$(git show --name-only --format= "$C")

  echo "Commit $((i + 1)): $C"
  echo "  message: $MSG"

  # 检测是否含 (Green) 或 feat(
  if echo "$MSG" | grep -qE '\(Green\)|^feat\('; then
    HAS_GREEN=1
  fi

  # 检测本 commit 有无 touch sprints/*/tests/*.test.ts（不许）
  TEST_TOUCHED=$(echo "$FILES" | grep -E '^sprints/[^/]+/tests/.*\.test\.ts$' || true)
  if [ -n "$TEST_TOUCHED" ]; then
    echo -e "  ${RED}❌ commit 2+ 修改了测试文件（违反 CONTRACT IS LAW — 测试 Red 后不可改）：${RESET}"
    echo "$TEST_TOUCHED" | sed 's/^/      /'
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # 检测本 commit 有无实现代码
  IMPL_TOUCHED=$(echo "$FILES" | grep -E '^(packages|apps)/.+\.(ts|tsx|js|jsx|cjs|mjs|py|sh)$' || true)
  if [ -n "$IMPL_TOUCHED" ]; then
    IMPL_FOUND=1
  fi

  echo ""
done

# ── Check 4: commit 2+ 必须有一个 commit 含实现 ────────────────────────
if [ $IMPL_FOUND -eq 0 ] && [ $COMMIT_COUNT -gt 1 ]; then
  echo -e "${RED}❌ commit 2+ 未找到任何实现代码改动（packages/ 或 apps/）${RESET}"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# ── Check 5: 至少一个 commit 含 (Green) 或 feat( ──────────────────────
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
  echo "    commit 1: 只含 tests/ + DoD.md + contract-dod-ws，message 含 (Red)"
  echo "    commit 2+: 含实现代码，测试文件不许改，至少一个 message 含 (Green)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
