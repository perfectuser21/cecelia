#!/bin/bash
set -e

# ============================================================================
# Stop Hook for Exploratory Skill
# ============================================================================
# 检查 Exploratory 流程完成条件
#
# 完成条件：
#   1. PRD 文件已生成（exploratory-*.prd.md）
#   2. DOD 文件已生成（exploratory-*.dod.md）
#   3. worktree 已清理（exp-* 分支/目录不存在）
#   4. .exploratory-mode 文件存在（记录状态）
#
# 返回值：
#   0 - 所有条件满足，流程完成
#   2 - 有条件未满足，继续执行
# ============================================================================

MODE_FILE=".exploratory-mode"

# 检查 mode 文件是否存在
if [ ! -f "$MODE_FILE" ]; then
  echo "⚠️  .exploratory-mode 文件不存在，无法检查完成状态"
  exit 0  # 没有 mode 文件说明不是 exploratory 流程
fi

# 读取 mode 文件
WORKTREE_PATH=$(grep "^worktree:" "$MODE_FILE" 2>/dev/null | cut -d: -f2- | xargs || echo "")
TIMESTAMP=$(grep "^timestamp:" "$MODE_FILE" 2>/dev/null | cut -d: -f2- | xargs || echo "")
OUTPUT_PREFIX=$(grep "^output:" "$MODE_FILE" 2>/dev/null | cut -d: -f2- | xargs || echo "exploratory")

# 如果没有 timestamp，尝试从 output 推断
if [ -z "$TIMESTAMP" ] && [ -n "$OUTPUT_PREFIX" ]; then
  # 从 output prefix 提取 timestamp（如果有）
  TIMESTAMP=$(echo "$OUTPUT_PREFIX" | grep -oE '[0-9]{10,}' || echo "")
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Exploratory 流程完成度检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. 检查 PRD 文件
PRD_FOUND=false
if [ -n "$OUTPUT_PREFIX" ] && [ -f "${OUTPUT_PREFIX}.prd.md" ]; then
  echo "✅ PRD 文件存在: ${OUTPUT_PREFIX}.prd.md"
  PRD_FOUND=true
elif [ -n "$TIMESTAMP" ] && [ -f "exploratory-${TIMESTAMP}.prd.md" ]; then
  echo "✅ PRD 文件存在: exploratory-${TIMESTAMP}.prd.md"
  PRD_FOUND=true
else
  # 尝试查找任何 exploratory-*.prd.md 文件
  if ls exploratory-*.prd.md 1>/dev/null 2>&1; then
    echo "✅ PRD 文件存在: $(ls exploratory-*.prd.md | head -1)"
    PRD_FOUND=true
  else
    echo "❌ PRD 文件未生成"
    echo ""
    echo "请完成 Step 4：生成 PRD 文件"
    exit 2
  fi
fi

# 2. 检查 DOD 文件
DOD_FOUND=false
if [ -n "$OUTPUT_PREFIX" ] && [ -f "${OUTPUT_PREFIX}.dod.md" ]; then
  echo "✅ DOD 文件存在: ${OUTPUT_PREFIX}.dod.md"
  DOD_FOUND=true
elif [ -n "$TIMESTAMP" ] && [ -f "exploratory-${TIMESTAMP}.dod.md" ]; then
  echo "✅ DOD 文件存在: exploratory-${TIMESTAMP}.dod.md"
  DOD_FOUND=true
else
  # 尝试查找任何 exploratory-*.dod.md 文件
  if ls exploratory-*.dod.md 1>/dev/null 2>&1; then
    echo "✅ DOD 文件存在: $(ls exploratory-*.dod.md | head -1)"
    DOD_FOUND=true
  else
    echo "❌ DOD 文件未生成"
    echo ""
    echo "请完成 Step 4：生成 DOD 文件"
    exit 2
  fi
fi

# 3. 检查 worktree 是否清理
WORKTREE_CLEANED=true
if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
  echo "❌ Worktree 未清理: $WORKTREE_PATH"
  echo ""
  echo "请完成 Step 5：清理 worktree"
  WORKTREE_CLEANED=false
  exit 2
else
  echo "✅ Worktree 已清理"
fi

# 4. 检查是否有残留的 exp-* 分支
EXP_BRANCHES=$(git branch | grep -E '^\s+exp-' || true)
if [ -n "$EXP_BRANCHES" ]; then
  echo "⚠️  发现残留的 exp-* 分支:"
  echo "$EXP_BRANCHES" | sed 's/^/     /'
  echo ""
  echo "建议清理这些分支：git branch -D <branch-name>"
  # 不阻止流程，只是警告
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 所有条件满足，删除 mode 文件并完成
if [ "$PRD_FOUND" = true ] && [ "$DOD_FOUND" = true ] && [ "$WORKTREE_CLEANED" = true ]; then
  echo "  ✅ Exploratory 流程完成"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "产出文件："
  ls -1 exploratory-*.{prd,dod}.md 2>/dev/null || ls -1 ${OUTPUT_PREFIX}.{prd,dod}.md 2>/dev/null || echo "  - 文件已生成"
  echo ""
  echo "下一步：使用 /dev 基于生成的 PRD/DOD 实现干净版本"
  
  # 删除 mode 文件
  rm -f "$MODE_FILE"
  exit 0
else
  echo "  ⏳ Exploratory 流程未完成"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 2
fi
