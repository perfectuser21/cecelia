#!/usr/bin/env bash
# deploy-local.sh - Cecelia 本地部署钩子
#
# /dev 流程 PR 合并后自动调用，根据改动文件范围智能选择部署步骤。
# 不需要手动调用，由 /dev Step 11 自动触发。
#
# 用法：
#   bash scripts/deploy-local.sh [BASE_BRANCH]
#   bash scripts/deploy-local.sh --dry-run [--changed="path1 path2"]  # 测试用
#
# 关键设计：
#   deploy-local.sh 可能在 worktree 中被调用，但所有实际部署操作
#   必须在【主仓库】中执行，原因：
#   1. .env.docker 等敏感文件不被 git 追踪，worktree 没有这些文件
#   2. Docker 容器挂载的是主仓库的 dist/ 目录，worktree 的 build 产物无效

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 找主仓库路径（兼容 worktree 和直接调用）
# git rev-parse --git-common-dir 在 worktree 里返回主仓库的 .git 路径
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
if [[ "$GIT_COMMON" == ".git" ]]; then
    MAIN_ROOT="$(cd "$(dirname "$SCRIPT_DIR")" && pwd)"
else
    MAIN_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
fi

MAIN_SCRIPTS="$MAIN_ROOT/scripts"

# 参数解析
DRY_RUN=false
CHANGED_FILES=""
BASE_BRANCH="main"

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --changed=*)
            CHANGED_FILES="${arg#*=}"
            ;;
        --*)
            ;;
        *)
            BASE_BRANCH="$arg"
            ;;
    esac
done

echo "=== Cecelia 本地部署 ==="
echo "  主仓库: $MAIN_ROOT"
echo ""

# 检测改动文件范围（在当前 git 上下文中检测）
if [[ -z "$CHANGED_FILES" ]]; then
    if git rev-parse --verify "origin/$BASE_BRANCH" >/dev/null 2>&1; then
        CHANGED_FILES=$(git diff --name-only "origin/$BASE_BRANCH"...HEAD 2>/dev/null || echo "")
    else
        CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD 2>/dev/null || echo "")
    fi
fi

echo "📋 改动范围："
if [[ -z "$CHANGED_FILES" ]]; then
    echo "  (无改动)"
else
    echo "$CHANGED_FILES" | sed 's/^/  /'
fi
echo ""

# 判断需要哪些部署步骤
NEED_BRAIN=false
NEED_DASHBOARD=false

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    [[ "$file" == packages/brain/* ]] && NEED_BRAIN=true
    # apps/dashboard/ 直接改动，或 apps/api/（被 dashboard vite alias 引用）均需重建 dashboard
    [[ "$file" == apps/dashboard/* || "$file" == apps/api/* ]] && NEED_DASHBOARD=true
done <<< "$CHANGED_FILES"

# 没有相关改动，跳过
if [[ "$NEED_BRAIN" == false && "$NEED_DASHBOARD" == false ]]; then
    echo "⏭️  跳过：没有 Brain 或 Dashboard 改动，无需部署"
    exit 0
fi

# 在主仓库拉取最新代码（确保 .env.docker 等文件存在，且代码是最新的）
echo "📥 拉取主仓库最新代码..."
if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] git -C $MAIN_ROOT pull origin $BASE_BRANCH"
else
    git -C "$MAIN_ROOT" pull origin "$BASE_BRANCH" || {
        echo "⚠️  git pull 失败，继续使用现有代码部署"
    }
fi
echo ""

# 部署 Brain（在主仓库中执行，确保 .env.docker 等文件可用）
if [[ "$NEED_BRAIN" == true ]]; then
    echo "🧠 Brain 改动 → 执行 brain-deploy.sh（主仓库）"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] bash $MAIN_SCRIPTS/brain-deploy.sh"
    else
        bash "$MAIN_SCRIPTS/brain-deploy.sh"
    fi
    echo ""
fi

# 部署 Dashboard（在主仓库中 build，Docker 容器挂载主仓库 dist/）
if [[ "$NEED_DASHBOARD" == true ]]; then
    echo "🖥️  Dashboard 改动 → npm run build（主仓库）"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] cd $MAIN_ROOT/apps/dashboard && npm run build"
    else
        cd "$MAIN_ROOT/apps/dashboard"
        npm run build
        cd "$MAIN_ROOT"
    fi
    echo ""

    # rsync 构建产物到 HK VPS
    HK_HOST="hk"
    HK_REMOTE_DIR="/opt/cecelia/frontend"
    DIST_DIR="$MAIN_ROOT/apps/dashboard/dist"

    if [[ -d "$DIST_DIR" ]]; then
        echo "🚀 同步 Dashboard 到 HK VPS ($HK_HOST:$HK_REMOTE_DIR)..."
        if [[ "$DRY_RUN" == true ]]; then
            echo "  [dry-run] rsync -avz --delete $DIST_DIR/ $HK_HOST:$HK_REMOTE_DIR/dist/"
        else
            ssh "$HK_HOST" "mkdir -p $HK_REMOTE_DIR/dist" 2>/dev/null || true
            rsync -avz --delete "$DIST_DIR/" "$HK_HOST:$HK_REMOTE_DIR/dist/" || {
                echo "⚠️  rsync 到 HK 失败，Dashboard 仅本地部署"
            }
            # 重启 HK 前端容器（如果在运行）
            ssh "$HK_HOST" "cd $HK_REMOTE_DIR && docker compose restart 2>/dev/null" || true
            echo "✅ HK VPS 同步完成"
        fi
    else
        echo "⚠️  Dashboard dist/ 不存在，跳过 HK 同步"
    fi
    echo ""
fi

echo "✅ 部署完成"
