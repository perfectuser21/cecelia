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
# 测试钩子：CECELIA_DEPLOY_ROOT 显式指定部署根（smoke 在隔离目录自洽跑，不碰真实主仓库）
if [[ -n "${CECELIA_DEPLOY_ROOT:-}" ]]; then
    MAIN_ROOT="$(cd "$CECELIA_DEPLOY_ROOT" && pwd)"
else
    GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
    if [[ "$GIT_COMMON" == ".git" ]]; then
        MAIN_ROOT="$(cd "$(dirname "$SCRIPT_DIR")" && pwd)"
    else
        MAIN_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
    fi
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

# ── Gate3 假跳过根治 v2（SHA 对账，bug becfd554）──────────────────────────
# G1 版本号兜底在 squash merge 不 bump version 时失效（#4024 webhook 假跳过实证）。
# 真正的判变真相：origin/main HEAD SHA vs 生产容器构建期烙入的 GIT_SHA。
# 不等 = main 有新代码、生产跑旧镜像 → 必须部署；SHA 相等 = 幂等跳过。
# 测试钩子：CECELIA_PROD_GIT_SHA 注入生产 SHA（跳过真实 curl）。
SHA_MISMATCH=false
ORIGIN_SHA=$(git -C "$MAIN_ROOT" rev-parse "origin/$BASE_BRANCH" 2>/dev/null || echo "")
PROD_SHA="${CECELIA_PROD_GIT_SHA:-}"
if [[ -z "$PROD_SHA" ]]; then
    PROD_SHA=$(curl -sf --max-time 5 \
        "http://localhost:${BRAIN_PORT:-5221}/api/brain/health" 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.git_sha||'')}catch{process.stdout.write('')}})" \
        2>/dev/null || echo "")
fi
if [[ -n "$ORIGIN_SHA" && -n "$PROD_SHA" && "$PROD_SHA" != "unknown" ]]; then
    if [[ "$ORIGIN_SHA" != "$PROD_SHA" ]]; then
        echo "🔎 SHA 对账：origin/main=$ORIGIN_SHA 生产=$PROD_SHA → 不等，强制走 Brain 部署"
        SHA_MISMATCH=true
    else
        echo "✅ SHA 对账：origin/main=$ORIGIN_SHA 生产=$PROD_SHA → 一致，Brain 无需重部署"
    fi
else
    echo "⚠️  SHA 对账：无法获取完整 SHA（origin=$ORIGIN_SHA 生产=${PROD_SHA:-N/A}），跳过对账"
fi

echo "📋 改动范围："
if [[ -z "$CHANGED_FILES" ]]; then
    echo "  (无改动)"
else
    echo "$CHANGED_FILES" | sed 's/^/  /'
fi
echo ""

# ── 部署根守卫（07-10 Gate3 五连红根治）──────────────────────────────
# 真实模式必跑；CECELIA_DEPLOY_ROOT 测试隔离模式默认跳过（现有 smoke 兼容），
# 测试要验守卫时用 CECELIA_DEPLOY_FORCE_GUARD=1 强制开启。
RUN_GUARD=true
[[ -n "${CECELIA_DEPLOY_ROOT:-}" && "${CECELIA_DEPLOY_FORCE_GUARD:-0}" != "1" ]] && RUN_GUARD=false
[[ "$DRY_RUN" == true ]] && RUN_GUARD=false

