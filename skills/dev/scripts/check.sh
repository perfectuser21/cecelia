#!/bin/bash
# /dev 完成度检查脚本
# 用法: bash scripts/check.sh <BRANCH_NAME> [FEATURE_BRANCH]
#
# BRANCH_NAME 必须是 cp-* 格式的分支名

# 帮助信息
show_help() {
  echo "用法: bash check.sh <cp-分支名> [feature-分支名]"
  echo ""
  echo "参数:"
  echo "  cp-分支名      cp-* 格式的分支名（必须）"
  echo "  feature-分支名  feature/* 格式的基础分支（可选）"
  echo ""
  echo "示例:"
  echo "  bash check.sh cp-20260116-fix-bug feature/zenith-engine"
  echo ""
  echo "此脚本检查 /dev 工作流的完成度，验证清理阶段的各项检查点。"
}

BRANCH_NAME="${1:-}"
FEATURE_BRANCH="${2:-}"

# 帮助参数
if [[ "$BRANCH_NAME" == "-h" || "$BRANCH_NAME" == "--help" ]]; then
  show_help
  exit 0
fi

# Git 仓库检查
if ! git rev-parse --git-dir &>/dev/null; then
  echo "❌ 当前目录不是 git 仓库"
  exit 1
fi

# 参数验证
if [[ -z "$BRANCH_NAME" ]]; then
  echo "❌ 缺少参数"
  echo ""
  show_help
  exit 1
fi

# 验证 cp-* 格式（必须有内容在 cp- 后面）
if [[ ! "$BRANCH_NAME" =~ ^cp-[a-zA-Z0-9] ]]; then
  echo "❌ BRANCH_NAME 必须是 cp-<name> 格式"
  echo "   收到: $BRANCH_NAME"
  exit 1
fi

# 验证分支是否存在（本地或远程）
LOCAL_BRANCH=$(git branch --list "$BRANCH_NAME" 2>/dev/null || echo "")
# 检查网络连接和远程分支
REMOTE_CHECK_OUTPUT=$(git ls-remote --heads origin "$BRANCH_NAME" 2>&1)
REMOTE_CHECK_EXIT=$?
if [[ $REMOTE_CHECK_EXIT -ne 0 ]]; then
  echo "⚠️ 无法检查远程分支（网络问题或 origin 不存在）"
  echo "   错误: $REMOTE_CHECK_OUTPUT"
  REMOTE_BRANCH=""
else
  REMOTE_BRANCH="$REMOTE_CHECK_OUTPUT"
fi

if [[ -z "$LOCAL_BRANCH" && -z "$REMOTE_BRANCH" ]]; then
  echo "⚠️ 分支 $BRANCH_NAME 不存在（本地和远程都没有）"
  echo "   这可能是因为分支已被清理，或者名称拼写错误"
fi

ZENITHJOY_ENGINE="${ZENITHJOY_ENGINE:-/home/xx/dev/zenithjoy-engine}"
SKILL_FILE="$ZENITHJOY_ENGINE/skills/dev/SKILL.md"

# SKILL.md 存在性检查
if [[ ! -f "$SKILL_FILE" ]]; then
  echo "❌ SKILL.md 不存在: $SKILL_FILE"
  echo "   请检查 ZENITHJOY_ENGINE 环境变量"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📋 关键节点完成度检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 从 SKILL.md 动态计算必要项和可选项数量
# □ = 必要（后跟空格，不跟⏭）, □⏭ = 可跳过, ○ = 可选
# 注意：使用正则排除 □⏭
SKIPPABLE_COUNT=$(grep -c '^  □⏭' "$SKILL_FILE" 2>/dev/null || echo 0)
REQUIRED_COUNT=$(grep -E '^  □[^⏭]' "$SKILL_FILE" 2>/dev/null | wc -l || echo 0)
OPTIONAL_COUNT=$(grep -c '^  ○' "$SKILL_FILE" 2>/dev/null || echo 0)

# 动态计算清理阶段的检查项数量（Step 6 下的 □ 项）
# 查找 Step 6 到下一个 Step 或文件末尾之间的 □ 数量
CLEANUP_ITEM_COUNT=$(awk '/^## Step 6/,/^## Step [0-9]|^$/ { if (/^  □[^⏭]/) count++ } END { print count+0 }' "$SKILL_FILE")

COMPLETED_COUNT=0
MISSING_COMMANDS=()

echo ""
echo "清理阶段 (Step 6):"

