#!/usr/bin/env bash
# deploy-local.sh - Cecelia 本地部署钩子
#
# /dev 流程 PR 合并后自动调用，根据改动文件范围智能选择部署步骤。
# 不需要手动调用，由 /dev Step 11 自动触发。
#
# 用法：
#   bash scripts/deploy-local.sh [BASE_BRANCH]
#   bash scripts/deploy-local.sh --dry-run [--changed="path1 path2"]  # 测试用

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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
echo ""

# 检测改动文件（未通过 --changed 手动指定时）
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
    [[ "$file" == apps/dashboard/* ]] && NEED_DASHBOARD=true
done <<< "$CHANGED_FILES"

# 没有相关改动，跳过
if [[ "$NEED_BRAIN" == false && "$NEED_DASHBOARD" == false ]]; then
    echo "⏭️  跳过：没有 Brain 或 Dashboard 改动，无需部署"
    exit 0
fi

# 部署 Brain
if [[ "$NEED_BRAIN" == true ]]; then
    echo "🧠 Brain 改动 → 执行 brain-deploy.sh"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] bash $SCRIPT_DIR/brain-deploy.sh"
    else
        bash "$SCRIPT_DIR/brain-deploy.sh"
    fi
    echo ""
fi

# 部署 Dashboard
if [[ "$NEED_DASHBOARD" == true ]]; then
    echo "🖥️  Dashboard 改动 → npm run build"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] cd $ROOT_DIR/apps/dashboard && npm run build"
    else
        cd "$ROOT_DIR/apps/dashboard"
        npm run build
        cd "$ROOT_DIR"
    fi
    echo ""
fi

echo "✅ 部署完成"
