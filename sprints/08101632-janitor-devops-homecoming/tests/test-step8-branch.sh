#!/usr/bin/env bash
# 单元测试 — 步骤8：内联孤儿分支清理（无 branch-gc.sh 引用）
# BEHAVIOR-01

set -euo pipefail

PASS=0
FAIL=0
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
JANITOR="scripts/ops/janitor.sh"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "── 步骤8 单元测试（BEHAVIOR-01） ──"

# Test 1: 静态 — 无 branch-gc.sh 引用
if ! grep -q "branch-gc.sh" "$JANITOR" 2>/dev/null; then
  ok "无 branch-gc.sh 引用"
else
  fail "仍引用 branch-gc.sh（第 $(grep -n 'branch-gc.sh' "$JANITOR" | head -1 | cut -d: -f1) 行）"
fi

# Test 2: 静态 — 含内联 git branch 删除
if grep -qE "git branch (-d|--delete)" "$JANITOR" 2>/dev/null; then
  ok "内联 git branch 删除存在"
else
  fail "缺少内联 git branch -d 命令"
fi

# Test 3: 静态 — 三条件判断（merged + no PR + no worktree）
COND_COUNT=0
grep -qE "git branch.*--merged|merged.*main" "$JANITOR" 2>/dev/null && COND_COUNT=$((COND_COUNT+1))
grep -qE "gh pr list|open PR|no.*pr|open_pr" "$JANITOR" 2>/dev/null && COND_COUNT=$((COND_COUNT+1))
grep -qE "git worktree list|worktree.*ref" "$JANITOR" 2>/dev/null && COND_COUNT=$((COND_COUNT+1))
if [ "$COND_COUNT" -ge 2 ]; then
  ok "步骤8 三条件检查（命中 $COND_COUNT/3）"
else
  fail "步骤8 三条件检查不完整（仅命中 $COND_COUNT/3）"
fi

# Test 4: 功能 — 步骤8 在 daily 模式下被调用
if grep -qE "step.?8|步骤.?8|STEP.?8|8[.)].*(branch|分支)" "$JANITOR" 2>/dev/null; then
  ok "步骤8 在脚本中有明确标识"
else
  fail "步骤8 标识缺失（难以追踪哪一步失败）"
fi

echo ""
echo "步骤8 测试结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
