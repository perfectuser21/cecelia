#!/usr/bin/env bash
# promote-dashboard.sh — Cecelia dashboard「人工放行」步骤
#
# deploy-local.sh 把新版本停在 staging（perfect21:52xx 私密预览）+ 写 .staging-pending 标记后，
# 主理人开 staging 看一眼满意 → 手动跑本脚本，才把新版本 promote 到生产：
#   · 原子换入本机 live dist/（OrbStack 容器挂载 → perfect21:5211 立即生效）
# 然后停掉常驻 staging 服务、清掉放行标记 + 通知（防重复 promote）。
#
# Cecelia 是单实例内部工具（唯一用户=主理人），只更新本机 5211，不同步 HK/Tailscale。
# 没有 .staging-pending（没东西待放行）→ 拒绝运行，避免误把陈旧/不存在的产物推上生产。
#
# 用法：
#   bash scripts/promote-dashboard.sh
#
# 退出码： 0=promote 成功  1=无待放行 / promote 失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 部署根：测试钩子 CECELIA_DEPLOY_ROOT 优先，否则按 worktree/主仓库解析（与 deploy-local.sh 一致）
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
STAGING_DIST="$DASH_DIR/.dist-staging"
PENDING_FILE="$DASH_DIR/.staging-pending"
SLOT_PID_FILE="$DASH_DIR/.staging-slot.pid"
SLOT_LOG_FILE="$DASH_DIR/.staging-slot.log"

# ── 部署生命周期 阶段1（spec §1 共享契约）──────────────────────────────────────
# promote 成功强制三件事一起做：打 tag + 存旧版（留 5 份，不删）+ 记指针。
RELEASES_DIR="$DASH_DIR/.dist-releases"       # 旧 dist/ 留存区（产物，不进 git）
RELEASE_FILE="$MAIN_ROOT/.production-release" # 指针 + 历史（git 跟踪）
RETAIN_N=5                                     # 留存份数上限
TAG_PREFIX="prod-cecelia-v"

# 算下一个单调递增 tag 号：取 .production-release current 与本地 git tag 的 max + 1。
next_release_tag() {
    local max=0 n t
    if [[ -f "$RELEASE_FILE" ]]; then
        n=$(grep '^current=' "$RELEASE_FILE" | head -1 | cut -d= -f2 | sed "s/^${TAG_PREFIX}//")
        [[ "$n" =~ ^[0-9]+$ ]] && (( n > max )) && max=$n
    fi
    while IFS= read -r t; do
        n="${t#"$TAG_PREFIX"}"
        [[ "$n" =~ ^[0-9]+$ ]] && (( n > max )) && max=$n
    done < <(git -C "$MAIN_ROOT" tag -l "${TAG_PREFIX}*" 2>/dev/null)
    echo "${TAG_PREFIX}$((max + 1))"
}

# 留存区只保留最近 RETAIN_N 份（按版本号升序，删最旧）。
# 不用 mapfile/readarray（macOS 自带 bash 3.2 无此内建）。
prune_releases() {
    local sorted count drop t
    sorted=$(ls -1 "$RELEASES_DIR" 2>/dev/null \
        | grep -E "^${TAG_PREFIX}[0-9]+$" \
        | sort -t v -k2 -n)
    [[ -z "$sorted" ]] && return 0
    count=$(printf '%s\n' "$sorted" | grep -c .)
    drop=$((count - RETAIN_N))
    (( drop <= 0 )) && return 0
    # 删最旧的 drop 个（排序后取前 drop 行）。
    printf '%s\n' "$sorted" | head -n "$drop" | while IFS= read -r t; do
        [[ -n "$t" ]] && rm -rf "${RELEASES_DIR:?}/$t"
    done
}

echo "=== Cecelia Dashboard 人工放行 promote ==="
echo "  部署根: $MAIN_ROOT"
echo ""

# ── 前置：必须有待放行的 staging ──────────────────────────────────────────────
if [[ ! -f "$PENDING_FILE" ]]; then
    echo "❌ 无 .staging-pending —— 没有待放行的 staging。"
    echo "   先跑一次 dashboard 部署（deploy-local.sh）把新版本停到 staging，再回来放行。"
    exit 1
fi

# 读放行标记（staging_dist / staging_port / slot_pid）
STAGED_DIST=""; STAGED_PORT=""; STAGED_PID=""
while IFS='=' read -r k v; do
    case "$k" in
        staging_dist) STAGED_DIST="$v" ;;
        staging_port) STAGED_PORT="$v" ;;
        slot_pid)     STAGED_PID="$v" ;;
    esac
done < "$PENDING_FILE"
[[ -z "$STAGED_DIST" ]] && STAGED_DIST="$STAGING_DIST"

echo "📋 待放行：$STAGED_DIST"
sed 's/^/   /' "$PENDING_FILE"
echo ""

if [[ ! -d "$STAGED_DIST" || ! -f "$STAGED_DIST/index.html" ]]; then
    echo "❌ 待放行的 staging 产物不存在或残缺：$STAGED_DIST"
    echo "   放行标记已失效，重新跑一次 dashboard 部署。"
    exit 1
fi

