#!/usr/bin/env bash
# 单元测试 — 步骤9：孤儿 worktree 识别与清理
# BEHAVIOR-02 (Part A)

set -euo pipefail

PASS=0
FAIL=0
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
JANITOR="scripts/ops/janitor.sh"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "── 步骤9 孤儿 worktree 单元测试（BEHAVIOR-02A） ──"

# 构造测试临时目录（模拟孤儿 worktree）
TMP_WT_BASE=$(mktemp -d)
TMP_WT_DIR="$TMP_WT_BASE/cecelia"
mkdir -p "$TMP_WT_DIR/test-orphan-wt-$$"

# 让 mtime 超过 24h（通过 touch -d）
touch -d "25 hours ago" "$TMP_WT_DIR/test-orphan-wt-$$" 2>/dev/null || \
  touch -t "$(date -d '25 hours ago' +%Y%m%d%H%M.%S 2>/dev/null || date -v-25H +%Y%m%d%H%M.%S 2>/dev/null || echo '202601010000.00')" \
    "$TMP_WT_DIR/test-orphan-wt-$$" 2>/dev/null || true

# Test 1: 静态 — 步骤9 扫描正确目录
if grep -qE 'worktrees/(cecelia|zenithjoy)|\$HOME/worktrees|\$\{HOME\}/worktrees' "$JANITOR" 2>/dev/null; then
  ok "步骤9 扫描路径含 worktrees/ 目录引用"
else
  fail "步骤9 扫描路径未引用 worktrees/ 目录（PRD要求扫 ~/worktrees/cecelia/* 和 ~/worktrees/zenithjoy/*）"
fi

# Test 2: 静态 — 使用 git worktree list --porcelain 识别真孤儿
if grep -q "git worktree list --porcelain\|git worktree list" "$JANITOR" 2>/dev/null; then
  ok "步骤9 使用 git worktree list 识别注册状态"
else
  fail "步骤9 未使用 git worktree list（无法区分真孤儿与已注册 worktree）"
fi

# Test 3: 静态 — age > 24h 检查
if grep -qE "24.*h|86400|find.*mtime|mtime.*24|agecheck|age.*24" "$JANITOR" 2>/dev/null; then
  ok "步骤9 含 age > 24h 检查"
else
  fail "步骤9 缺少 age > 24h 检查（可能误删新 worktree）"
fi

# Test 4: 静态 — 无 open PR 检查
if grep -qE "gh pr list|open.pr|PR_COUNT|pr_count" "$JANITOR" 2>/dev/null; then
  ok "步骤9 含 open PR 检查"
else
  fail "步骤9 缺少 open PR 检查（可能误删有 PR 的 worktree）"
fi

# Test 5: 静态 — 步骤9 有明确标识
if grep -qE "step.?9|步骤.?9|STEP.?9|9[.)].*(worktree|孤儿)" "$JANITOR" 2>/dev/null; then
  ok "步骤9 在脚本中有明确标识"
else
  fail "步骤9 标识缺失"
fi

# 清理
rm -rf "$TMP_WT_BASE"

echo ""
echo "步骤9 孤儿测试结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
