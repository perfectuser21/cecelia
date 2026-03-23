#!/bin/bash
# check-learning.sh — 强制 Learning 格式：根本原因 + 下次预防
# HARD GATE: 走 /dev 的 PR 必须包含 Learning 新增内容
#
# v2.0.0: Per-Branch Learning — 检查 docs/learnings/<branch>.md 文件
#   优先检查 docs/learnings/ 目录下的 per-branch 文件
#   向后兼容 docs/LEARNINGS.md（旧 PR 仍可通过）
#
# 例外：PR title 含 [SKIP-LEARNING] 时跳过（需在 PR description 中说明原因）

set -e

PR_TITLE="${PR_TITLE:-}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DevGate: Learning Format Gate (v2 per-branch)"
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
# 查找 Learning 文件（per-branch 优先，旧格式兜底）
# ─────────────────────────────────────────────
LEARNING_FILE=""
ADDED_LINES=""

# 策略1: 检查 docs/learnings/ 目录下是否有新文件（per-branch 模式）
if [ -d "docs/learnings" ]; then
  for f in docs/learnings/*.md; do
    [ -f "$f" ] || continue
    LINES=$(git diff "origin/main...HEAD" -- "$f" | grep '^+' | grep -v '^+++' || true)
    if [ -n "$LINES" ]; then
      LEARNING_FILE="$f"
      ADDED_LINES="$LINES"
      echo "📄 找到 per-branch Learning 文件: $f"
      break
    fi
  done
fi

# 策略2: 向后兼容 — 检查旧的 docs/LEARNINGS.md
if [ -z "$LEARNING_FILE" ] && [ -f "docs/LEARNINGS.md" ]; then
  LINES=$(git diff "origin/main...HEAD" -- "docs/LEARNINGS.md" | grep '^+' | grep -v '^+++' || true)
  if [ -n "$LINES" ]; then
    LEARNING_FILE="docs/LEARNINGS.md"
    ADDED_LINES="$LINES"
    echo "📄 找到旧格式 Learning 文件: docs/LEARNINGS.md"
  fi
fi

# ─────────────────────────────────────────────
# 没找到任何 Learning 文件 → HARD GATE FAILED
# ─────────────────────────────────────────────
if [ -z "$LEARNING_FILE" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ HARD GATE FAILED: 未找到 Learning 文件"
  echo ""
  echo "  走 /dev 工作流的 PR 必须包含 Learning 条目。"
  echo "  请在 Step 10 将 Learning 写到:"
  echo "    docs/learnings/<branch-name>.md"
  echo ""
  echo "  如果本次确实无需 Learning（纯文档/配置修复），"
  echo "  请在 PR title 中加 [SKIP-LEARNING] 标签并在"
  echo "  PR description 中说明原因。"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo "🔍 检测到 $LEARNING_FILE 有新增内容，检查格式..."
echo ""

# ─────────────────────────────────────────────
# 格式检查：根本原因 + 下次预防 + checklist
# ─────────────────────────────────────────────
NEW_CONTENT=$(echo "$ADDED_LINES" | sed 's/^+//')

HAS_ROOT_CAUSE=false
HAS_PREVENTION=false
HAS_CHECKLIST=false

# 检查"根本原因"章节（标题 + 至少3行非空内容）
ROOT_CAUSE_LINES_ACTUAL=0
if echo "$NEW_CONTENT" | grep -qE "^#{1,4}[[:space:]]*(根本原因|Root Cause)"; then
  ROOT_CAUSE_LINES_ACTUAL=$(echo "$NEW_CONTENT" | \
    awk '/^#{1,4}[[:space:]]*(根本原因|Root Cause)/{found=1;next} found && /^#{1,4}[[:space:]]+/{exit} found && /[^[:space:]]/{count++} END{print count+0}')
  if [ "${ROOT_CAUSE_LINES_ACTUAL:-0}" -ge 3 ]; then
    HAS_ROOT_CAUSE=true
  fi
fi

# 检查"下次预防"章节（标题 + 至少1行非空内容）
PREVENTION_LINES_ACTUAL=0
if echo "$NEW_CONTENT" | grep -qE "^#{1,4}[[:space:]]*(下次预防|Prevention|预防措施)"; then
  PREVENTION_LINES_ACTUAL=$(echo "$NEW_CONTENT" | \
    awk '/^#{1,4}[[:space:]]*(下次预防|Prevention|预防措施)/{found=1;next} found && /^#{1,4}[[:space:]]+/{exit} found && /[^[:space:]]/{count++} END{print count+0}')
  if [ "${PREVENTION_LINES_ACTUAL:-0}" -ge 1 ]; then
    HAS_PREVENTION=true
  fi
fi

# 检查 checklist 条目（- [ ] 或 - [x] 格式）
if echo "$NEW_CONTENT" | grep -qE "^[[:space:]]*-[[:space:]]\[[ xX]\]"; then
  HAS_CHECKLIST=true
fi

FAILED=false

if [ "$HAS_ROOT_CAUSE" = "false" ]; then
  echo "❌ 根本原因章节内容不足（当前 ${ROOT_CAUSE_LINES_ACTUAL:-0} 行，需要 ≥ 3 行非空内容）"
  FAILED=true
else
  echo "✅ 找到'根本原因'章节"
fi

if [ "$HAS_PREVENTION" = "false" ]; then
  echo "❌ 下次预防章节内容不足（当前 ${PREVENTION_LINES_ACTUAL:-0} 行，需要 ≥ 1 行非空内容）"
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
echo "  ✅ Learning Format Gate Passed ($LEARNING_FILE)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
