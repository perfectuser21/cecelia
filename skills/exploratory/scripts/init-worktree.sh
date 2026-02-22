#!/bin/bash
# init-worktree.sh - 创建 Exploratory worktree

set -e

TASK_DESC="${1:-探索性任务}"
TIMESTAMP=$(date +%s)
WORKTREE_NAME="exploratory-$TIMESTAMP"
BRANCH_NAME="exp-$TIMESTAMP"

# v1.2.0: 对齐官方 .claude/worktrees/ 路径约定
MAIN_WT=$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')
WORKTREE_PATH="$MAIN_WT/.claude/worktrees/$WORKTREE_NAME"
mkdir -p "$(dirname "$WORKTREE_PATH")"

echo "🌿 创建 Exploratory Worktree..."
echo "   路径: $WORKTREE_PATH"
echo "   分支: $BRANCH_NAME"

# 创建 worktree
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"

echo "$WORKTREE_PATH"
