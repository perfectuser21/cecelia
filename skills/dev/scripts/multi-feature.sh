#!/bin/bash
# multi-feature.sh - 多 Feature 分支管理
#
# 用法:
#   multi-feature.sh detect   # 检测所有 feature 分支状态
#   multi-feature.sh sync     # 同步其他 feature 分支到 main
#   multi-feature.sh list     # 简单列出 feature 分支

set -e

ACTION=${1:-detect}
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# 获取所有本地 feature 分支
get_feature_branches() {
  git branch | grep 'feature/' | sed 's/^[* ]*//' || true
}

# 获取分支落后 main 的 commit 数
get_behind_count() {
  local branch=$1
  git rev-list --count "$branch"..origin/main 2>/dev/null || echo "?"
}

# 获取分支领先 main 的 commit 数
get_ahead_count() {
  local branch=$1
  git rev-list --count origin/main.."$branch" 2>/dev/null || echo "?"
}

# 获取领先的 commits 列表
get_ahead_commits() {
  local branch=$1
  git log origin/main.."$branch" --oneline 2>/dev/null || true
}

case $ACTION in
  detect)
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  📊 多 Feature 状态检测"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # 先 fetch 最新
    git fetch origin main --quiet 2>/dev/null || true

    BRANCHES=$(get_feature_branches)

    if [ -z "$BRANCHES" ]; then
      echo "  当前没有 feature/* 分支"
      echo ""
      exit 0
    fi

    COUNT=$(echo "$BRANCHES" | wc -l | tr -d ' ')
    echo "  当前 repo 有 ${COUNT} 个 feature 分支:"
    echo ""

    NEED_SYNC=0

    for branch in $BRANCHES; do
      BEHIND=$(get_behind_count "$branch")
      AHEAD=$(get_ahead_count "$branch")

      # 判断是否是当前分支
      MARKER=""
      if [ "$branch" = "$CURRENT_BRANCH" ]; then
        MARKER=" (当前)"
      fi

      if [ "$BEHIND" = "0" ] || [ "$BEHIND" = "?" ]; then
        # 已同步 main
        echo -e "  ${GREEN}✅${NC} $branch${MARKER}"
        if [ "$AHEAD" = "0" ]; then
          echo "     与 main 完全一致"
        else
          echo "     已同步 main，领先 $AHEAD commits:"
          get_ahead_commits "$branch" | head -5 | sed 's/^/       /'
          if [ "$AHEAD" -gt 5 ] 2>/dev/null; then
            echo "       ... 还有 $((AHEAD - 5)) 个"
          fi
        fi
      elif [ "$AHEAD" = "0" ]; then
        # 落后 main 但没有自己的改动，建议删除
        echo -e "  ${RED}🗑️${NC}  $branch${MARKER}"
        echo "     落后 main $BEHIND commits，无自己的改动"
        echo "     建议删除: git branch -D $branch"
        NEED_SYNC=$((NEED_SYNC + 1))
      else
        # 落后 main 且有自己的改动，需要同步
        echo -e "  ${YELLOW}⚠️${NC}  $branch${MARKER}"
        echo "     落后 main $BEHIND commits，领先 $AHEAD commits:"
        get_ahead_commits "$branch" | head -5 | sed 's/^/       /'
        if [ "$AHEAD" -gt 5 ] 2>/dev/null; then
          echo "       ... 还有 $((AHEAD - 5)) 个"
        fi
        NEED_SYNC=$((NEED_SYNC + 1))
      fi
      echo ""
    done

    if [ $NEED_SYNC -gt 0 ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo -e "  ${YELLOW}建议${NC}: 有 $NEED_SYNC 个分支需要同步 main"
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

    git fetch origin main --quiet 2>/dev/null || true

    BRANCHES=$(get_feature_branches)

    if [ -z "$BRANCHES" ]; then
      echo "  没有 feature 分支需要同步"
      exit 0
    fi

    ORIGINAL_BRANCH=$CURRENT_BRANCH
    SYNCED=0
    FAILED=0

    for branch in $BRANCHES; do
      BEHIND=$(get_behind_count "$branch")

      if [ "$BEHIND" = "0" ] || [ "$BEHIND" = "?" ]; then
        echo -e "  ${GREEN}✓${NC} $branch 已是最新"
        continue
      fi

      echo -e "  ${YELLOW}→${NC} 同步 $branch (落后 $BEHIND commits)..."

      git checkout "$branch" --quiet 2>/dev/null

      if git merge origin/main --no-edit --quiet 2>/dev/null; then
        echo -e "    ${GREEN}✓${NC} 同步成功"
        SYNCED=$((SYNCED + 1))
      else
        echo -e "    ${RED}✗${NC} 有冲突，需要手动解决"
        echo "      cd $(pwd) && git checkout $branch && git merge origin/main"
        git merge --abort 2>/dev/null || true
        FAILED=$((FAILED + 1))
      fi
    done

    # 切回原分支
    if [ -n "$ORIGINAL_BRANCH" ]; then
      git checkout "$ORIGINAL_BRANCH" --quiet 2>/dev/null || git checkout main --quiet
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
    echo "  sync    同步其他 feature 分支到 main"
    echo "  list    简单列出 feature 分支"
    exit 1
    ;;
esac