# ── 1) 算本次生产 release tag（dashboard + brain 共用一个统一 tag）─────────────
RELEASE_TAG="$(next_release_tag)"
echo "🏷️  本次生产 release tag：$RELEASE_TAG"

# ── 2) 原子换入本机 live dist/（perfect21:5211 立即生效）+ 旧版留存（不删）──────
# 先把旧 live dist/ 移到 dist.old 临时备份，rename staging→dist。
# 成功后旧版【挪进留存区】（不再 rm -rf，这是回档安全网）；失败回滚。
echo "🟢 Promote → 原子换入本机 live dist/（5211）"
HAD_OLD=false
if [[ -d "$DIST_DIR" ]]; then
    rm -rf "${DIST_DIR}.old" 2>/dev/null || true
    mv "$DIST_DIR" "${DIST_DIR}.old"
    HAD_OLD=true
fi
if mv "$STAGED_DIST" "$DIST_DIR"; then
    if [[ "$HAD_OLD" == true ]]; then
        # 旧版按【上一个 tag】名挪进留存区，保留最近 5 份（绝不删）。
        OLD_TAG=""
        [[ -f "$RELEASE_FILE" ]] && OLD_TAG=$(grep '^current=' "$RELEASE_FILE" | head -1 | cut -d= -f2)
        mkdir -p "$RELEASES_DIR"
        if [[ -n "$OLD_TAG" ]]; then
            rm -rf "${RELEASES_DIR:?}/$OLD_TAG"
            mv "${DIST_DIR}.old" "$RELEASES_DIR/$OLD_TAG"
            echo "📦 旧版已留存：.dist-releases/$OLD_TAG"
        else
            # 没有指针历史（首次 promote 前已有 live dist/）→ 用 pre-<tag> 占位留存，不丢。
            rm -rf "${RELEASES_DIR:?}/pre-$RELEASE_TAG"
            mv "${DIST_DIR}.old" "$RELEASES_DIR/pre-$RELEASE_TAG"
            echo "📦 旧版（无指针历史）已留存：.dist-releases/pre-$RELEASE_TAG"
        fi
        prune_releases
    fi
    echo "✅ 本机 5211 已指向新版本"
else
    echo "❌ Promote 换入失败，回滚 live dist/"
    [[ "$HAD_OLD" == true && -d "${DIST_DIR}.old" ]] && mv "${DIST_DIR}.old" "$DIST_DIR"
    exit 1
fi
echo ""

# ── 3) 打统一生产 tag + 写指针 .production-release（spec §1）────────────────────
PROMOTE_COMMIT=$(git -C "$MAIN_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)
if [[ -z "${CECELIA_SKIP_GIT_TAG:-}" ]]; then
    git -C "$MAIN_ROOT" tag -f "$RELEASE_TAG" "$PROMOTE_COMMIT" >/dev/null 2>&1 \
        && echo "🏷️  已打 git tag $RELEASE_TAG → ${PROMOTE_COMMIT:0:8}" \
        || echo "⚠️  git tag $RELEASE_TAG 失败（非 git 环境？继续，指针仍写）"
fi
# 指针：current 覆盖、history 追加（不覆盖）。
{
    if [[ -f "$RELEASE_FILE" ]]; then grep '^history=' "$RELEASE_FILE" || true; fi
    echo "history=${RELEASE_TAG} $(date -u +%Y-%m-%dT%H:%M:%SZ) promote commit=${PROMOTE_COMMIT:0:8}"
} > "${RELEASE_FILE}.hist.tmp"
{
    echo "current=$RELEASE_TAG"
    echo "commit=$PROMOTE_COMMIT"
    echo "promoted_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cat "${RELEASE_FILE}.hist.tmp"
} > "$RELEASE_FILE"
rm -f "${RELEASE_FILE}.hist.tmp"
echo "📌 指针已更新：.production-release current=$RELEASE_TAG"

# ── 4) brain 也到该版（git checkout tag + 重启容器）；测试钩子可跳过 ────────────
if [[ -z "${CECELIA_SKIP_BRAIN_PROMOTE:-}" ]]; then
    BRAIN_DEPLOY="$MAIN_ROOT/scripts/brain-deploy.sh"
    if [[ -f "$BRAIN_DEPLOY" ]]; then
        echo "🧠 brain → 重启到 $RELEASE_TAG"
        bash "$BRAIN_DEPLOY" || echo "⚠️  brain-deploy 失败（dashboard 已上线，brain 保持原状）"
    fi
fi
echo ""

# ── 5) 停常驻 staging 服务 + 清放行标记/通知（防重复 promote）──────────────────
# 注：Cecelia 是单实例内部工具（唯一用户=主理人），只更新本机 5211，不再同步 HK。
if [[ -n "$STAGED_PID" ]]; then
    kill "$STAGED_PID" 2>/dev/null || true
fi
if [[ -f "$SLOT_PID_FILE" ]]; then
    kill "$(cat "$SLOT_PID_FILE" 2>/dev/null)" 2>/dev/null || true
    rm -f "$SLOT_PID_FILE"
fi
rm -f "$PENDING_FILE" "$SLOT_LOG_FILE" "$DASH_DIR/.staging-notify.log" 2>/dev/null || true

echo "🎉 放行完成：本机 5211 已上线新版本，staging 已停、标记已清。"
exit 0