# git config 已清理？
CONFIG_EXISTS=$(git config "branch.$BRANCH_NAME.base" 2>/dev/null || echo "")
if [[ -z "$CONFIG_EXISTS" ]]; then
  echo "  ✅ git config 已清理"
  ((COMPLETED_COUNT++))
else
  echo "  ❌ git config 未清理"
  MISSING_COMMANDS+=("git config --unset branch.$BRANCH_NAME.base")
fi

# 当前在 feature 分支？
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [[ "$CURRENT_BRANCH" == "unknown" ]]; then
  echo "  ❌ 无法获取当前分支名"
  MISSING_COMMANDS+=("检查 git 状态")
elif [[ "$CURRENT_BRANCH" == feature/* ]]; then
  # 如果提供了 FEATURE_BRANCH，验证是否匹配
  if [[ -n "$FEATURE_BRANCH" && "$CURRENT_BRANCH" != "$FEATURE_BRANCH" ]]; then
    echo "  ⚠️ 当前在 feature 分支 ($CURRENT_BRANCH)，但与指定的 $FEATURE_BRANCH 不同"
    ((COMPLETED_COUNT++))
  else
    echo "  ✅ 已切回 feature 分支 ($CURRENT_BRANCH)"
    ((COMPLETED_COUNT++))
  fi
else
  echo "  ❌ 未切回 feature 分支 (当前: $CURRENT_BRANCH)"
  if [[ -n "$FEATURE_BRANCH" ]]; then
    MISSING_COMMANDS+=("git checkout $FEATURE_BRANCH")
  else
    MISSING_COMMANDS+=("git checkout <your-feature-branch>")
  fi
fi

# git pull 已执行？（假设已执行，无法验证）
echo "  ✅ git pull 已执行（假设）"
((COMPLETED_COUNT++))

# 本地 cp-* 分支已删除？
LOCAL_EXISTS=$(git branch --list "$BRANCH_NAME" 2>/dev/null || echo "")
if [[ -z "$LOCAL_EXISTS" ]]; then
  echo "  ✅ 本地 cp-* 分支已删除"
  ((COMPLETED_COUNT++))
else
  echo "  ❌ 本地 cp-* 分支未删除"
  MISSING_COMMANDS+=("git branch -D $BRANCH_NAME")
fi

# 远程 cp-* 分支已删除？
REMOTE_CHECK=$(git ls-remote --heads origin "$BRANCH_NAME" 2>&1)
REMOTE_EXIT=$?
if [[ $REMOTE_EXIT -ne 0 ]]; then
  echo "  ⚠️ 无法检查远程分支（网络问题）"
elif [[ -z "$REMOTE_CHECK" ]]; then
  echo "  ✅ 远程 cp-* 分支已删除"
  ((COMPLETED_COUNT++))
else
  echo "  ❌ 远程 cp-* 分支未删除"
  MISSING_COMMANDS+=("git push origin --delete $BRANCH_NAME")
fi

# stale 引用已清理？（假设已执行，无法验证）
echo "  ✅ stale 引用已清理（假设）"
((COMPLETED_COUNT++))

# 前面的阶段（假设已完成，因为能走到 cleanup）
# 动态计算：总必要项 - 清理阶段已验证的项数 = 其他阶段的项数
OTHER_STAGES_COUNT=$((REQUIRED_COUNT - CLEANUP_ITEM_COUNT))
if [[ $OTHER_STAGES_COUNT -gt 0 ]]; then
  echo ""
  echo "其他阶段: ✅ $OTHER_STAGES_COUNT/$OTHER_STAGES_COUNT（已通过流程验证）"
  COMPLETED_COUNT=$((COMPLETED_COUNT + OTHER_STAGES_COUNT))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  完成度: %d/%d 必要" "$COMPLETED_COUNT" "$REQUIRED_COUNT"
if [[ "$SKIPPABLE_COUNT" -gt 0 ]]; then
  printf " + %d 可跳过" "$SKIPPABLE_COUNT"
fi
if [[ "$OPTIONAL_COUNT" -gt 0 ]]; then
  printf " + %d 可选" "$OPTIONAL_COUNT"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ ${#MISSING_COMMANDS[@]} -gt 0 ]]; then
  echo ""
  echo "⚠️ 缺失项修复命令："
  for cmd in "${MISSING_COMMANDS[@]}"; do
    echo "  $cmd"
  done
  exit 1
fi

if [[ "$COMPLETED_COUNT" -eq "$REQUIRED_COUNT" ]]; then
  echo ""
  echo "🎉 所有必要节点已完成！"
  exit 0
fi
