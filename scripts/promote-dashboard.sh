#!/usr/bin/env bash
# promote-dashboard.sh — Cecelia dashboard 放行（release → deploy 两阶段）
#
# 三模式（产物库 .dist-releases/<tag> = 唯一真相源；deploy 与 rollback 都从它 cp 到 live）：
#   --release-only        冻结验过的 staging 产物进 .dist-releases/<vX> + 打 git tag vX +
#                         登记 manifest（不动 live、不动 current、不动 brain）。stdout 输出 RELEASE_TAG=<vX>。
#   --deploy <vX>         从 .dist-releases/<vX> 原子换入 live dist/（5211）+ 旧版留存 + 写 current +
#                         brain-deploy + 停 staging。源不在库 → 报错退（不猜，与 rollback 一致）。
#   (无参)                = release-only 取 tag → deploy <tag>（向后兼容，手动用）。
#
# deploy-local.sh 把新版本停在 staging + 写 .staging-pending 后，主理人/harness 跑本脚本放行。
# 没有 .staging-pending（release/full 模式）→ 拒绝运行，避免误推陈旧产物。
# deploy 模式会同步 HK（hk-vps:/opt/cecelia/frontend/dist）并做部署终验（sha 对账）。
# HK 失败/终验红：本机不回滚（已原子换入），退出非零 = "本机已上线但对账红"。
#
# 退出码： 0=成功  1=无待放行 / 源缺失 / 失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Forward promotion and rollback have disjoint durable authorities.
if [[ "${1:-}" == "--rollback" ]]; then
    bash "$SCRIPT_DIR/lib/release-run-rollback-guard.sh" || exit $?
else
    bash "$SCRIPT_DIR/lib/release-run-guard.sh" production || exit $?
fi

# 部署根：测试钩子 CECELIA_DEPLOY_ROOT 优先，否则按 worktree/主仓库解析（与 deploy-local.sh 一致）
if [[ -n "${KERNEL_RELEASE_DEPLOY_ROOT:-}" ]]; then
    MAIN_ROOT="$(cd "$KERNEL_RELEASE_DEPLOY_ROOT" && pwd)"
elif [[ -n "${CECELIA_DEPLOY_ROOT:-}" ]]; then
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

# ── 部署生命周期（spec §1 共享契约）──────────────────────────────────────────────
RELEASES_DIR="$DASH_DIR/.dist-releases"       # 产物库（release 冻结 + 旧版留存；产物，不进 git）
RELEASE_FILE="$MAIN_ROOT/.production-release" # 指针 + 历史 + manifest（git 跟踪）
BRAIN_VERSIONS_FILE="$MAIN_ROOT/.brain-versions" # brain 镜像版本账本（brain-rollback.sh 的 SSOT）
ROLLBACK_DIR="$MAIN_ROOT/logs/release-rollbacks/dashboard"
ROLLBACK_IMMUTABLE_SOURCE=""
RETAIN_N=5                                     # 留存份数上限
TAG_PREFIX="prod-cecelia-v"

dashboard_build_sha() {
    node -e '
      const fs = require("fs");
      const path = require("path");
      try {
        const value = JSON.parse(fs.readFileSync(
          path.join(process.argv[1], "build-info.json"),
          "utf8",
        ));
        process.stdout.write(typeof value.git_sha === "string" ? value.git_sha : "");
      } catch {}
    ' "$1" 2>/dev/null || true
}

