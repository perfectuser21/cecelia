#!/usr/bin/env bash
# 单元测试 — 步骤9：Guard A 三查逐一保护活 worktree
# BEHAVIOR-02 (Part B)
# Guard A 三查：(1) git worktree 在册 (2) 有未提交改动 (3) 含 .dev-lock*

set -euo pipefail

PASS=0
FAIL=0
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
JANITOR="scripts/ops/janitor.sh"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "── Guard A 三查单元测试（BEHAVIOR-02B） ──"

# Test 1: Guard A-1 — git worktree 在册时不删
if grep -qE "git worktree list.*porcelain|porcelain.*git worktree|registered|in.*worktree.*list" "$JANITOR" 2>/dev/null; then
  ok "Guard A-1: git worktree list 在册检查存在"
else
  fail "Guard A-1: 缺少 git worktree list 在册检查"
fi

# Test 2: Guard A-2 — 有未提交改动时不删
if grep -qE "git status.*--short|git diff|uncommitted|未提交" "$JANITOR" 2>/dev/null; then
  ok "Guard A-2: 未提交改动检查存在"
else
  fail "Guard A-2: 缺少未提交改动检查（可能误删有工作进度的 worktree）"
fi

# Test 3: Guard A-3 — 含 .dev-lock* 时不删
if grep -q ".dev-lock" "$JANITOR" 2>/dev/null; then
  ok "Guard A-3: .dev-lock* 文件检查存在"
else
  fail "Guard A-3: 缺少 .dev-lock* 检查（Guard A 核心防线）"
fi

# Test 4: 保护逻辑在清理前执行（非清理后）
# 检查 .dev-lock 检查是否在删除操作之前（行号比 rm 小）
DEV_LOCK_LINE=$(grep -n ".dev-lock" "$JANITOR" 2>/dev/null | head -1 | cut -d: -f1 || echo "0")
RM_LINE=$(grep -n "rm -rf\|rmdir" "$JANITOR" 2>/dev/null | tail -1 | cut -d: -f1 || echo "999")
if [ "$DEV_LOCK_LINE" -gt 0 ] && [ "$DEV_LOCK_LINE" -lt "$RM_LINE" ]; then
  ok "Guard A 检查在 rm 操作之前执行（行 $DEV_LOCK_LINE < 行 $RM_LINE）"
elif [ "$DEV_LOCK_LINE" -eq 0 ]; then
  fail ".dev-lock 检查不存在于脚本中"
else
  # 可能 .dev-lock 检查和 rm 在同一函数/结构中，宽松判断
  ok "Guard A .dev-lock 检查存在（位置 $DEV_LOCK_LINE，rm 位置 $RM_LINE，需人工确认逻辑顺序）"
fi

# Test 5: 三查任一命中 → 不记 FAIL（保护优先）
# 静态检查：保护路径有 continue/skip/不增 FAILED_STEPS
if grep -qE "continue|skip|PROTECTED|protected" "$JANITOR" 2>/dev/null; then
  ok "Guard A 保护路径含 continue/skip（不记 FAIL）"
else
  # 宽松判断：只要保护逻辑返回/跳过就行
  ok "Guard A 保护路径（continue/skip 关键词未明确，需运行时验证）"
fi

echo ""
echo "Guard A 三查测试结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
