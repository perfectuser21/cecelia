#!/usr/bin/env bash
set -euo pipefail

# squash-evidence.sh
# 自动把 "chore: update quality evidence" commit 合并到前一个 commit
#
# 用途：避免 SHA 不匹配问题
# 调用时机：Step 8 (PR) 创建 PR 前

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Squash Evidence Commit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查是否有 commit
if ! git rev-parse HEAD >/dev/null 2>&1; then
  echo "⚠️ 没有 commit，跳过"
  exit 0
fi

# 检查是否有多个 commit
COMMIT_COUNT=$(git rev-list --count HEAD ^origin/develop 2>/dev/null || echo "1")
if [[ "$COMMIT_COUNT" -lt 2 ]]; then
  echo "只有 $COMMIT_COUNT 个 commit，无需 squash"
  exit 0
fi

# 获取最后一个 commit 的消息
LAST_MSG=$(git log -1 --pretty=%s)

echo "最后 commit: $LAST_MSG"
echo ""

if [[ "$LAST_MSG" == "chore: update quality evidence"* ]] || \
   [[ "$LAST_MSG" == "chore: 更新质检证据"* ]]; then
  echo "✅ 检测到 evidence commit，自动合并..."
  echo ""

  # 显示要合并的两个 commit
  echo "将要合并的 commits:"
  git log -2 --oneline
  echo ""

  # Soft reset 到 HEAD~1，保留所有修改
  git reset --soft HEAD~1

  # Amend 到前一个 commit
  git commit --amend --no-edit

  echo ""
  echo "✅ 已合并到代码 commit"
  echo ""
  echo "合并后的 commit:"
  git log -1 --oneline

else
  echo "不是 evidence commit，跳过"
  echo ""
  echo "提示：只自动合并以下格式的 commit:"
  echo "  - chore: update quality evidence ..."
  echo "  - chore: 更新质检证据 ..."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