assert_forward_dashboard_identity() {
    local root="$1"
    local actual_digest actual_sha
    [[ -d "$root" && -f "$root/index.html" \
      && "${STAGED_COMMIT:-}" =~ ^[0-9a-f]{40}$ \
      && "${STAGED_DEPLOYED_DIGEST:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
    actual_digest=$(node "$SCRIPT_DIR/lib/release-run-tree-digest-cli.mjs" \
      "$root") || return 1
    actual_sha=$(dashboard_build_sha "$root")
    [[ "$actual_digest" == "$STAGED_DEPLOYED_DIGEST" \
      && "$actual_sha" == "$STAGED_COMMIT" ]]
}

stop_verified_staging_slot() {
    local identity staging_slot_host
    [[ "${STAGED_PORT:-}" =~ ^[1-9][0-9]*$ \
      && "${STAGED_PID:-}" =~ ^[1-9][0-9]*$ \
      && "${STAGED_SLOT_NONCE:-}" =~ ^[0-9a-f]{64}$ \
      && "${STAGED_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] || return 1
    staging_slot_host=$(BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" \
      node -e '
        try {
          process.stdout.write(new URL(process.env.BRAIN_URL).hostname);
        } catch {}
      ')
    [[ "$staging_slot_host" =~ ^[A-Za-z0-9.-]+$ ]] || {
        echo "⚠️  staging slot host invalid; refusing slot shutdown"
        return 1
    }
    identity=$(curl -sf --max-time 2 \
      -H "X-Cecelia-Slot-Nonce: ${STAGED_SLOT_NONCE}" \
      -H "X-Cecelia-Slot-Commit: ${STAGED_COMMIT}" \
      "http://${staging_slot_host}:${STAGED_PORT}/.cecelia-staging-identity" \
      2>/dev/null) || {
        echo "⚠️  staging slot identity unavailable; refusing slot shutdown"
        return 1
    }
    if STAGING_IDENTITY_JSON="$identity" \
      EXPECTED_STAGING_PID="$STAGED_PID" \
      EXPECTED_STAGING_NONCE="$STAGED_SLOT_NONCE" \
      EXPECTED_STAGING_COMMIT="$STAGED_COMMIT" \
      node -e '
        const value = JSON.parse(process.env.STAGING_IDENTITY_JSON);
        if (
          String(value.pid) !== process.env.EXPECTED_STAGING_PID
          || value.nonce !== process.env.EXPECTED_STAGING_NONCE
          || value.commit !== process.env.EXPECTED_STAGING_COMMIT
        ) process.exit(1);
      ' >/dev/null 2>&1; then
        if ! curl -sf --max-time 2 -X POST \
          -H "X-Cecelia-Slot-Nonce: ${STAGED_SLOT_NONCE}" \
          -H "X-Cecelia-Slot-Commit: ${STAGED_COMMIT}" \
          "http://${staging_slot_host}:${STAGED_PORT}/.cecelia-staging-shutdown" \
          -o /dev/null; then
            echo "⚠️  verified staging slot refused owned shutdown"
            return 1
        fi
        return 0
    else
        echo "⚠️  staging slot identity mismatch; refusing slot shutdown"
        return 1
    fi
}

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
    printf '%s\n' "$sorted" | head -n "$drop" | while IFS= read -r t; do
        [[ -n "$t" ]] && rm -rf "${RELEASES_DIR:?}/$t"
    done
}

# 读 .staging-pending（release/full 用）→ STAGED_DIST/PORT/PID。
read_staged() {
    STAGED_DIST=""; STAGED_PORT=""; STAGED_PID=""
    if [[ ! -f "$PENDING_FILE" ]]; then
        echo "❌ 无 .staging-pending —— 没有待放行的 staging。"
        echo "   先跑一次 dashboard 部署（deploy-local.sh）把新版本停到 staging，再回来放行。"
        exit 1
    fi
    local sealed
    sealed=$(RELEASE_DASHBOARD_PENDING_FILE="$PENDING_FILE" \
      RELEASE_DASHBOARD_STAGING_ROOT="$STAGING_DIST" \
      RELEASE_DASHBOARD_SEAL_PARENT="$DASH_DIR" \
      node "$SCRIPT_DIR/lib/release-run-dashboard-stage-seal.mjs") || {
        echo "❌ Dashboard release blocked: staged artifact identity mismatch" >&2
        exit 78
    }
    IFS=$'\t' read -r STAGED_SEALED_ROOT STAGED_PORT STAGED_PID STAGED_SLOT_NONCE \
      STAGED_COMMIT \
      STAGED_ARTIFACT_NAME STAGED_ARTIFACT_VERSION STAGED_SOURCE_DIGEST \
      STAGED_DEPLOYED_DIGEST <<< "$sealed"
    [[ "$STAGED_SEALED_ROOT" == "$DASH_DIR"/.staging-sealed-* \
      && -d "$STAGED_SEALED_ROOT" \
      && "$STAGED_COMMIT" == "$KERNEL_RELEASE_MERGE_SHA" \
      && "$STAGED_ARTIFACT_NAME" == "workspace" \
      && "$STAGED_ARTIFACT_VERSION" == "$KERNEL_RELEASE_ARTIFACT_VERSION" \
      && "$STAGED_SOURCE_DIGEST" == "$KERNEL_RELEASE_ARTIFACT_DIGEST" ]] || {
        echo "❌ Dashboard release blocked: sealed artifact invalid" >&2
        exit 78
    }
    STAGED_DIST="$STAGED_SEALED_ROOT"
    trap 'rm -rf "$STAGED_SEALED_ROOT"' EXIT
}

# 写 manifest= + history=（release 阶段登记本版构成；不动 current/commit/promoted_at）。
write_release_manifest() {
    local tag="$1" commit="$2" brain_image="$3"
    {
        if [[ -f "$RELEASE_FILE" ]]; then grep -vE '^(manifest='"$tag"' |history='"$tag"' )' "$RELEASE_FILE" || true; fi
        echo "manifest=${tag} brain_image=${brain_image} dashboard_release=${tag} commit=${commit:0:8}"
        echo "history=${tag} $(date -u +%Y-%m-%dT%H:%M:%SZ) release commit=${commit:0:8}"
    } > "${RELEASE_FILE}.tmp"
    mv "${RELEASE_FILE}.tmp" "$RELEASE_FILE"
}

# ── release 阶段：冻结验过的产物进库 + 打 tag + 登记 manifest（不动 live/current/brain）──
do_release() {
    read_staged
    local RELEASE_TAG PROMOTE_COMMIT BRAIN_IMAGE
    RELEASE_TAG="$(next_release_tag)"
    RELEASE_TAG_RESULT="$RELEASE_TAG"
    echo "🏷️  release tag：$RELEASE_TAG"

    mkdir -p "$RELEASES_DIR"
    rm -rf "${RELEASES_DIR:?}/$RELEASE_TAG"
    if ! cp -R "$STAGED_DIST" "$RELEASES_DIR/$RELEASE_TAG"; then
        echo "❌ 冻结产物进库失败：$RELEASES_DIR/$RELEASE_TAG"
        exit 1
    fi
    if ! assert_forward_dashboard_identity "$RELEASES_DIR/$RELEASE_TAG"; then
        rm -rf "${RELEASES_DIR:?}/$RELEASE_TAG"
        echo "❌ Dashboard release blocked: frozen artifact identity mismatch" >&2
        exit 78
    fi
    echo "📦 已冻结验过的产物 → .dist-releases/${RELEASE_TAG}（不可变 release）"

    PROMOTE_COMMIT="${STAGED_COMMIT:-}"
    [[ "$PROMOTE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
        echo "❌ Dashboard release blocked: exact merge SHA unavailable" >&2
        exit 78
    }
    if [[ -z "${CECELIA_SKIP_GIT_TAG:-}" ]]; then
        git -C "$MAIN_ROOT" tag -f "$RELEASE_TAG" "$PROMOTE_COMMIT" >/dev/null 2>&1 \
            && echo "🏷️  已打 git tag $RELEASE_TAG → ${PROMOTE_COMMIT:0:8}" \
            || echo "⚠️  git tag $RELEASE_TAG 失败（非 git 环境？继续）"
    fi
    BRAIN_IMAGE=""
    if [[ -f "$BRAIN_VERSIONS_FILE" ]]; then
        BRAIN_IMAGE=$(grep -E '.' "$BRAIN_VERSIONS_FILE" | tail -1 | tr -d '[:space:]')
    fi
    write_release_manifest "$RELEASE_TAG" "$PROMOTE_COMMIT" "$BRAIN_IMAGE"
    echo "📌 已登记 release manifest=${RELEASE_TAG}（brain_image=${BRAIN_IMAGE:-none}，current 未动）"
    prune_releases
    # 供 full 模式 / 调用方解析
    echo "RELEASE_TAG=$RELEASE_TAG"
}

# ── deploy 阶段：从产物库把 <tag> 原子换入 live 5211 + 旧版留存 + 写 current + brain-deploy + 停 staging ──
do_deploy() {
    local tag="$1"
    local rollback_mode="${2:-0}"
    local SRC="$RELEASES_DIR/$tag"
    if [[ ! -d "$SRC" || ! -f "$SRC/index.html" ]]; then
        echo "❌ 部署源 $tag 不在产物库 .dist-releases/（先 release 或指定已存在的 tag），无法部署。"
        ls -1 "$RELEASES_DIR" 2>/dev/null | sed 's/^/     /' || true
        exit 1
    fi
    if [[ "$rollback_mode" == "1" ]]; then
        local expected_digest="${KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST:-}"
        local target_merge_sha="${KERNEL_RELEASE_ROLLBACK_TARGET_MERGE_SHA:-}"
        local immutable_source="$RELEASES_DIR/.rollback-source.$$"
        [[ "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ \
           && "$target_merge_sha" =~ ^[0-9a-f]{40}$ ]] || {
            echo "❌ Dashboard rollback blocked: exact target identity unavailable" >&2
            exit 78
        }
        rm -rf "$immutable_source"
        cp -R "$SRC" "$immutable_source" || {
            rm -rf "$immutable_source"
            echo "❌ Dashboard rollback blocked: target snapshot failed" >&2
            exit 78
        }
        local snapshot_digest
        snapshot_digest=$(node "$SCRIPT_DIR/lib/release-run-tree-digest-cli.mjs" \
            "$immutable_source") || {
            rm -rf "$immutable_source"
            exit 78
        }
        [[ "$snapshot_digest" == "$expected_digest" ]] || {
            rm -rf "$immutable_source"
            echo "❌ Dashboard rollback blocked: retained target digest mismatch" >&2
            exit 78
        }
        SRC="$immutable_source"
        ROLLBACK_IMMUTABLE_SOURCE="$immutable_source"
        trap 'if [[ -n "${ROLLBACK_IMMUTABLE_SOURCE:-}" ]]; then rm -rf "$ROLLBACK_IMMUTABLE_SOURCE"; fi' EXIT
    fi
    echo "🟢 Deploy → 从产物库原子换入本机 live dist/（5211）：$tag"

    local PROMOTE_FAIL=0
    local OLD_TAG="" OLD_COMMIT="" HAD_OLD=false
    local DEPLOY_COMMIT
    [[ -f "$RELEASE_FILE" ]] && OLD_TAG=$(grep '^current=' "$RELEASE_FILE" | head -1 | cut -d= -f2)
    [[ -f "$RELEASE_FILE" ]] && OLD_COMMIT=$(grep '^commit=' "$RELEASE_FILE" | head -1 | cut -d= -f2)
    if [[ ! "$OLD_TAG" =~ ^${TAG_PREFIX}[0-9]+$ ]]; then
        echo "❌ Dashboard promotion blocked: exact OLD_TAG unavailable" >&2
        exit 78
    fi
    if [[ "$rollback_mode" == "1" ]]; then
        DEPLOY_COMMIT="${KERNEL_RELEASE_ROLLBACK_TARGET_MERGE_SHA:-}"
        local expected_current_digest="${KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:-}"
        local expected_current_version="${KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_VERSION:-}"
        local expected_current_merge_sha="${KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_MERGE_SHA:-}"
        local actual_current_digest=""
        [[ -d "$DIST_DIR" ]] && actual_current_digest=$(
            node "$SCRIPT_DIR/lib/release-run-tree-digest-cli.mjs" "$DIST_DIR"
        )
        [[ "$expected_current_digest" =~ ^sha256:[0-9a-f]{64}$ \
           && "$expected_current_version" =~ ^${TAG_PREFIX}[0-9]+$ \
           && "$expected_current_merge_sha" =~ ^[0-9a-f]{40}$ \
           && "$OLD_TAG" == "$expected_current_version" \
           && "$OLD_COMMIT" == "$expected_current_merge_sha" \
           && "$actual_current_digest" == "$expected_current_digest" ]] || {
            echo "❌ Dashboard rollback blocked: current production CAS mismatch" >&2
            exit 78
        }
    else
        DEPLOY_COMMIT="${STAGED_COMMIT:-${KERNEL_RELEASE_MERGE_SHA:-}}"
        if ! assert_forward_dashboard_identity "$SRC"; then
            echo "❌ Dashboard promotion blocked: release artifact identity mismatch" >&2
            exit 78
        fi
    fi
    [[ "$DEPLOY_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
        echo "❌ Dashboard promotion blocked: exact merge SHA unavailable" >&2
        exit 78
    }
    if [[ -d "$DIST_DIR" ]]; then
        rm -rf "${DIST_DIR}.old" 2>/dev/null || true
        mv "$DIST_DIR" "${DIST_DIR}.old"
        HAD_OLD=true
    fi
    # cp -R（库版本要留在库里，不能 mv 走）。
    if cp -R "$SRC" "$DIST_DIR"; then
        if [[ "$rollback_mode" != "1" ]] \
          && ! assert_forward_dashboard_identity "$DIST_DIR"; then
            echo "❌ Dashboard promotion blocked: live artifact identity mismatch" >&2
            rm -rf "$DIST_DIR" 2>/dev/null || true
            [[ "$HAD_OLD" == true && -d "${DIST_DIR}.old" ]] \
              && mv "${DIST_DIR}.old" "$DIST_DIR"
            exit 78
        fi
        if [[ "$HAD_OLD" == true ]]; then
            mkdir -p "$RELEASES_DIR"
            rm -rf "${RELEASES_DIR:?}/$OLD_TAG"
            mv "${DIST_DIR}.old" "$RELEASES_DIR/$OLD_TAG"
            echo "📦 旧版已留存：.dist-releases/$OLD_TAG"
            prune_releases
        fi
        echo "✅ 本机 5211 已指向 $tag"
    else
        echo "❌ Deploy 换入失败，回滚 live dist/"
        rm -rf "$DIST_DIR" 2>/dev/null || true
        [[ "$HAD_OLD" == true && -d "${DIST_DIR}.old" ]] && mv "${DIST_DIR}.old" "$DIST_DIR"
        exit 1
    fi

    # 写指针：current/commit/promoted_at 覆盖；manifest/history（release 已写）保留。
    {
        echo "current=$tag"
        echo "commit=$DEPLOY_COMMIT"
        echo "promoted_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        if [[ -f "$RELEASE_FILE" ]]; then grep -E '^(manifest=|history=)' "$RELEASE_FILE" || true; fi
    } > "${RELEASE_FILE}.tmp"
    mv "${RELEASE_FILE}.tmp" "$RELEASE_FILE"
    echo "📌 指针已更新：.production-release current=${tag}"

    # brain 也到该版（git checkout tag + 重启容器）；测试/接缝钩子可跳过。
    if [[ -z "${CECELIA_SKIP_BRAIN_PROMOTE:-}" ]]; then
        local BRAIN_DEPLOY="$MAIN_ROOT/scripts/brain-deploy.sh"
        if [[ -f "$BRAIN_DEPLOY" ]]; then
            echo "🧠 brain → 重启到 $tag"
            bash "$BRAIN_DEPLOY" || echo "⚠️  brain-deploy 失败（dashboard 已上线，brain 保持原状）"
        fi
    fi

    # 停常驻 staging 服务 + 清放行标记/通知（防重复 promote）。
    if stop_verified_staging_slot; then
        rm -f "$SLOT_PID_FILE" "$PENDING_FILE" "$SLOT_LOG_FILE" \
          "$DASH_DIR/.staging-notify.log" 2>/dev/null || true
    else
        echo "⚠️  staging slot authority retained for verified cleanup on next deploy"
    fi

    # ── HK 同步：rsync 本机 live dist → HK /opt/cecelia/frontend/dist/ ───────────
    if [[ -z "${CECELIA_SKIP_HK:-}" ]]; then
        echo "🌏 同步 HK（hk-vps）..."
        local HK_DEST="hk-vps:/opt/cecelia/frontend/dist/"
        if rsync -az --delete -e "ssh -o ConnectTimeout=10" "$DIST_DIR/" "$HK_DEST" 2>&1; then
            echo "✅ HK 已同步：$HK_DEST"
        else
            echo "❌ HK rsync 失败（本机 5211 已上线不回滚；Bark 由下方指纹校验兜底发）"
            PROMOTE_FAIL=1
        fi
    fi

    # ── 部署后终验：build-info sha 对账（优先）/ index hash（回退）────────────
    if [[ -z "${CECELIA_SKIP_FINGERPRINT:-}" ]]; then
        local FP_SCRIPT="$MAIN_ROOT/scripts/check-deploy-fingerprint.sh"
        if [[ -f "$FP_SCRIPT" ]]; then
            local EXPECTED_SHA=""
            if [[ -f "$DIST_DIR/build-info.json" ]]; then
                EXPECTED_SHA=$(node -e "let s=require('fs').readFileSync('$DIST_DIR/build-info.json','utf8');try{process.stdout.write(JSON.parse(s).git_sha||'')}catch{process.stdout.write('')}" 2>/dev/null || echo "")
            fi
            if ! EXPECTED_GIT_SHA="$EXPECTED_SHA" bash "$FP_SCRIPT"; then
                echo "❌ 部署终验失败（见上方报告）"
                PROMOTE_FAIL=1
            fi
        fi
    fi

    if [[ "$PROMOTE_FAIL" == "1" ]]; then
        echo "🔴 deploy 结束：本机 5211 已上线 ${tag}，但 HK 同步/终验对账红（见上方）——退出非零"
        exit 1
    fi
    if [[ "$rollback_mode" != "1" ]]; then
        KERNEL_RELEASE_MERGE_SHA="$DEPLOY_COMMIT" \
        KERNEL_RELEASE_ARTIFACT_VERSION="${STAGED_ARTIFACT_VERSION:-${KERNEL_RELEASE_ARTIFACT_VERSION:-}}" \
        KERNEL_RELEASE_ARTIFACT_DIGEST="${STAGED_SOURCE_DIGEST:-${KERNEL_RELEASE_ARTIFACT_DIGEST:-}}" \
        KERNEL_RELEASE_ARTIFACT_DEPLOYED_DIGEST="${STAGED_DEPLOYED_DIGEST:-}" \
        RELEASE_DASHBOARD_OLD_TAG="$OLD_TAG" \
        RELEASE_DASHBOARD_NEW_TAG="$tag" \
        RELEASE_DASHBOARD_OLD_COMMIT="$OLD_COMMIT" \
        RELEASE_DASHBOARD_OLD_ROOT="$RELEASES_DIR/$OLD_TAG" \
        RELEASE_DASHBOARD_NEW_ROOT="$DIST_DIR" \
        RELEASE_DASHBOARD_RECEIPT="$ROLLBACK_DIR/${KERNEL_RELEASE_RUN_ID}.json" \
            node "$SCRIPT_DIR/lib/release-run-dashboard-receipt.mjs"
    fi
    echo "🎉 deploy 完成：本机 5211 已上线 ${tag}，HK 已同步，staging 已停、标记已清。"
}

# ── arg parse ──────────────────────────────────────────────────────────────────
MODE="full"; DEPLOY_TAG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --release-only) MODE="release-only"; shift ;;
        --deploy) MODE="deploy"; DEPLOY_TAG="${2:-}"; shift 2 ;;
        --deploy=*) MODE="deploy"; DEPLOY_TAG="${1#--deploy=}"; shift ;;
        --rollback) MODE="rollback"; DEPLOY_TAG="${2:-}"; shift 2 ;;
        *) shift ;;
    esac
done

echo "=== Cecelia Dashboard 放行 promote（mode=${MODE}）==="
echo "  部署根: $MAIN_ROOT"
echo ""

case "$MODE" in
    release-only)
        echo "❌ Dashboard release blocked: split forward mode is not authorized" >&2
        exit 78
        ;;
    deploy)
        echo "❌ Dashboard release blocked: split forward mode is not authorized" >&2
        exit 78
        ;;
    rollback)
        [[ "$DEPLOY_TAG" =~ ^prod-cecelia-v[1-9][0-9]*$ ]] \
            || { echo "❌ --rollback 需要 exact retained <prod-cecelia-vN>"; exit 78; }
        CECELIA_SKIP_BRAIN_PROMOTE=1 do_deploy "$DEPLOY_TAG" 1
        ;;
    full)
        RELEASE_TAG_RESULT=""
        do_release
        RELEASE_TAG="$RELEASE_TAG_RESULT"
        [[ -n "$RELEASE_TAG" ]] || { echo "❌ release 阶段未产出 RELEASE_TAG"; exit 1; }
        do_deploy "$RELEASE_TAG"
        ;;
esac
exit 0