if [[ "$RUN_GUARD" == true ]]; then
    if [[ "${CECELIA_DEPLOY_AUTORESET:-0}" == "1" ]]; then
        # 专用部署根（机器独占，无人类工作）：自愈到 origin/main
        echo "🔒 部署根守卫（专用根自愈）: fetch + checkout -f + reset --hard origin/$BASE_BRANCH"
        git -C "$MAIN_ROOT" fetch origin "$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: git fetch origin $BASE_BRANCH 失败，拒绝部署"; exit 1; }
        git -C "$MAIN_ROOT" checkout -f "$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: checkout $BASE_BRANCH 失败，拒绝部署"; exit 1; }
        git -C "$MAIN_ROOT" reset --hard "origin/$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: reset --hard origin/$BASE_BRANCH 失败，拒绝部署"; exit 1; }
    else
        # 可能是活人仓：绝不自动改动，任何异常状态硬红（禁止静默降级用脏代码部署）
        CURRENT_BRANCH=$(git -C "$MAIN_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")
        if [[ "$CURRENT_BRANCH" != "$BASE_BRANCH" ]]; then
            echo "❌ 部署根守卫: $MAIN_ROOT 在分支 ${CURRENT_BRANCH}（要求 ${BASE_BRANCH}），拒绝部署。"
            echo "   部署根疑似被工作会话占用；专用根请设 CECELIA_DEPLOY_AUTORESET=1。"
            exit 1
        fi
        if [[ -n "$(git -C "$MAIN_ROOT" status --porcelain --untracked-files=no)" ]]; then
            echo "❌ 部署根守卫: $MAIN_ROOT 有未提交 tracked 改动，拒绝部署（禁止用脏代码部署）。"
            exit 1
        fi
        git -C "$MAIN_ROOT" pull --ff-only origin "$BASE_BRANCH" \
            || { echo "❌ 部署根守卫: git pull --ff-only 失败（分叉/网络），拒绝部署"; exit 1; }
    fi
    echo ""
fi

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

# SHA 对账结果叠加（优先于文件列表，确保 squash merge 不 bump version 场景也触发）
[[ "$SHA_MISMATCH" == true ]] && NEED_BRAIN=true

# 没有相关改动，跳过
if [[ "$NEED_BRAIN" == false && "$NEED_DASHBOARD" == false && "$NEED_WORKFLOW_SKILLS" == false ]]; then
    echo "⏭️  跳过：没有 Brain、Dashboard 或 Workflow Skills 改动，无需部署"
    exit 0
fi

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

