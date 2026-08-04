#!/usr/bin/env bash
# doc-zombie-retired.test.sh
# 断言：僵尸文档已彻底退役（刀0.5 任务 35cb771b）
# TDD Red 阶段：全部断言应当失败，直到实施完成

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PASS=0
FAIL=0
ERRORS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

assert_not_exists() {
  local path="$1"
  if [[ -e "$REPO_ROOT/$path" ]]; then
    echo -e "${RED}[FAIL]${NC} 断言1: 文件仍存在（应已退役）: $path"
    ERRORS+=("断言1: 文件仍存在: $path")
    FAIL=$((FAIL + 1))
  else
    echo -e "${GREEN}[PASS]${NC} 断言1: 文件不存在（已退役）: $path"
    PASS=$((PASS + 1))
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="${3:-$pattern}"
  if grep -qF "$pattern" "$REPO_ROOT/$file" 2>/dev/null; then
    echo -e "${RED}[FAIL]${NC} 断言: 文件 $file 仍含「$label」"
    ERRORS+=("文件 $file 仍含「$label」")
    FAIL=$((FAIL + 1))
  else
    echo -e "${GREEN}[PASS]${NC} 断言: 文件 $file 不含「$label」"
    PASS=$((PASS + 1))
  fi
}

echo "========================================"
echo " doc-zombie-retired 完整性断言（5条）"
echo "========================================"
echo ""

# ── 断言 1：.agent-knowledge/ 下不存在退役文件 ──────────────────────────
echo "[断言1] .agent-knowledge/ 下不存在 skills-index.md 与 CURRENT_STATE.md"
assert_not_exists ".agent-knowledge/skills-index.md"
assert_not_exists ".agent-knowledge/CURRENT_STATE.md"
echo ""

# ── 断言 2：.claude/CLAUDE.md 不含退役 @import 行 ───────────────────────
echo "[断言2] .claude/CLAUDE.md 不含退役 @import 行"
assert_not_contains ".claude/CLAUDE.md" "@.agent-knowledge/skills-index.md"
assert_not_contains ".claude/CLAUDE.md" "@.agent-knowledge/CURRENT_STATE.md"
echo ""

# ── 断言 3：docs/current/README.md 不含 PATROL-REGISTRY 字样 ────────────
echo "[断言3] docs/current/README.md 不含 PATROL-REGISTRY 字样"
assert_not_contains "docs/current/README.md" "PATROL-REGISTRY"
echo ""

# ── 断言 4：全仓（排除 docs/archive/ 与本测试自身）无 write-current-state 引用 ──
echo "[断言4] 全仓（排除 docs/archive/ 与本测试）无 write-current-state 引用"
GREP_RESULT=$(grep -r "write-current-state" \
  --exclude-dir=".git" \
  --exclude="doc-zombie-retired.test.sh" \
  "$REPO_ROOT" 2>/dev/null \
  | grep -v "^$REPO_ROOT/docs/archive/" \
  | grep -v "^$REPO_ROOT/sprints/" \
  | grep -v "^$REPO_ROOT/docs/designs/" \
  | grep -v "^$REPO_ROOT/docs/instruction-book/" \
  | grep -v "^$REPO_ROOT/docs/learnings/" \
  | grep -v "^$REPO_ROOT/docs/superpowers/" \
  | grep -v "^$REPO_ROOT/tests/test-pyramid-guard.test.ts" \
  || true)
if [[ -n "$GREP_RESULT" ]]; then
  echo -e "${RED}[FAIL]${NC} 断言4: 仍有 write-current-state 引用（archive 外）："
  echo "$GREP_RESULT" | head -20
  ERRORS+=("断言4: archive 外仍有 write-current-state 引用")
  FAIL=$((FAIL + 1))
else
  echo -e "${GREEN}[PASS]${NC} 断言4: archive 外无 write-current-state 引用"
  PASS=$((PASS + 1))
fi
echo ""

# ── 断言 5：AGENTS.md 不含已取缔内容 ────────────────────────────────────
echo "[断言5] AGENTS.md 不含已取缔内容"
assert_not_contains "AGENTS.md" "38.23.47.81:9998"
assert_not_contains "AGENTS.md" "最后更新：2026-03-16"
echo ""

# ── 汇总 ────────────────────────────────────────────────────────────────
echo "========================================"
echo " 结果：PASS=$PASS  FAIL=$FAIL"
echo "========================================"
if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "失败项："
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  exit 1
fi
exit 0
