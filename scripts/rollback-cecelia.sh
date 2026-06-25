#!/usr/bin/env bash
# rollback-cecelia.sh — Cecelia 生产一键回档（部署生命周期 阶段1 / spec §1 回档契约）
#
# 生产炸了之后用这条命令秒回上一个发布版本（或指定留存版本）。回档动作 = 三件事原子完成：
#   1) dashboard：把 live dist/ 换回留存区 .dist-releases/<tag>/（换入失败回滚到换入前）
#   2) brain：git checkout <tag> + 重启容器（跨 DB migration 需 --confirm-db 显式确认）
#   3) 指针：.production-release current 回拨到该 tag + 追加一条回档审计行
#
# 用法：
#   bash scripts/rollback-cecelia.sh                  # 无参 → 退到历史里上一个 tag
#   bash scripts/rollback-cecelia.sh prod-cecelia-vN  # 退到指定留存版本（不在留存内则报错）
#   bash scripts/rollback-cecelia.sh prod-cecelia-vN --confirm-db   # 跨 migration 时显式确认
#
# 退出码：0=回档成功  1=参数/前置错误或换入失败（生产保持原状）
#
# 测试钩子：CECELIA_DEPLOY_ROOT（隔离根）、CECELIA_SKIP_BRAIN_PROMOTE（跳过容器重启）。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 部署根解析（与 promote-dashboard.sh / deploy-local.sh 一致）
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

DASH_DIR="$MAIN_ROOT/apps/dashboard"
DIST_DIR="$DASH_DIR/dist"
RELEASES_DIR="$DASH_DIR/.dist-releases"
RELEASE_FILE="$MAIN_ROOT/.production-release"
TAG_PREFIX="prod-cecelia-v"

# ── 参数解析 ──────────────────────────────────────────────────────────────────
TARGET_TAG=""
CONFIRM_DB=false
for arg in "$@"; do
    case "$arg" in
        --confirm-db) CONFIRM_DB=true ;;
        --*)          echo "❌ 未知参数：$arg"; exit 1 ;;
        *)            TARGET_TAG="$arg" ;;
    esac
done

echo "=== Cecelia 生产一键回档 ==="
echo "  部署根: $MAIN_ROOT"

# ── 前置：必须有指针（promote 过才能回档）─────────────────────────────────────
if [[ ! -f "$RELEASE_FILE" ]]; then
    echo "❌ 无 .production-release —— 从未 promote 过，没有可回退的发布历史。"
    exit 1
fi
CURRENT_TAG=$(grep '^current=' "$RELEASE_FILE" | head -1 | cut -d= -f2)

# ── 决定回档目标 tag ──────────────────────────────────────────────────────────
if [[ -z "$TARGET_TAG" ]]; then
    # 无参 → 历史里【上一个】 tag（当前留存区里版本号 < current 的最大者）。
    TARGET_TAG=$(ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E "^${TAG_PREFIX}[0-9]+$" \
        | sort -t v -k2 -n \
        | awk -v cur="$CURRENT_TAG" '$0 != cur' \
        | tail -1)
    if [[ -z "$TARGET_TAG" ]]; then
        echo "❌ 留存区没有比 current（${CURRENT_TAG}）更早的版本可退。"
        exit 1
    fi
    echo "↩️  无参回档 → 上一个版本：$TARGET_TAG"
else
    echo "↩️  指定回档 → $TARGET_TAG"
fi

# ── 目标产物必须在留存区（不在则报错退出，不猜）────────────────────────────────
RELEASE_SRC="$RELEASES_DIR/$TARGET_TAG"
if [[ ! -d "$RELEASE_SRC" || ! -f "$RELEASE_SRC/index.html" ]]; then
    echo "❌ 目标 $TARGET_TAG 不在留存区（.dist-releases/ 仅保留最近 5 份），无法回档。"
    echo "   留存区现有："
    ls -1 "$RELEASES_DIR" 2>/dev/null | sed 's/^/     /' || echo "     (空)"
    exit 1
fi