# 部署 Dashboard（两段式：build → 自检 → 起常驻 staging + 写放行标记 → 【停住等人工 promote】）
#
# 流程（PrepPRD Golden Path / handoff §4）：
#   build → 产物落到 staging 目录（.dist-staging，不碰 live dist/）
#        → dashboard-staging-selfcheck.sh 在非生产端口自检（起得来/env齐/不白屏/路由通）
#        → 全绿：起【常驻】staging 服务在非生产端口（perfect21:52xx 走 SSH 隧道可私密预览）
#              + 写 .staging-pending 放行标记 → 停住，【不自动 promote】
#        → 自检红：不起 staging、不写标记、不碰 live dist/、退出 1 报红（两生产实例保持旧版）
#   ★ promote（原子换入 5211 + 同步 HK）改由人工跑 scripts/promote-dashboard.sh ★
if [[ "$NEED_DASHBOARD" == true ]]; then
    DASH_DIR="$MAIN_ROOT/apps/dashboard"
    DIST_DIR="$DASH_DIR/dist"
    STAGING_DIST="$DASH_DIR/.dist-staging"
    PENDING_FILE="$DASH_DIR/.staging-pending"
    SLOT_PID_FILE="$DASH_DIR/.staging-slot.pid"
    SLOT_LOG_FILE="$DASH_DIR/.staging-slot.log"
    SELFCHECK="$MAIN_SCRIPTS/dashboard-staging-selfcheck.sh"
    SLOT_SERVER="$MAIN_SCRIPTS/dashboard-slot-server.cjs"
    STAGING_SLOT_PORT="${DASHBOARD_STAGING_PORT:-5223}"

    echo "🖥️  Dashboard 改动 → 构建到 staging slot（自检 → 起常驻 staging → 停住等放行）"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] build → $STAGING_DIST"
        echo "  [dry-run] bash $SELFCHECK $STAGING_DIST $STAGING_SLOT_PORT"
        echo "  [dry-run] 起常驻 staging :$STAGING_SLOT_PORT + 写 ${PENDING_FILE}（不自动 promote）"
    else
        rm -rf "$STAGING_DIST"
        rm -f "$DASH_DIR/.staging-notify.log" 2>/dev/null || true
        if [[ -n "${STAGING_FIXTURE_DIST:-}" ]]; then
            # 测试钩子：跳过慢 vite build，直接把 fixture 当构建产物（smoke 用）
            echo "  [test] STAGING_FIXTURE_DIST → 复制 fixture 作为 staging 产物（跳过 npm build）"
            cp -R "$STAGING_FIXTURE_DIST" "$STAGING_DIST"
        else
            # 确保当前平台的 native 模块已安装（容器 Linux 和宿主 macOS 可能不同）
            # cache 挂 $MAIN_ROOT/.npm-cache（bind-mounted volume），避免 Brain /tmp 100MB tmpfs 被塞满
            cd "$MAIN_ROOT"
            NPM_CACHE_DIR="$MAIN_ROOT/.npm-cache"
            if ! npm install --prefer-offline --cache "$NPM_CACHE_DIR" 2>&1; then
                if ! npm install --cache "$NPM_CACHE_DIR" 2>&1; then
                    echo "❌ npm install 失败，中止部署"
                    exit 1
                fi
            fi
            # 构建到独立 staging 目录（--outDir），不覆盖 live dist/。
            # 关键：自检红时 live dist/ 必须原封不动 → 本机 5211 容器仍读旧版本。
            if [[ -f "/.dockerenv" ]] && command -v docker &>/dev/null; then
                echo "  (容器内构建 → 使用独立 node 容器，4GB 内存限制)"
                docker run --rm \
                    -v "$MAIN_ROOT:$MAIN_ROOT:rw" \
                    -w "$DASH_DIR" \
                    -e NODE_OPTIONS="--max-old-space-size=3072" \
                    --memory=4g \
                    --memory-swap=4g \
                    node:20-alpine \
                    npm run build -- --outDir "$STAGING_DIST"
            else
                cd "$DASH_DIR"
                NODE_OPTIONS="--max-old-space-size=3072" npm run build -- --outDir "$STAGING_DIST"
            fi
            cd "$MAIN_ROOT"
        fi
        echo ""

        # ── 部署前自检 gate ───────────────────────────────────────────────────
        # 自检红 → 不起 staging、不写标记、不碰 live dist/ → 退出 1，两生产实例保持旧版本。
        echo "🔬 Dashboard 部署前自检（staging slot :${STAGING_SLOT_PORT}）..."
        if ! bash "$SELFCHECK" "$STAGING_DIST" "$STAGING_SLOT_PORT"; then
            echo ""
            echo "❌ Dashboard 部署前自检失败 → 阻断 promote"
            echo "   - 未起常驻 staging、未写放行标记"
            echo "   - live dist/ 未改动（本机 5211 保持旧版本）"
            echo "   - 未 ssh HK（HK 生产保持旧版本）"
            rm -rf "$STAGING_DIST" 2>/dev/null || true
            exit 1
        fi
        echo "✅ Dashboard 部署前自检全绿"
        echo ""

        # ── 起【常驻】staging 服务（perfect21:52xx 私密预览，绑 0.0.0.0 对外像 5211）──
        # 杀掉上一轮常驻 staging（若有），再起新的。
        # STAGING_BANNER=1：注入"待放行横幅 + 放行按钮"；commit 显示在横幅上。
        if [[ -f "$SLOT_PID_FILE" ]]; then
            kill "$(cat "$SLOT_PID_FILE" 2>/dev/null)" 2>/dev/null || true
            rm -f "$SLOT_PID_FILE"
        fi
        STAGE_COMMIT=$(git -C "$MAIN_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
        DIST_DIR="$STAGING_DIST" SLOT_PORT="$STAGING_SLOT_PORT" \
            STAGING_BANNER=1 STAGING_COMMIT="$STAGE_COMMIT" \
            nohup node "$SLOT_SERVER" > "$SLOT_LOG_FILE" 2>&1 &
        SLOT_PID=$!
        echo "$SLOT_PID" > "$SLOT_PID_FILE"
        SLOT_UP=0
        for _ in $(seq 1 15); do
            if curl -sf "http://localhost:${STAGING_SLOT_PORT}/" -o /dev/null 2>/dev/null; then
                SLOT_UP=1; break
            fi
            kill -0 "$SLOT_PID" 2>/dev/null || break
            sleep 1
        done
        if [[ "$SLOT_UP" -ne 1 ]]; then
            echo "❌ 常驻 staging 服务起不来 → 阻断 promote"
            sed 's/^/    /' "$SLOT_LOG_FILE" 2>/dev/null | tail -10 || true
            kill "$SLOT_PID" 2>/dev/null || true
            rm -f "$SLOT_PID_FILE"; rm -rf "$STAGING_DIST" 2>/dev/null || true
            exit 1
        fi

        # ── 写放行标记（promote 据此知道放行哪一份）────────────────────────────
        {
            echo "staging_dist=$STAGING_DIST"
            echo "staging_port=$STAGING_SLOT_PORT"
            echo "slot_pid=$SLOT_PID"
            echo "commit=$(git -C "$MAIN_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
            echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        } > "$PENDING_FILE"

        echo "🟡 已停在 staging，等你人工放行（生产未触碰）"
        echo "   ┌─ 私密预览（走 SSH 隧道）──────────────────────────────"
        echo "   │  打开： http://perfect21:${STAGING_SLOT_PORT}/"
        echo "   │  看：① 首页能开不白屏  ② /clips 深层路由通  ③ 你本次改的页面"
        echo "   ├─ 满意后放行 ─────────────────────────────────────────"
        echo "   │  bash $MAIN_SCRIPTS/promote-dashboard.sh"
        echo "   │  → 原子换入本机 5211（Cecelia 单实例，不碰 HK）"
        echo "   └───────────────────────────────────────────────────────"

        # ── 发 Bark 推送通知你去看 staging（iPhone 收到再放行）──────────────────
        STAGE_COMMIT=$(git -C "$MAIN_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
        NOTIFY_TITLE="Cecelia 部署待放行 🟡"
        NOTIFY_BODY="dashboard 新版已停在 staging。电脑开 perfect21:${STAGING_SLOT_PORT} 看，满意跑 promote-dashboard.sh 放行。commit ${STAGE_COMMIT}"
        if [[ -n "${CECELIA_DEPLOY_ROOT:-}" ]]; then
            # 测试模式：写日志文件代替真推送（供 smoke 断言，不打扰真人）
            printf '%s\n%s\n' "$NOTIFY_TITLE" "$NOTIFY_BODY" > "$DASH_DIR/.staging-notify.log"
        else
            [[ -f "$HOME/.credentials/bark.env" ]] && source "$HOME/.credentials/bark.env"
            if [[ -n "${BARK_TOKEN:-}" ]]; then
                BARK_BASE="${BARK_API_URL:-https://api.day.app/$BARK_TOKEN}"
                T_ENC=$(printf '%s' "$NOTIFY_TITLE" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()))' 2>/dev/null || echo "Cecelia")
                B_ENC=$(printf '%s' "$NOTIFY_BODY"  | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read().strip()))' 2>/dev/null || echo "staging-ready")
                if curl -s -o /dev/null --max-time 10 "${BARK_BASE%/}/${T_ENC}/${B_ENC}?group=Cecelia&level=timeSensitive"; then
                    echo "📲 已发 Bark 推送到你 iPhone"
                else
                    echo "⚠️ Bark 推送失败（不影响 staging 已就绪，可直接开 perfect21:${STAGING_SLOT_PORT}）"
                fi
            else
                echo "ℹ️ 未配 BARK_TOKEN（~/.credentials/bark.env），跳过 Bark 推送"
            fi
        fi
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
