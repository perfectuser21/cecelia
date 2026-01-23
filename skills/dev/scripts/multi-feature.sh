#!/usr/bin/env bash
# multi-feature.sh - 多 Feature 分支管理
#
# 用法:
#   multi-feature.sh detect   # 检测所有 feature 分支状态
#   multi-feature.sh sync     # 同步其他 feature 分支到 develop
#   multi-feature.sh list     # 简单列出 feature 分支

set -euo pipefail  # -e: 命令失败时退出; -u: 未定义变量报错; -o pipefail: 管道失败传播

ACTION=${1:-detect}
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# 获取所有本地 feature 分支
get_feature_branches() {
  # 使用 grep -F 进行字面匹配，避免分支名中特殊字符被解释为正则
  git branch | grep -F 'feature/' | sed 's/^[* ]*//' || true
}

# 获取分支落后 develop 的 commit 数
get_behind_count() {
  local branch=$1
  git rev-list --count "$branch"..origin/develop 2>/dev/null || echo "?"
}

# 获取领先的 commits 列表（过滤 auto-backup）
get_ahead_commits() {
  local branch=$1
  git log origin/develop.."$branch" --oneline 2>/dev/null | grep -v "^[a-f0-9]* auto-backup:" || true
}

# 获取领先的 commits 数量（过滤 auto-backup）
get_ahead_count_filtered() {
  local branch=$1
  local count
  # 使用 grep -c 直接计数，避免管道中的空格问题
  # || echo 0 处理 grep 无匹配时返回 1 的情况
  count=$(git log origin/develop.."$branch" --oneline 2>/dev/null | grep -cv "^[a-f0-9]* auto-backup:" || echo 0)
  echo "${count:-0}"
}

# 获取分支最后更新时间
get_last_update() {
  local branch=$1
  git log -1 --format="%ar" "$branch" 2>/dev/null || echo "unknown"
}

# L2 fix: 提取重复的 "还有 N 个" 显示逻辑
show_more_commits() {
  local count=$1
  local limit=${2:-5}
  if [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt "$limit" ]]; then
    echo "       ... 还有 $((count - limit)) 个"
  fi
}