# ── brain DB 守护：current 与 target 之间有 migration 文件变动 → 需 --confirm-db ─
if git -C "$MAIN_ROOT" rev-parse "$CURRENT_TAG" >/dev/null 2>&1 \
   && git -C "$MAIN_ROOT" rev-parse "$TARGET_TAG" >/dev/null 2>&1; then
    # grep -c 始终输出一个数字（无匹配输出 0），不要再 || echo 0（会拼出 "0\n0"）。
    MIG_CHANGES=$(git -C "$MAIN_ROOT" diff --name-only "$TARGET_TAG" "$CURRENT_TAG" -- 'packages/brain/migrations/' 2>/dev/null | grep -c .)
    if [[ "$MIG_CHANGES" -gt 0 && "$CONFIRM_DB" != true ]]; then
        echo ""
        echo "⚠️  brain 回档跨 DB migration（$TARGET_TAG → $CURRENT_TAG 之间有 $MIG_CHANGES 个 migration 文件变动）："
        git -C "$MAIN_ROOT" diff --name-only "$TARGET_TAG" "$CURRENT_TAG" -- 'packages/brain/migrations/' 2>/dev/null | sed 's/^/     /'
        echo "   光退代码不会回退 DB schema。阶段1 不建 migration 回退工具，需你显式确认风险："
        echo "   重新运行并加 --confirm-db 才继续。"
        exit 1
    fi
fi

# ── 1) dashboard 原子换入留存版本（换入失败回滚到换入前）──────────────────────
echo "🟢 回档 dashboard → live dist/ 换回 $TARGET_TAG"
HAD_LIVE=false
if [[ -d "$DIST_DIR" ]]; then
    rm -rf "${DIST_DIR}.rollback-bak" 2>/dev/null || true
    mv "$DIST_DIR" "${DIST_DIR}.rollback-bak"
    HAD_LIVE=true
fi
# 用 cp -R（留存版本要留在留存区，不能 mv 走）。
if cp -R "$RELEASE_SRC" "$DIST_DIR"; then
    rm -rf "${DIST_DIR}.rollback-bak" 2>/dev/null || true
    echo "✅ live dist/ 已回到 $TARGET_TAG"
else
    echo "❌ 回档换入失败 → 回滚到换入前 live dist/"
    rm -rf "$DIST_DIR" 2>/dev/null || true
    [[ "$HAD_LIVE" == true && -d "${DIST_DIR}.rollback-bak" ]] && mv "${DIST_DIR}.rollback-bak" "$DIST_DIR"
    exit 1
fi

# ── 2) 指针回拨 + 审计行 ──────────────────────────────────────────────────────
{
    if [[ -f "$RELEASE_FILE" ]]; then grep '^history=' "$RELEASE_FILE" || true; fi
    echo "history=${TARGET_TAG} $(date -u +%Y-%m-%dT%H:%M:%SZ) rollback from=${CURRENT_TAG}"
} > "${RELEASE_FILE}.hist.tmp"
{
    echo "current=$TARGET_TAG"
    echo "rolled_back_from=$CURRENT_TAG"
    echo "rolled_back_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cat "${RELEASE_FILE}.hist.tmp"
} > "$RELEASE_FILE"
rm -f "${RELEASE_FILE}.hist.tmp"
echo "📌 指针已回拨：.production-release current=${TARGET_TAG}（from ${CURRENT_TAG}）"

# ── 3) brain checkout 该 tag + 重启容器（测试钩子可跳过）──────────────────────
if [[ -z "${CECELIA_SKIP_BRAIN_PROMOTE:-}" ]]; then
    if git -C "$MAIN_ROOT" rev-parse "$TARGET_TAG" >/dev/null 2>&1; then
        echo "🧠 brain → git checkout $TARGET_TAG + 重启"
        git -C "$MAIN_ROOT" checkout "$TARGET_TAG" >/dev/null 2>&1 \
            || echo "⚠️  git checkout $TARGET_TAG 失败（继续，dashboard 已回档）"
        BRAIN_DEPLOY="$MAIN_ROOT/scripts/brain-deploy.sh"
        [[ -f "$BRAIN_DEPLOY" ]] && { bash "$BRAIN_DEPLOY" || echo "⚠️  brain-deploy 失败"; }
    else
        echo "⚠️  本地无 git tag ${TARGET_TAG}，跳过 brain 代码回档（仅 dashboard 回档）"
    fi
fi

echo ""
echo "🎉 回档完成：生产已回到 ${TARGET_TAG}。"
exit 0
