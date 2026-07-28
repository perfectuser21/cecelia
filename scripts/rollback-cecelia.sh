#!/usr/bin/env bash
# rollback-cecelia.sh — Cecelia 生产一键回档（部署生命周期 阶段1 / spec §1 回档契约）
#
# 生产炸了之后用这条命令秒回上一个发布版本（或指定留存版本）。回档动作 = 三件事原子完成：
#   1) dashboard：把 live dist/ 换回留存区 .dist-releases/<tag>/（换入失败回滚到换入前）
#   2) brain：复用 brain-rollback.sh <镜像版本>（image-tag 账本回退，跨 DB migration 需 --confirm-db）
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

# Legacy all-in-one rollback is retained only as a primitive. It cannot run
# with a forward production intent or a deploy token alone.
bash "$SCRIPT_DIR/lib/release-run-rollback-guard.sh" || exit $?

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
BRAIN_VERSIONS_FILE="$MAIN_ROOT/.brain-versions"  # brain 镜像版本账本（brain-rollback.sh 的 SSOT）
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

# ── brain 镜像版本 pre-flight（清单法）：从 target 的 manifest 查 brain_image ──────
# 收口设计：统一 tag 是清单，brain 回档委托给现有 brain-rollback.sh（image-tag 账本回退），
# 不再 git checkout 重建。这里先校验目标镜像版本仍在 .brain-versions 账本里——若已被 prune
# 出账本 → 报错退出（不偷偷 git 重建，与"不在留存内就报错不猜"一致）。校验在动 dashboard
# 之前做，保证失败时生产/指针均不动。
TARGET_BRAIN_IMAGE=""
MANIFEST_LINE=$(grep "^manifest=${TARGET_TAG} " "$RELEASE_FILE" 2>/dev/null | tail -1)
if [[ -n "$MANIFEST_LINE" ]]; then
    # 从 "manifest=<tag> brain_image=<ver> ..." 抠出 brain_image
    for kv in $MANIFEST_LINE; do
        case "$kv" in brain_image=*) TARGET_BRAIN_IMAGE="${kv#brain_image=}" ;; esac
    done
fi
if [[ -z "${CECELIA_SKIP_BRAIN_PROMOTE:-}" ]]; then
    if [[ -z "$TARGET_BRAIN_IMAGE" ]]; then
        echo "❌ ${TARGET_TAG} 的 manifest 没记 brain_image（旧 promote 产生的 release？），无法安全回档 brain。"
        echo "   生产/指针未动。如只需回 dashboard，可加 --confirm-db 跳过 brain（阶段2 再补）。"
        [[ "$CONFIRM_DB" != true ]] && exit 1
    elif [[ -f "$BRAIN_VERSIONS_FILE" ]] \
         && ! grep -qxF "$TARGET_BRAIN_IMAGE" "$BRAIN_VERSIONS_FILE"; then
        echo "❌ 目标 brain 镜像版本 ${TARGET_BRAIN_IMAGE} 已不在 .brain-versions 账本（被 prune）。"
        echo "   brain-rollback.sh 无法回退到不在账本/无本地镜像的版本。生产/指针未动，报错退出（不偷偷 git 重建）。"
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
# 关键：必须保留 manifest= 行（各 vN 的 brain_image 清单），否则回档后该 tag 的清单丢失，
# 下次再回档它就查不到 brain_image。history= 同样保留追加。
{
    if [[ -f "$RELEASE_FILE" ]]; then grep '^manifest=' "$RELEASE_FILE" || true; fi
} > "${RELEASE_FILE}.mani.tmp"
{
    if [[ -f "$RELEASE_FILE" ]]; then grep '^history=' "$RELEASE_FILE" || true; fi
    echo "history=${TARGET_TAG} $(date -u +%Y-%m-%dT%H:%M:%SZ) rollback from=${CURRENT_TAG}"
} > "${RELEASE_FILE}.hist.tmp"
{
    echo "current=$TARGET_TAG"
    echo "rolled_back_from=$CURRENT_TAG"
    echo "rolled_back_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cat "${RELEASE_FILE}.mani.tmp"
    cat "${RELEASE_FILE}.hist.tmp"
} > "$RELEASE_FILE"
rm -f "${RELEASE_FILE}.hist.tmp" "${RELEASE_FILE}.mani.tmp"
echo "📌 指针已回拨：.production-release current=${TARGET_TAG}（from ${CURRENT_TAG}）"

# ── 3) brain 回档：复用现有 brain-rollback.sh（image-tag 账本回退，非 git checkout）──
# 清单法：从 target manifest 拿 brain_image（pre-flight 已校验它在 .brain-versions），
# 委托 brain-rollback.sh <该镜像版本> 换镜像 + 健康检查。cecelia 只有一套 brain 回档原语。
if [[ -z "${CECELIA_SKIP_BRAIN_PROMOTE:-}" ]]; then
    if [[ -n "$TARGET_BRAIN_IMAGE" ]]; then
        BRAIN_ROLLBACK="$MAIN_ROOT/scripts/brain-rollback.sh"
        if [[ -f "$BRAIN_ROLLBACK" ]]; then
            echo "🧠 brain → brain-rollback.sh ${TARGET_BRAIN_IMAGE}（复用现有原语，换镜像+健康检查）"
            bash "$BRAIN_ROLLBACK" "$TARGET_BRAIN_IMAGE" \
                || echo "⚠️  brain-rollback.sh 失败（dashboard 已回档，brain 保持原状）"
        else
            echo "⚠️  scripts/brain-rollback.sh 不存在，跳过 brain 回档（仅 dashboard 回档）"
        fi
    else
        echo "⚠️  无 brain_image（manifest 缺失，--confirm-db 已放行）→ 跳过 brain 回档，仅 dashboard 回档"
    fi
fi

echo ""
echo "🎉 回档完成：生产已回到 ${TARGET_TAG}。"
exit 0