case $ACTION in
  detect)
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  📊 多 Feature 状态检测"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # 先 fetch 最新
    git fetch origin develop --quiet 2>/dev/null || true

    BRANCHES=$(get_feature_branches)

    if [ -z "$BRANCHES" ]; then
      echo "  当前没有 feature/* 分支"
      echo ""
      exit 0
    fi

    COUNT=$(echo "$BRANCHES" | wc -l)
    COUNT=${COUNT// /}  # 移除空格
    echo "  当前 repo 有 ${COUNT} 个 feature 分支:"
    echo ""

    NEED_SYNC=0

    # 使用 while read 替代 for，避免 word splitting 问题
    while IFS= read -r branch; do
      BEHIND=$(get_behind_count "$branch")

      # 判断是否是当前分支
      MARKER=""
      if [ "$branch" = "$CURRENT_BRANCH" ]; then
        MARKER=" (当前)"
      fi

      # 获取过滤后的提交数和最后更新时间
      AHEAD_FILTERED=$(get_ahead_count_filtered "$branch")
      AHEAD_FILTERED="${AHEAD_FILTERED:-0}"  # 确保非空
      LAST_UPDATE=$(get_last_update "$branch")

      if [ "$BEHIND" = "0" ] || [ "$BEHIND" = "?" ]; then
        # 已同步 develop
        echo -e "  ${GREEN}✅${NC} $branch${MARKER}"
        echo "     最后更新: $LAST_UPDATE"
        if [ "$AHEAD_FILTERED" = "0" ]; then
          echo "     与 develop 完全一致（或仅有 auto-backup）"
        else
          echo "     已同步 develop，领先 $AHEAD_FILTERED commits:"
          get_ahead_commits "$branch" | head -5 | sed 's/^/       /'
          show_more_commits "$AHEAD_FILTERED" 5
        fi
      elif [ "$AHEAD_FILTERED" = "0" ]; then
        # 落后 develop 但没有自己的改动（或仅有 auto-backup），建议删除
        echo -e "  ${RED}[DEL]${NC}  $branch${MARKER}"
        echo "     最后更新: $LAST_UPDATE"
        echo "     落后 develop $BEHIND commits，无实际改动"
        echo "     建议删除: git branch -D $branch"
        NEED_SYNC=$((NEED_SYNC + 1))
      else
        # 落后 develop 且有自己的改动，需要同步
        echo -e "  ${YELLOW}[WARN]${NC}  $branch${MARKER}"
        echo "     最后更新: $LAST_UPDATE"
        echo "     落后 develop $BEHIND commits，领先 $AHEAD_FILTERED commits:"
        get_ahead_commits "$branch" | head -5 | sed 's/^/       /'
        show_more_commits "$AHEAD_FILTERED" 5
        NEED_SYNC=$((NEED_SYNC + 1))
      fi
      echo ""
    done <<< "$BRANCHES"

    if [ $NEED_SYNC -gt 0 ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo -e "  ${YELLOW}建议${NC}: 有 $NEED_SYNC 个分支需要同步 develop"
      echo "  运行: bash $0 sync"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo -e "  ${GREEN}所有 feature 分支已同步${NC}"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    echo ""
    ;;

  sync)
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  🔄 同步其他 Feature 分支"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    git fetch origin develop --quiet 2>/dev/null || true

    BRANCHES=$(get_feature_branches)

    if [ -z "$BRANCHES" ]; then
      echo "  没有 feature 分支需要同步"
      exit 0
    fi

    ORIGINAL_BRANCH=$CURRENT_BRANCH
    SYNCED=0
    FAILED=0

    # 使用 while read 替代 for，避免 word splitting 问题
    while IFS= read -r branch; do
      BEHIND=$(get_behind_count "$branch")

      if [ "$BEHIND" = "0" ] || [ "$BEHIND" = "?" ]; then
        echo -e "  ${GREEN}✓${NC} $branch 已是最新"
        continue
      fi

      echo -e "  ${YELLOW}→${NC} 同步 $branch (落后 $BEHIND commits)..."

      # 安全切换分支，失败时跳过该分支（避免在错误分支上 merge）
      if ! git checkout "$branch" --quiet 2>/dev/null; then
        echo -e "    ${RED}✗${NC} 无法切换到 $branch，跳过"
        FAILED=$((FAILED + 1))
        continue
      fi

      if git merge origin/develop --no-edit --quiet 2>/dev/null; then
        echo -e "    ${GREEN}✓${NC} 同步成功"
        SYNCED=$((SYNCED + 1))
      else
        echo -e "    ${RED}✗${NC} 有冲突，需要手动解决"
        # 尝试中止 merge，如果失败则警告用户
        if ! git merge --abort 2>/dev/null; then
          echo -e "    ${RED}⚠${NC} 无法自动中止 merge，分支可能处于 MERGING 状态"
          echo "      手动修复: git merge --abort 或 git reset --hard HEAD"
        fi
        echo ""
        echo "      手动同步步骤:"
        echo "        1. git checkout $branch"
        echo "        2. git merge origin/develop"
        echo "        3. 解决冲突后: git add . && git commit"
        FAILED=$((FAILED + 1))
      fi
    done <<< "$BRANCHES"

    # L3 fix: 切回原分支，添加警告
    if [ -n "$ORIGINAL_BRANCH" ]; then
      if ! git checkout "$ORIGINAL_BRANCH" --quiet 2>/dev/null; then
        echo -e "  ${YELLOW}[WARN]${NC} 无法切回 $ORIGINAL_BRANCH，尝试 develop"
        if ! git checkout develop --quiet 2>/dev/null; then
          echo -e "  ${RED}[FAIL]${NC} 无法切回任何分支，请手动检查"
        fi
      fi
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  同步完成: $SYNCED 成功, $FAILED 需手动处理"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    ;;

  list)
    # 简单列出，供其他脚本调用
    get_feature_branches
    ;;

  *)
    echo "用法: $0 {detect|sync|list}"
    echo ""
    echo "  detect  检测所有 feature 分支状态"
    echo "  sync    同步其他 feature 分支到 develop"
    echo "  list    简单列出 feature 分支"
    exit 1
    ;;
esac
