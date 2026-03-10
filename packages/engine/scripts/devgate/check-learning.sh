#!/bin/bash
# check-learning.sh — 强制 Learning 格式：根本原因 + 下次预防
# HARD GATE: 走 /dev 的 PR 必须包含 LEARNINGS.md 新增内容
#
# A+ 方案：Learning 现在是必需品，不是可选附件。
# 例外：PR title 含 [SKIP-LEARNING] 时跳过（需在 PR description 中说明原因）

set -e

LEARNINGS_FILE="docs/LEARNINGS.md"
PR_TITLE="${PR_TITLE:-}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DevGate: Learning Format Gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─────────────────────────────────────────────
# [SKIP-LEARNING] 例外机制
# ─────────────────────────────────────────────
if echo "$PR_TITLE" | grep -q "\[SKIP-LEARNING\]"; then
  echo "ℹ️  PR title 含 [SKIP-LEARNING]，跳过 Learning 检查"
  echo "   请确认 PR description 中已说明跳过原因"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✅ Learning Format Gate SKIPPED (by [SKIP-LEARNING])"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

# ─────────────────────────────────────────────
# LEARNINGS.md 必须存在（A+ 方案：不再允许跳过）
# ─────────────────────────────────────────────
if [ ! -f "$LEARNINGS_FILE" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ HARD GATE FAILED: docs/LEARNINGS.md 不存在"
  echo ""
  echo "  走 /dev 工作流的 PR 必须包含 LEARNINGS.md 条目。"
  echo "  请在 Step 10 完成 Learning 记录。"
  echo ""
  echo "  如果本次确实无需 Learning（纯文档/配置修复），"
  echo "  请在 PR title 中加 [SKIP-LEARNING] 标签并在"
  echo "  PR description 中说明原因。"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

# ─────────────────────────────────────────────
# 本 PR 必须新增 LEARNINGS.md 内容（A+ 方案：不再允许跳过）
# ─────────────────────────────────────────────
ADDED_LINES=$(git diff "origin/main...HEAD" -- "$LEARNINGS_FILE" | grep '^+' | grep -v '^+++' || true)

if [ -z "$ADDED_LINES" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ HARD GATE FAILED: 本 PR 未在 LEARNINGS.md 中新增内容"
  echo ""
  echo "  走 /dev 工作流的 PR 必须包含 LEARNINGS.md 新增条目。"
  echo "  请在 Step 10 完成 Learning 记录并 push 到功能分支。"
  echo ""
  echo "  如果本次确实无需 Learning（纯文档/配置修复），"
  echo "  请在 PR title 中加 [SKIP-LEARNING] 标签并在"
  echo "  PR description 中说明原因。"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo "🔍 检测到 LEARNINGS.md 有新增内容，检查格式..."
echo ""

# ─────────────────────────────────────────────
# 格式检查：根本原因 + 下次预防 + checklist
# ─────────────────────────────────────────────
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
