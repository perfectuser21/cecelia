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
            # 将空格分隔的文件列表转为换行符分隔（与 git diff --name-only 输出格式一致）
            CHANGED_FILES="${arg#*=}"
            CHANGED_FILES="${CHANGED_FILES// /$'\n'}"
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
NEED_WORKFLOW_SKILLS=false

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    # Brain 部署只触发 src/ 核心代码变更（排除测试/工具脚本，它们不影响运行时）
    if [[ "$file" == packages/brain/* ]]; then
        [[ "$file" == packages/brain/src/__tests__/* ]] && continue
        [[ "$file" == packages/brain/src/scripts/* ]] && continue
        [[ "$file" == packages/brain/scripts/* ]] && continue
        NEED_BRAIN=true
    fi
    # apps/dashboard/ 直接改动，或 apps/api/（被 dashboard vite alias 引用）均需重建 dashboard
    # schedule 触发时 changed_paths 是目录级 "apps/"，glob 不匹配纯目录名，需额外匹配
    if [[ "$file" == apps/dashboard/* || "$file" == apps/api/* || "$file" == "apps/" || "$file" == "apps" ]]; then
        NEED_DASHBOARD=true
    fi
    # workflow skills 变更 → 重新部署软链接
    [[ "$file" == packages/workflows/skills/* ]] && NEED_WORKFLOW_SKILLS=true
done <<< "$CHANGED_FILES"

# 没有相关改动，跳过
if [[ "$NEED_BRAIN" == false && "$NEED_DASHBOARD" == false && "$NEED_WORKFLOW_SKILLS" == false ]]; then
    echo "⏭️  跳过：没有 Brain、Dashboard 或 Workflow Skills 改动，无需部署"
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

# 部署 Dashboard（轻量 staging：先 build 到 staging slot 自检，全绿才 promote）
#
# 流程（PrepPRD Golden Path）：
#   build → 产物落到 staging 目录（.dist-staging，不碰 live dist/）
#        → dashboard-staging-selfcheck.sh 在非生产端口自检（起得来/env齐/不白屏/路由通）
#        → 全绿才 promote：原子换入 live dist/（本机 5211 容器即生效）+ tar+ssh 同步 HK
#        → 自检红：不碰 live dist/、不 ssh HK，两个生产实例都保持旧版本，退出 1 报红
if [[ "$NEED_DASHBOARD" == true ]]; then
    DIST_DIR="$MAIN_ROOT/apps/dashboard/dist"
    STAGING_DIST="$MAIN_ROOT/apps/dashboard/.dist-staging"
    SELFCHECK="$MAIN_SCRIPTS/dashboard-staging-selfcheck.sh"
    STAGING_SLOT_PORT="${DASHBOARD_STAGING_PORT:-5223}"

    echo "🖥️  Dashboard 改动 → 构建到 staging slot（先自检，后 promote）"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] cd $MAIN_ROOT/apps/dashboard && npm run build → $STAGING_DIST"
        echo "  [dry-run] bash $SELFCHECK $STAGING_DIST $STAGING_SLOT_PORT"
        echo "  [dry-run] promote: $STAGING_DIST → $DIST_DIR + tar+ssh HK"
    else
        # 确保当前平台的 native 模块已安装（容器 Linux 和宿主 macOS 可能不同）
        cd "$MAIN_ROOT"
        npm install --prefer-offline --cache /tmp/.npm-cache --silent 2>/dev/null \
            || npm install --cache /tmp/.npm-cache --silent 2>/dev/null \
            || true

        # 构建到独立的 staging 输出目录（--outDir），不覆盖 live dist/。
        # 关键：自检红时 live dist/ 必须原封不动 → 本机 5211 容器仍读旧版本。
        rm -rf "$STAGING_DIST"
        if [[ -f "/.dockerenv" ]] && command -v docker &>/dev/null; then
            echo "  (容器内构建 → 使用独立 node 容器，4GB 内存限制)"
            docker run --rm \
                -v "$MAIN_ROOT:$MAIN_ROOT:rw" \
                -w "$MAIN_ROOT/apps/dashboard" \
                -e NODE_OPTIONS="--max-old-space-size=3072" \
                --memory=4g \
                --memory-swap=4g \
                node:20-alpine \
                npm run build -- --outDir "$STAGING_DIST"
        else
            cd "$MAIN_ROOT/apps/dashboard"
            NODE_OPTIONS="--max-old-space-size=3072" npm run build -- --outDir "$STAGING_DIST"
        fi
        cd "$MAIN_ROOT"
        echo ""

        # ── 部署前自检 gate ───────────────────────────────────────────────────
        # 自检红 → 不 promote、不碰 live dist/、不 ssh HK → 退出 1，两个生产实例保持旧版本。
        echo "🔬 Dashboard 部署前自检（staging slot :${STAGING_SLOT_PORT}）..."
        if ! bash "$SELFCHECK" "$STAGING_DIST" "$STAGING_SLOT_PORT"; then
            echo ""
            echo "❌ Dashboard 部署前自检失败 → 阻断 promote"
            echo "   - live dist/ 未改动（本机 5211 保持旧版本）"
            echo "   - 未 ssh HK（HK 生产保持旧版本）"
            rm -rf "$STAGING_DIST" 2>/dev/null || true
            exit 1
        fi
        echo "✅ Dashboard 部署前自检全绿 → 允许 promote"
        echo ""

        # ── Promote：把 staging 产物换入 live dist/（本机 5211 容器立即生效）──────
        # 原子换入：先 dist.old 备份，rename staging→dist，成功后删 old；失败则回滚。
        if [[ -d "$DIST_DIR" ]]; then
            rm -rf "${DIST_DIR}.old" 2>/dev/null || true
            mv "$DIST_DIR" "${DIST_DIR}.old"
        fi
        if mv "$STAGING_DIST" "$DIST_DIR"; then
            rm -rf "${DIST_DIR}.old" 2>/dev/null || true
            echo "🟢 Promote 完成：本机 5211 已指向新版本"
        else
            echo "❌ Promote 换入失败，回滚 live dist/"
            [[ -d "${DIST_DIR}.old" ]] && mv "${DIST_DIR}.old" "$DIST_DIR"
            exit 1
        fi
    fi
    echo ""

    # 同步构建产物到 HK VPS（promote 的第二个生产实例）
    # 用 Tailscale IP 而非主机名别名——Brain 跑在 Docker 容器里，容器的 ~ 是 /root，
    # 不是宿主机 /Users/administrator，SSH config 里的 hk-vps 别名找不到。
    HK_IP="${CECELIA_HK_IP:-100.86.118.99}"
    HK_USER="${CECELIA_HK_USER:-root}"
    HK_SSH_KEY="${CECELIA_HK_SSH_KEY:-/Users/administrator/.ssh/id_rsa}"
    HK_SSH_OPTS="-i $HK_SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15"
    HK_REMOTE_DIR="/opt/cecelia/frontend"

    if [[ -d "$DIST_DIR" ]]; then
        echo "🚀 同步 Dashboard 到 HK VPS ($HK_USER@$HK_IP:$HK_REMOTE_DIR)..."
        if [[ "$DRY_RUN" == true ]]; then
            echo "  [dry-run] tar+ssh $DIST_DIR/ -> $HK_USER@$HK_IP:$HK_REMOTE_DIR/dist/"
        else
            ssh $HK_SSH_OPTS "$HK_USER@$HK_IP" "mkdir -p $HK_REMOTE_DIR/dist" 2>/dev/null || true
            tar -czf - -C "$DIST_DIR" . \
                | ssh $HK_SSH_OPTS "$HK_USER@$HK_IP" "tar -xzf - -C $HK_REMOTE_DIR/dist/" && {
                ssh $HK_SSH_OPTS "$HK_USER@$HK_IP" "docker exec cecelia-core-hk nginx -s reload 2>/dev/null" || true
                echo "✅ HK VPS 同步完成"
            } || {
                echo "⚠️  tar+ssh 同步到 HK 失败，Dashboard 仅本地部署"
            }
        fi
    else
        echo "⚠️  Dashboard dist/ 不存在，跳过 HK 同步"
    fi
    echo ""
fi

# 部署 Workflow Skills 软链接（packages/workflows/skills/ → ~/.claude-accountN/skills/）
if [[ "$NEED_WORKFLOW_SKILLS" == true ]]; then
    echo "🔗 Workflow Skills 变更 → 更新 skill 软链接"
    DEPLOY_SKILLS="$MAIN_ROOT/packages/workflows/scripts/deploy-workflow-skills.sh"
    if [[ -f "$DEPLOY_SKILLS" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            echo "  [dry-run] bash $DEPLOY_SKILLS --dry-run"
        else
            bash "$DEPLOY_SKILLS"
        fi
    else
        echo "⚠️  deploy-workflow-skills.sh 不存在，跳过 skill 软链接更新"
    fi
    echo ""
fi

echo "✅ 部署完成"
