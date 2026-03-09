#!/bin/bash
# check-learning.sh — 强制 Learning 格式：根本原因 + 下次预防
# HARD GATE: PR 新增的 LEARNINGS.md 条目必须包含结构化格式

set -e

LEARNINGS_FILE="docs/LEARNINGS.md"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DevGate: Learning Format Gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查 LEARNINGS.md 是否存在
if [ ! -f "$LEARNINGS_FILE" ]; then
  echo "ℹ️  $LEARNINGS_FILE 不存在，跳过检查"
  exit 0
fi

# 找到本 PR 新增的行（去掉 diff 头信息）
ADDED_LINES=$(git diff "origin/main...HEAD" -- "$LEARNINGS_FILE" | grep '^+' | grep -v '^+++' || true)

if [ -z "$ADDED_LINES" ]; then
  echo "ℹ️  本 PR 未修改 $LEARNINGS_FILE，跳过检查"
  exit 0
fi

echo "🔍 检测到 LEARNINGS.md 有新增内容，检查格式..."
echo ""

# 提取新增内容（去掉行首的 + 号）
NEW_CONTENT=$(git diff "origin/main...HEAD" -- "$LEARNINGS_FILE" | grep '^+' | grep -v '^+++' | sed 's/^+//')

HAS_ROOT_CAUSE=false
HAS_PREVENTION=false
HAS_CHECKLIST=false

# 检查"根本原因"章节
if echo "$NEW_CONTENT" | grep -qE "^#{1,4}[[:space:]]*(根本原因|Root Cause)"; then
  HAS_ROOT_CAUSE=true
fi

# 检查"下次预防"章节
if echo "$NEW_CONTENT" | grep -qE "^#{1,4}[[:space:]]*(下次预防|Prevention|预防措施)"; then
  HAS_PREVENTION=true
fi

# 检查 checklist 条目（- [ ] 或 - [x] 格式）
if echo "$NEW_CONTENT" | grep -qE "^[[:space:]]*-[[:space:]]\[[ xX]\]"; then
  HAS_CHECKLIST=true
fi

FAILED=false

if [ "$HAS_ROOT_CAUSE" = "false" ]; then
  echo "❌ 缺少'根本原因'章节"
  FAILED=true
else
  echo "✅ 找到'根本原因'章节"
fi

if [ "$HAS_PREVENTION" = "false" ]; then
  echo "❌ 缺少'下次预防'章节"
  FAILED=true
else
  echo "✅ 找到'下次预防'章节"
fi

if [ "$HAS_CHECKLIST" = "false" ]; then
  echo "❌ 缺少 checklist 条目（- [ ] 格式）"
  FAILED=true
else
  echo "✅ 找到 checklist 条目"
fi

if [ "$FAILED" = "true" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ HARD GATE FAILED: Learning 格式不符合要求"
  echo ""
  echo "  Learning 条目必须包含以下结构："
  echo ""
  echo "  ## <学习标题>（日期）"
  echo ""
  echo "  ### 根本原因"
  echo "  <具体原因描述，不能是空话>"
  echo ""
  echo "  ### 下次预防"
  echo "  - [ ] 具体可执行的预防措施"
  echo "  - [ ] 另一条预防措施"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Learning Format Gate Passed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
