#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSIONS_FILE="$ROOT_DIR/.brain-versions"
BRAIN_DIR="$ROOT_DIR/packages/brain"
DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"

# 来源自举只产准入基线；存在标记即拒绝，早于 helper、凭据、构建和生产操作。
VERSION=$(node -e '
  const fs = require("node:fs");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw Error();
  } catch {
    process.stderr.write("BRAIN_RELEASE_PACKAGE_INVALID\n");
    process.exit(1);
  }
  if (Object.prototype.hasOwnProperty.call(pkg, "cecelia_source_only")) {
    process.stderr.write("SOURCE_ONLY_PRODUCTION_FORBIDDEN\n");
    process.exit(1);
  }
  process.stdout.write(String(pkg.version));
' "$BRAIN_DIR/package.json")

# 蓝绿切换 + Bark 告警工具（顶层 source，保证 Docker/launchd 两模式都有 send_bark/bluegreen_swap）
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/bluegreen.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/internal-auth-token.sh"
source "$SCRIPT_DIR/lib/brain-image-retention.sh"
source "$SCRIPT_DIR/lib/brain-staging.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/brain-bootstrap.sh"
bootstrap_select_receipt

bluegreen_pre_swap_check() {
    [[ -n "${BRAIN_BOOTSTRAP_RECEIPT:-}" ]] || return 0
    local identity status
    identity=$(docker inspect cecelia-node-brain --format '{{.State.Running}} {{.Image}}') || return 1
    [[ "$identity" == "true $BOOTSTRAP_OLD_IMAGE" ]] || return 1
    status=$(curl -sf --max-time 10 http://localhost:5221/api/brain/tick/status) || return 1
    node -e 'const x=JSON.parse(process.argv[1]); if(x.enabled!==false||x.loop_running!==false||x.tick_running!==false) process.exit(1)' "$status" || return 1
    bootstrap_audit
}

ENV_REGION="${ENV_REGION:-us}"
# 默认凭据路径跟着 HOST_HOME 走（macOS/us-vps 两份 compose 都在容器 env 里显式设了
# HOST_HOME=/Users/administrator 或 /root），不再硬编码 macOS 路径。
CECELIA_INTERNAL_ENV_FILE="${CECELIA_INTERNAL_ENV_FILE:-${HOST_HOME:-$HOME}/.credentials/cecelia-internal.env}"
export CECELIA_INTERNAL_ENV_FILE

# ── 部署状态文件：供 Brain 重启后感知 deploy 结果 ──────────────────────────
DEPLOY_SUCCESS=false
_write_deploy_status() {
    local retention_failed=false
    if [[ "$DEPLOY_SUCCESS" == "true" ]]; then
        retention_finish success || { DEPLOY_SUCCESS=false; retention_failed=true; }
    else
        retention_finish recovered || true
    fi
    if [[ "$DEPLOY_SUCCESS" == "true" ]]; then
        printf '{"status":"success","version":"%s","finished_at":"%s"}' \
            "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_STATUS_FILE" 2>/dev/null || true
    else
        printf '{"status":"failed","error":"brain-deploy.sh exited before success","finished_at":"%s"}' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_STATUS_FILE" 2>/dev/null || true
    fi
    if [[ "$retention_failed" == true ]]; then exit 1; fi
}
_deploy_exit() {
    if ! bootstrap_restore_tick; then DEPLOY_SUCCESS=false; fi
    _write_deploy_status
}
trap '_deploy_exit' EXIT

# ── Post-deploy smoke 函数 ──────────────────────────────────────────────────
# 部署 healthy 之后跑最近合并 PR 引入的 packages/brain/scripts/smoke/*.sh，
# 验生产 Brain 真生效（不只 200/healthy）。
#
# 控制 env：
#   SKIP_POST_DEPLOY_SMOKE=1  整体跳过（紧急部署 / 离线场景）
#   RECENT_PRS="2651 2650"    强制指定 PR 列表，绕过 gh pr list（测试用 / mock）
#
# 退出码：始终 0（每条 smoke non-fatal — deploy 已成功不能因 smoke 回滚）。
run_post_deploy_smoke() {
    if [[ "${SKIP_POST_DEPLOY_SMOKE:-0}" == "1" ]]; then
        echo "  [skip] SKIP_POST_DEPLOY_SMOKE=1"
        return 0
    fi
    if ! command -v gh >/dev/null 2>&1 && [[ -z "${RECENT_PRS:-}" ]]; then
        echo "  [skip] gh CLI 不存在且未提供 RECENT_PRS 覆盖 — 跳过 smoke 扫描"
        return 0
    fi

    local recent_prs="${RECENT_PRS:-}"
    if [[ -z "$recent_prs" ]]; then
        recent_prs=$(gh pr list --state merged --limit 5 --json number --jq '.[].number' 2>/dev/null || echo "")
    fi
    if [[ -z "$recent_prs" ]]; then
        echo "  没找到最近合并 PR — 跳过"
        return 0
    fi

    local ran=0 failed=0 sf
    # 去重缓存（避免同一 smoke 在多 PR 都改过时跑多次）— 用临时文件兼容老 bash
    local seen_file
    seen_file=$(mktemp "${TMPDIR:-/tmp}/post_deploy_smoke_seen.XXXXXX")
    # shellcheck disable=SC2064
    trap "rm -f '$seen_file'" RETURN

    for pr in $recent_prs; do
        local smoke_files=""
        if command -v gh >/dev/null 2>&1; then
            smoke_files=$(gh pr view "$pr" --json files --jq '.files[] | select(.path | startswith("packages/brain/scripts/smoke/") and endswith(".sh")) | .path' 2>/dev/null || echo "")
        fi
        # mock 模式：用户直接指定 RECENT_PRS 但没 gh，回退扫本地 worktree
        if [[ -z "$smoke_files" && -n "${RECENT_PRS:-}" && -d "$ROOT_DIR/packages/brain/scripts/smoke" ]]; then
            smoke_files=$(find "$ROOT_DIR/packages/brain/scripts/smoke" -maxdepth 1 -name "*.sh" -type f -print 2>/dev/null | sed "s|$ROOT_DIR/||")
        fi
        for sf in $smoke_files; do
            if grep -qxF "$sf" "$seen_file" 2>/dev/null; then continue; fi
            echo "$sf" >> "$seen_file"
            if [[ ! -f "$ROOT_DIR/$sf" ]]; then
                echo "  [skip] $sf (PR #$pr 引入但本地 worktree 不存在)"
                continue
            fi
            ran=$((ran + 1))
            echo "  Running $sf (from PR #$pr)..."
            if bash "$ROOT_DIR/$sf"; then
                echo "  ✅ smoke pass: $sf"
            else
                echo "  ❌ smoke failed: $sf (non-fatal — deploy 已成功)"
                failed=$((failed + 1))
            fi
        done
    done
    if [[ "$ran" -eq 0 ]]; then
        echo "  最近 5 个合并 PR 未引入 smoke.sh — 跳过"
    else
        echo "  Post-deploy smoke 总计：跑 $ran 条，失败 $failed 条"
    fi
    return 0
}

# Impact Gate 依赖 active manifest 中的路径归属。代码部署成功但 manifest 未激活时，
# 新文件与强制治理文件都会被永久判成 impact_anchor_missing，因此激活属于部署事务。
activate_cecelia_map_manifest() {
    local manifest_file="$ROOT_DIR/packages/brain/config/map-manifests/cecelia.v1.json"
    local adapter="$ROOT_DIR/scripts/map/product-map-adapter.mjs"
    local decision_id=""

    [[ -f "$manifest_file" && -f "$adapter" ]] || {
        echo "[map-activation] 缺少 Cecelia manifest 或受信 adapter，拒绝完成部署" >&2
        return 1
    }
    load_cecelia_internal_token "$CECELIA_INTERNAL_ENV_FILE" || {
        echo "[map-activation] 无法从共享 SSOT 加载内部 token" >&2
        return 1
    }
    decision_id=$(node -e '
      const fs = require("node:fs");
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(manifest.source_decision_id || "");
    ' "$manifest_file")
    [[ "$decision_id" =~ ^[0-9a-fA-F-]{36}$ ]] || {
        echo "[map-activation] Cecelia manifest 缺少合法 source_decision_id" >&2
        return 1
    }

    echo "[map-activation] 提交并激活 Cecelia 权威 manifest..."
    BRAIN_URL="http://localhost:5221" \
      CECELIA_INTERNAL_ENV_FILE="$CECELIA_INTERNAL_ENV_FILE" \
      node "$adapter" \
        --input "$manifest_file" \
        --scope cecelia \
        --decision-id "$decision_id" \
        --submit >/dev/null
    echo "[map-activation] Cecelia manifest 与 projection 已激活"
}

# ── drain_before_swap：swap 前停派发 + 等回调收尾 ────────────────────────────
# 调用 POST /api/brain/tick/drain → 轮询 drain-status.remaining === 0
# 超时或状态不可确认 → 终止切换；只有确认没有旧实例才跳过。
DRAIN_TIMEOUT_SECS="${DRAIN_TIMEOUT_SECS:-120}"
DRAIN_STARTED_BY_DEPLOY=false

# drain-cancel 带重试（Issue cc28d1af 根因D 第3/4次复发，2026-08-04）：
# 单发请求会在 swap 端口切换窗口静默失败。只有 API 确认成功且读回
# draining=false 才算恢复；五次全败则保留失败证据，禁止宣告发布成功。
drain_cancel_with_retry() {
    local attempt response status
    for attempt in 1 2 3 4 5; do
        if response=$(curl -q -sf --max-time 5 --max-filesize 262144 -X POST \
            "http://localhost:5221/api/brain/tick/drain-cancel" 2>/dev/null) \
            && node -e 'const x=JSON.parse(process.argv[1]); if(x.success!==true) process.exit(1)' "$response" 2>/dev/null; then
            status=$(curl -q -sf --max-time 5 --max-filesize 262144 \
                "http://localhost:5221/api/brain/tick/status" 2>/dev/null || true)
            if node -e 'const x=JSON.parse(process.argv[1]); if(x.draining!==false) process.exit(1)' "$status" 2>/dev/null; then
                echo "  [drain] drain-cancel 已读回 draining=false（第 ${attempt} 次尝试）"
                return 0
            fi
        fi
        sleep 5
    done
    echo "  [drain] FAIL: drain-cancel 五次均未确认，旧 Brain 可能仍停派发" >&2
    send_bark "brain-deploy drain-cancel 五次未确认，旧 Brain 可能仍停派发；发布判失败"
    return 1
}

drain_before_swap() {
    local brain_url="http://localhost:5221"
    local old_instance_exists="${1:-false}"
    DRAIN_STARTED_BY_DEPLOY=false

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] POST ${brain_url}/api/brain/tick/drain  # 进入 drain 模式"
        echo "  [dry-run] poll GET ${brain_url}/api/brain/tick/drain-status (timeout=${DRAIN_TIMEOUT_SECS}s)"
        return 0
    fi

    # 首次部署无旧实例可跳过；已有旧实例但 API 不通时不能证明执行已排空。
    if ! curl -sf --max-time 3 "${brain_url}/api/brain/tick/status" >/dev/null 2>&1; then
        if [[ "$old_instance_exists" == false ]]; then
            echo "  [drain] 无旧实例响应，首次部署跳过 drain"
            return 0
        fi
        echo "  [drain] FAIL: 旧 Brain 存在但状态接口不可达，停止 swap" >&2
        return 1
    fi

    echo "  [drain] 发送 drain 请求..."
    local drain_resp
    drain_resp=$(curl -sf --max-time 25 -X POST -H 'Content-Type: application/json' \
        -d '{"hold_for_swap":true}' "${brain_url}/api/brain/tick/drain" 2>&1) || {
        echo "  [drain] FAIL: drain 请求失败，停止 swap" >&2
        return 1
    }
    if ! node -e 'const x=JSON.parse(process.argv[1]); if(x.draining!==true||x.hold_for_swap!==true||x.already_draining===true) process.exit(1)' "$drain_resp" 2>/dev/null; then
        echo "  [drain] FAIL: drain 未确认激活，停止 swap" >&2
        return 1
    fi
    DRAIN_STARTED_BY_DEPLOY=true
    echo "  [drain] drain 已激活: $(echo "$drain_resp" | grep -o '"remaining":[0-9]*' | head -1 || echo 'ok')"

    # 轮询等待 in_progress 归零
    local elapsed=0 remaining=-1
    while [[ "$elapsed" -lt "$DRAIN_TIMEOUT_SECS" ]]; do
        local status_resp
        status_resp=$(curl -sf --max-time 20 "${brain_url}/api/brain/tick/drain-status" 2>/dev/null || echo "")
        if [[ -n "$status_resp" ]]; then
            remaining=$(node -e 'const x=JSON.parse(process.argv[1]); if(!Number.isSafeInteger(x.remaining)||x.remaining<0) process.exit(1); process.stdout.write(String(x.remaining))' "$status_resp" 2>/dev/null || echo "-1")
            if [[ "$remaining" == "0" ]] && node -e 'const x=JSON.parse(process.argv[1]); if(x.drain_completed!==true||x.draining!==true||x.hold_for_swap!==true) process.exit(1)' "$status_resp" 2>/dev/null; then
                echo "  [drain] ✅ 执行与回调已排空（${elapsed}s），可安全 swap"
                return 0
            fi
            echo "  [drain] 等待中... remaining=${remaining} (${elapsed}s/${DRAIN_TIMEOUT_SECS}s)"
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done

    local warn_msg="brain-deploy drain 未确认排空（${DRAIN_TIMEOUT_SECS}s，remaining=${remaining}），停止 swap，请核验活跃执行与回调"
    echo "  [drain] FAIL: $warn_msg" >&2
    send_bark "$warn_msg"
    return 1
}

# ── 参数解析 ─────────────────────────────────────────────────────────────────
DRY_RUN=false
SHA_CHECK_ONLY=false
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
        --sha-check-only) SHA_CHECK_ONLY=true ;;
    esac
done

# ── FR-05: S6 SHA 回读断言（--sha-check-only 模式）────────────────────────────
# 用法：HEALTH_JSON_OVERRIDE=<fixture_file> EXPECTED_SHA=<sha> bash brain-deploy.sh --sha-check-only
# 用途：测试注入（通过 HEALTH_JSON_OVERRIDE 注入 fixture 替代真实 curl），不执行实际部署
if [[ "$SHA_CHECK_ONLY" == true ]]; then
    BRAIN_URL_CHECK="${BRAIN_URL:-http://localhost:5221}"
    local_expected_sha="${EXPECTED_SHA:-}"

    if [[ -z "$local_expected_sha" ]]; then
        echo "[SHA-CHECK] EXPECTED_SHA 未设置，从 git rev-parse HEAD 获取..."
        local_expected_sha=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "")
    fi

    echo "[SHA-CHECK] EXPECTED_SHA=${local_expected_sha}"

    # 取健康端点 SHA（支持 HEALTH_JSON_OVERRIDE 注入 fixture 文件）
    local_health_json=""
    if [[ -n "${HEALTH_JSON_OVERRIDE:-}" && -f "${HEALTH_JSON_OVERRIDE}" ]]; then
        echo "[SHA-CHECK] 使用 fixture: ${HEALTH_JSON_OVERRIDE}"
        local_health_json=$(cat "${HEALTH_JSON_OVERRIDE}")
    else
        echo "[SHA-CHECK] curl ${BRAIN_URL_CHECK}/api/brain/health ..."
        local_health_json=$(curl -sf --connect-timeout 10 --max-time 15 \
            "${BRAIN_URL_CHECK}/api/brain/health" 2>/dev/null || echo "")
    fi

    if [[ -z "$local_health_json" ]]; then
        echo "[SHA-CHECK] ❌ /health 不可达，SHA 无法验证"
        exit 1
    fi

    local_actual_sha=$(echo "$local_health_json" | node -e "
        const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
        process.stdout.write(d.git_sha||'unknown');
    " 2>/dev/null || echo "unknown")

    echo "[SHA-CHECK] ACTUAL_SHA=${local_actual_sha}"

    if [[ "$local_actual_sha" != "$local_expected_sha" ]]; then
        echo "[SHA-CHECK] ❌ SHA 不匹配：EXPECTED=${local_expected_sha} ACTUAL=${local_actual_sha}"
        echo "[SHA-CHECK] ROLLBACK — 触发既有回滚流程，部署视为失败"
        exit 1
    fi

    echo "[SHA-CHECK] ✅ SHA 一致：${local_actual_sha}"
    exit 0
fi

# ── 部署模式检测：Docker vs launchd ─────────────────────────────────────────
DEPLOY_MODE="docker"
LAUNCHD_SERVICE="com.cecelia.brain"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_SERVICE}.plist"

if ! docker info >/dev/null 2>&1 || ! docker inspect cecelia-node-brain >/dev/null 2>&1; then
    if [[ -f "$LAUNCHD_PLIST" ]]; then
        DEPLOY_MODE="launchd"
    fi
fi
if [[ -n "${BRAIN_BOOTSTRAP_RECEIPT:-}" && "$DEPLOY_MODE" != docker ]]; then
    echo "[bootstrap] FAIL: 一次性 .84 升级只支持固定 Docker 生产容器" >&2
    exit 1
fi

# ── Compose 文件选择：Linux(us-vps) 用专属文件，其余(macOS/mmv)用默认文件 ────
# COMPOSE_FILE 允许环境变量显式覆盖（测试/未来手动指定用），缺省按 uname -s 自动探测。
if [[ -z "${COMPOSE_FILE:-}" ]]; then
    if [[ "$(uname -s)" == "Linux" ]]; then
        COMPOSE_FILE="docker-compose.us-vps.yml"
    else
        COMPOSE_FILE="docker-compose.yml"
    fi
fi

echo "=== Deploying cecelia-brain v${VERSION} (region=${ENV_REGION}, mode=${DEPLOY_MODE}, compose=${COMPOSE_FILE}) ==="
echo ""

# ── 主机 home 目录（兼容 Docker 镜像内 /home/xx 和 macOS /Users/xxx）────────
HOST_HOME="${HOST_HOME:-$HOME}"

if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] DEPLOY_MODE=${DEPLOY_MODE}"
    echo "[dry-run] COMPOSE_FILE=${COMPOSE_FILE}"
    echo "[dry-run] ROOT_DIR=${ROOT_DIR}"
    echo "[dry-run] HOST_HOME=${HOST_HOME}"
    echo ""
fi

if [[ "$DRY_RUN" == false ]]; then
    ensure_cecelia_internal_token "$CECELIA_INTERNAL_ENV_FILE" || exit 1
fi

# ─── Docker 模式 ─────────────────────────────────────────────────────────────

if [[ "$DEPLOY_MODE" == "docker" ]]; then

    # Docker 端口转发不是 socket loopback；宿主 cron 与 Brain 必须共享显式凭据。
    if [[ "$DRY_RUN" == true ]]; then
        echo "[dry-run] ensure_cecelia_internal_token $CECELIA_INTERNAL_ENV_FILE"
    else
        ensure_cecelia_internal_token "$CECELIA_INTERNAL_ENV_FILE" || exit 1
    fi

    if [[ "$DRY_RUN" == false ]]; then
        retention_begin "$VERSION" "${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}" || exit 1
    fi

    if [[ "$DRY_RUN" == false ]]; then
        brain_release_lock
        EXPECTED_SHA="${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
        [[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
        export EXPECTED_SHA
    fi

    # 1. Build image
    echo "[1/7] Building image..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] bash $SCRIPT_DIR/brain-build.sh"
    else
        bash "$SCRIPT_DIR/brain-build.sh"
    fi
    echo ""

    # 候选准入必须在任何生产迁移/排空/切换之前完成。
    if [[ "$DRY_RUN" == false ]]; then
        CECELIA_RELEASE_IMAGE=$(docker image inspect --format '{{.Id}}' "cecelia-brain:${VERSION}")
        export CECELIA_RELEASE_IMAGE
        stage_candidate "$EXPECTED_SHA" "$CECELIA_RELEASE_IMAGE" "$VERSION"
        if [[ -n "${BRAIN_BOOTSTRAP_RECEIPT:-}" ]]; then
            BOOTSTRAP_OLD_IMAGE=$(docker inspect cecelia-node-brain --format '{{.Image}}')
            bootstrap_assert_identity "$BOOTSTRAP_OLD_IMAGE" "$CECELIA_RELEASE_IMAGE" "$EXPECTED_SHA" "$VERSION"
            bootstrap_audit
        fi
    else
        echo "[dry-run] staging 同 SHA/镜像/隔离验证先于生产迁移"
    fi

    # 2. Run migrations in a temporary container
    echo "[2/7] Running migrations..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker run --rm --network host cecelia-brain:${VERSION} node src/migrate.js"
    else
        docker run --rm --network host \
          --env-file "$ROOT_DIR/.env.docker" \
          -e "ENV_REGION=${ENV_REGION}" \
          "${CECELIA_RELEASE_IMAGE}" \
          node src/migrate.js
    fi
    echo ""

    # 3. Run self-check in a temporary container
    echo "[3/7] Running self-check..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker run --rm --network host cecelia-brain:${VERSION} node src/selfcheck.js"
    else
        docker run --rm --network host \
          --env-file "$ROOT_DIR/.env.docker" \
          -e "ENV_REGION=${ENV_REGION}" \
          "${CECELIA_RELEASE_IMAGE}" \
          node src/selfcheck.js
    fi
    echo ""

    # 4. Run tests (SKIPPED - tests run in CI)
    echo "[4/7] Running tests... SKIPPED (CI already validated)"
    echo "  All tests pass in CI, skipping local test run to avoid port conflicts"
    echo ""

    # 5. Record version
    echo "[5/7] Recording version..."
    if [[ "$DRY_RUN" == false ]]; then
        LAST_RECORDED=""
        if [[ -f "$VERSIONS_FILE" ]]; then
          LAST_RECORDED=$(tail -1 "$VERSIONS_FILE" 2>/dev/null || echo "")
        fi
        if [[ "$LAST_RECORDED" == "${VERSION}" ]]; then
          echo "  Version ${VERSION} already recorded, skipping duplicate write."
        else
          echo "${VERSION}" >> "$VERSIONS_FILE"
          tail -5 "$VERSIONS_FILE" > "$VERSIONS_FILE.tmp" && mv "$VERSIONS_FILE.tmp" "$VERSIONS_FILE"
          echo "  Stored in .brain-versions"
        fi
    else
        echo "  [dry-run] echo $VERSION >> .brain-versions"
    fi
    echo ""

    # 6. Git tag (skip if tag exists)
    echo "[6/7] Git tagging..."
    TAG="brain-v${VERSION}"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] git tag $TAG"
    elif git rev-parse "$TAG" >/dev/null 2>&1; then
        echo "  Tag ${TAG} already exists, skipping."
    else
        git tag "$TAG"
        echo "  Created tag: ${TAG}"
    fi
    echo ""

    # 6.9 凭据自愈：容器启动前，把丢失的 Claude 账号 .credentials.json 从 1Password 恢复。
    # Brain 在 Docker（只读挂载账号目录、读不到 macOS 钥匙串），文件丢了就判账号 MISSING、
    # harness 单账号卡死。此处自动补回，non-fatal 不阻塞部署。
    if [[ "$DRY_RUN" == false && -f "$SCRIPT_DIR/restore-claude-creds.sh" ]]; then
        echo "[6.9/8] 凭据自愈（缺失文件从 1Password 恢复）..."
        bash "$SCRIPT_DIR/restore-claude-creds.sh" 2>&1 | sed 's/^/  /' || echo "  [warn] restore 失败（non-fatal）"
    fi

    # 7. Stop old container + start new one
    echo "[7/8] Starting container..."

    # 幂等检查：容器已在目标 image SHA 则跳过 recreate（避免 SIGTERM 中断长跑 Initiative）
    CURRENT_IMG=$(docker inspect cecelia-node-brain --format '{{.Image}}' 2>/dev/null || echo "")
    TARGET_IMG=$(docker inspect "${CECELIA_RELEASE_IMAGE:-cecelia-brain:${VERSION}}" --format '{{.Id}}' 2>/dev/null || echo "")
    if [[ "$DRY_RUN" == false && -n "$CURRENT_IMG" && -n "$TARGET_IMG" && "$CURRENT_IMG" == "$TARGET_IMG" ]]; then
        if [[ -n "${BRAIN_BOOTSTRAP_RECEIPT:-}" ]]; then
            echo "[bootstrap] FAIL: 新旧镜像相同，一次性首升回执不可用于幂等跳过" >&2
            exit 1
        fi
        echo "  [skip] 容器已在 v${VERSION}（image SHA 一致），跳过 recreate"
        activate_cecelia_map_manifest
        DEPLOY_SUCCESS=true
        exit 0
    fi

    # ── Blue-green canary：green 验证健康后才删 blue（根治 outage，issue f38f989f）──
    # 原"先删后建"（无条件 docker rm -f blue → compose up）会在坏镜像/中断时留 5221 空窗。
    # 改为：green 临时端口(5233)起 + BRAIN_DEPLOY_CANARY 关 tick + health 全过 → 才删 blue。
    # green 失败则 blue(5221) 原封不动 + Bark 告警 + 终止部署（exit 1）。
    # （bluegreen.sh 已在脚本顶层 source）
    if [[ "$DRY_RUN" == true ]]; then
        # dry-run：断言 drain → bluegreen_swap 的正确调用顺序
        echo "  [7/8] drain 旧 Brain（等 in_progress 归零，超时 ${DRAIN_TIMEOUT_SECS}s）..."
        drain_before_swap false
        echo ""
        echo "  [dry-run] bluegreen_swap TARGET_VERSION=${VERSION} BLUE=cecelia-node-brain GREEN=cecelia-node-brain-green PORT=5233"
    elif docker inspect cecelia-node-brain >/dev/null 2>&1; then
        # blue 在跑 → swap 前先 drain（停派发 + 等 in_progress 回调收尾）
        echo "  [7/8] drain 旧 Brain（等 in_progress 归零，超时 ${DRAIN_TIMEOUT_SECS}s）..."
        if [[ -n "${BRAIN_BOOTSTRAP_RECEIPT:-}" ]]; then
            drain_gate=bootstrap_before_swap
        else
            drain_gate=drain_before_swap
        fi
        if [[ "$drain_gate" == bootstrap_before_swap ]]; then
            if ! bootstrap_before_swap "$CURRENT_IMG" "$TARGET_IMG" "$EXPECTED_SHA" "$VERSION"; then
                if [[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]; then drain_cancel_with_retry; fi
                exit 1
            fi
        elif ! drain_before_swap true; then
            if [[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]; then drain_cancel_with_retry; fi
            exit 1
        fi
        echo ""

        # blue 是 bridge 网络（docker ps 显示 0.0.0.0:5221->5221），green 用 bridge + -p 5233:5221，
        # 不加 --network host（否则 green 抢占 host 5221 与 blue 冲突）。
        # blue 的 env 值可能含空格，必须走 env-file（bluegreen_green_run_args），不能拼 -e K=V；
        # 文件 600 权限、swap 结束即删（docker run 读完就不再需要）。
        GREEN_ENV_FILE=$(mktemp "${TMPDIR:-/tmp}/cecelia-green-env.XXXXXX")
        chmod 600 "$GREEN_ENV_FILE"
        if ! GREEN_RUN_ARGS=$(bluegreen_green_run_args cecelia-node-brain "$GREEN_ENV_FILE"); then
            rm -f "$GREEN_ENV_FILE"
            echo "[FAIL] 读取旧 Brain 容器 env/卷失败，终止部署"
            if [[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]; then drain_cancel_with_retry; fi
            exit 1
        fi
        export GREEN_RUN_ARGS
        # sidecar 需要知道部署根和 region（bluegreen.sh 通过 env 读取）
        export DEPLOY_ROOT_DIR="$ROOT_DIR"
        # 守卫块内必须直接 exit 1（tests/packages/brain/bluegreen-deploy-contract.test.js 结构化匹配 if ! …bluegreen_swap; then … exit 1 … fi）
        if ! TARGET_VERSION="${VERSION}" BLUE_NAME=cecelia-node-brain \
             GREEN_NAME=cecelia-node-brain-green TEMP_PORT=5233 HEALTH_TIMEOUT=90 bluegreen_swap; then
            rm -f "$GREEN_ENV_FILE"
            echo "[FAIL] green canary 未通过，已保留旧生产容器(5221 不受影响)，终止部署"
            # blue 仍在运行且已进入 drain 模式 → 恢复正常派发
            echo "  [drain] green 未通过，恢复旧 Brain 派发..."
            if [[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]; then drain_cancel_with_retry; fi
            exit 1
        fi
        rm -f "$GREEN_ENV_FILE"
    else
        # 无 blue（首次部署）→ 无 outage 风险，跳过 drain + canary 直接起
        echo "  [首次部署] 无旧生产容器，跳过 drain + canary，直接起新容器"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker compose -f ${COMPOSE_FILE} up -d node-brain (cecelia-brain:${VERSION})"
    elif ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
        -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain; then
        echo ""
        echo "[FAIL] docker compose up -d failed. Rolling back..."
        if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
            PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
            echo "  Rolling back to v${PREV_VERSION}..."
            CECELIA_RELEASE_IMAGE= BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
              docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
                -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain || true
            echo "  Rolled back to v${PREV_VERSION}"
        else
            echo "  No previous version found. Stopping container."
            docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
              -f "$ROOT_DIR/${COMPOSE_FILE}" stop node-brain || true
        fi
        exit 1
    fi

fi  # end Docker mode

# ─── launchd 模式 ────────────────────────────────────────────────────────────

if [[ "$DEPLOY_MODE" == "launchd" ]]; then

    if [[ "$DRY_RUN" == false ]]; then
        retention_begin "$VERSION" "${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}" || exit 1
    fi

    # 1. Build image: SKIPPED (not using Docker)
    echo "[1/7] Building image... SKIPPED (launchd mode, no Docker)"
    echo ""

    # 2. Run migrations directly
    echo "[2/7] Running migrations..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] node $BRAIN_DIR/src/migrate.js"
    else
        (cd "$BRAIN_DIR" && node src/migrate.js)
    fi
    echo ""

    # 3. Run self-check directly
    echo "[3/7] Running self-check..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] node $BRAIN_DIR/src/selfcheck.js"
    else
        (cd "$BRAIN_DIR" && node src/selfcheck.js)
    fi
    echo ""

    # 4. Run tests (SKIPPED - tests run in CI)
    echo "[4/7] Running tests... SKIPPED (CI already validated)"
    echo ""

    # 5. Record version
    echo "[5/7] Recording version..."
    if [[ "$DRY_RUN" == false ]]; then
        LAST_RECORDED=""
        if [[ -f "$VERSIONS_FILE" ]]; then
          LAST_RECORDED=$(tail -1 "$VERSIONS_FILE" 2>/dev/null || echo "")
        fi
        if [[ "$LAST_RECORDED" == "${VERSION}" ]]; then
          echo "  Version ${VERSION} already recorded, skipping duplicate write."
        else
          echo "${VERSION}" >> "$VERSIONS_FILE"
          tail -5 "$VERSIONS_FILE" > "$VERSIONS_FILE.tmp" && mv "$VERSIONS_FILE.tmp" "$VERSIONS_FILE"
          echo "  Stored in .brain-versions"
        fi
    else
        echo "  [dry-run] echo $VERSION >> .brain-versions"
    fi
    echo ""

    # 6. Git tag (skip if tag exists)
    echo "[6/7] Git tagging..."
    TAG="brain-v${VERSION}"
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] git tag $TAG"
    elif git rev-parse "$TAG" >/dev/null 2>&1; then
        echo "  Tag ${TAG} already exists, skipping."
    else
        git tag "$TAG"
        echo "  Created tag: ${TAG}"
    fi
    echo ""

    # 7. Restart via launchd
    echo "[7/8] Restarting Brain via launchd (kickstart -k)..."
    # swap 前：drain 旧 Brain（停派发 + 等 in_progress 回调收尾）
    echo "  drain 旧 Brain（等 in_progress 归零，超时 ${DRAIN_TIMEOUT_SECS}s）..."
    if ! drain_before_swap false; then
        if [[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]; then drain_cancel_with_retry; fi
        exit 1
    fi
    echo ""

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] launchctl kickstart -k gui/$(id -u)/${LAUNCHD_SERVICE}"
    else
        # 先 kill 游离 Brain 进程（launchd 外启动的进程 kickstart -k 无法 kill）
        # 使用完整路径 /usr/sbin/lsof 避免 launchd 最小 PATH 中找不到 lsof（code=127）
        STALE_PID=$(PATH="/usr/sbin:$PATH" lsof -ti:5221 2>/dev/null | head -1 || echo "")
        LAUNCHD_PID=$(launchctl list "${LAUNCHD_SERVICE}" 2>/dev/null | grep -E '^\s*[0-9]+' | awk '{print $1}' | head -1)
        if [[ -n "$STALE_PID" && "$STALE_PID" != "$LAUNCHD_PID" ]]; then
            echo "  发现游离 Brain 进程 PID=${STALE_PID}（launchd 记录=${LAUNCHD_PID}），先终止..."
            kill "$STALE_PID" 2>/dev/null && sleep 2 || true
        fi
        launchctl kickstart -k "gui/$(id -u)/${LAUNCHD_SERVICE}" || \
            launchctl start "${LAUNCHD_SERVICE}" 2>/dev/null || true
    fi

fi  # end launchd mode

# ─── dry-run 提前退出 ────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
    echo ""
    echo "=== [dry-run] Deploy SUCCESS: cecelia-brain v${VERSION} (${DEPLOY_MODE}) ==="
    exit 0
fi

# ─── 通用：等待健康检查（Docker 和 launchd 都需要）──────────────────────────

echo ""
echo "Waiting for health check..."
TRIES=0
MAX_TRIES=12
while [ $TRIES -lt $MAX_TRIES ]; do
  sleep 5
  TRIES=$((TRIES + 1))
  if curl -sf http://localhost:5221/api/brain/tick/status > /dev/null 2>&1; then
    echo ""
    echo "=== Deploy SUCCESS: cecelia-brain v${VERSION} is healthy (${DEPLOY_MODE}) ==="

    # swap 成功后无条件 drain-cancel（Issue cc28d1af 根因D）：
    # drain_before_swap 的 drain 状态持久化在 working_memory（共享DB），僵尸 in_progress
    # 任务会让 drain 永远等不完 → 120s 超时"继续部署"后不取消 → 新容器 restoreDrainState
    # 恢复 draining → 派发永久瘫痪（0729 16:48 / 0730 10:21 两次实证，均由合并PR自动部署触发）。
    # 部署已收尾，pre-swap 的 drain 使命已结束，新实例不应继承——best-effort 取消。
    echo "  [drain] swap 成功，取消 pre-swap drain（新实例不继承排水状态）..."
    if [[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]; then drain_cancel_with_retry; fi

    # S6: FR-05 SHA 回读断言（Gate3 C-05）
    # 部署完成后读 /health.git_sha 与 EXPECTED_SHA 对比，不等则 ROLLBACK exit 1
    echo ""
    echo "[S6] SHA 回读断言（Gate3 C-05）..."
    if [[ -z "${EXPECTED_SHA:-}" ]]; then
        EXPECTED_SHA=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "")
    fi
    if [[ -n "$EXPECTED_SHA" ]]; then
        S6_HEALTH_JSON=""
        if [[ -n "${HEALTH_JSON_OVERRIDE:-}" && -f "${HEALTH_JSON_OVERRIDE}" ]]; then
            S6_HEALTH_JSON=$(cat "${HEALTH_JSON_OVERRIDE}")
        else
            S6_HEALTH_JSON=$(curl -sf --connect-timeout 10 --max-time 15 \
                "http://localhost:5221/api/brain/health" 2>/dev/null || echo "")
        fi
        if [[ -n "$S6_HEALTH_JSON" ]]; then
            ACTUAL_SHA=$(echo "$S6_HEALTH_JSON" | node -e "
                const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
                process.stdout.write(d.git_sha||'unknown');
            " 2>/dev/null || echo "unknown")
            echo "  EXPECTED_SHA=${EXPECTED_SHA}"
            echo "  ACTUAL_SHA  =${ACTUAL_SHA}"
            if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
                echo "[S6] ❌ SHA 不匹配：EXPECTED=${EXPECTED_SHA} ACTUAL=${ACTUAL_SHA}"
                echo "[S6] ROLLBACK — 镜像 SHA 与 git HEAD 不一致，部署失败"
                # 走既有回滚：exit 1（trap 写 failed 状态）
                exit 1
            else
                echo "[S6] ✅ SHA 一致：${ACTUAL_SHA}"
            fi
        else
            echo "[S6] ⚠️  /health 无响应，跳过 SHA 校验（non-fatal：服务已 healthy）"
        fi
    else
        echo "[S6] ⚠️  无法获取 EXPECTED_SHA（非 git repo 环境），跳过 SHA 校验"
    fi

    echo ""
    echo "[S6.5] 激活 Cecelia Map manifest（Impact Gate 上线前置）..."
    activate_cecelia_map_manifest
    bootstrap_restore_tick
    DEPLOY_SUCCESS=true

    # 8. Update cecelia-run on host (self-update: keeps executor in sync with repo)
    echo ""
    echo "[8/8] Updating cecelia-run on host..."
    CECELIA_RUN_SRC="$ROOT_DIR/packages/brain/scripts/cecelia-run.sh"
    CECELIA_RUN_DST="${HOST_HOME}/bin/cecelia-run"
    if [[ -f "$CECELIA_RUN_SRC" ]]; then
      # macOS cp identical files 返 rc=1，set -e 会中止后续 Phase 9-11；|| true 兜底
      cp "$CECELIA_RUN_SRC" "$CECELIA_RUN_DST" 2>&1 || true
      chmod +x "$CECELIA_RUN_DST" 2>/dev/null || true
      echo "  Updated $CECELIA_RUN_DST (v${VERSION})"
    else
      echo "  WARN: $CECELIA_RUN_SRC not found, skipping cecelia-run update"
    fi

    # 9. Update cecelia-bridge on host (self-update: keeps bridge timeout config in sync)
    echo ""
    echo "[9/9] Updating cecelia-bridge on host..."
    BRIDGE_SRC="$ROOT_DIR/packages/brain/scripts/cecelia-bridge.js"
    BRIDGE_DST="${HOST_HOME}/bin/cecelia-bridge.js"
    if [[ -f "$BRIDGE_SRC" ]]; then
      # Bridge文件未落地不算部署成功；复制异常时EXIT回执必须保留failed。
      DEPLOY_SUCCESS=false
      # 入口依赖先到位再更新入口，避免宿主bin首次部署缺模块导致Bridge起不来。
      BRIDGE_LIB_SRC="$ROOT_DIR/packages/brain/scripts/lib/bridge-lifecycle.cjs"
      BRIDGE_LIB_DIR="${HOST_HOME}/bin/lib"
      mkdir -p "$BRIDGE_LIB_DIR"
      if ! cmp -s "$BRIDGE_LIB_SRC" "$BRIDGE_LIB_DIR/bridge-lifecycle.cjs"; then
        cp "$BRIDGE_LIB_SRC" "$BRIDGE_LIB_DIR/bridge-lifecycle.cjs"
      fi
      # 内容一致时不cp；真正的权限/磁盘错误必须让set -e终止，不能吞掉。
      if ! cmp -s "$BRIDGE_SRC" "$BRIDGE_DST"; then
        cp "$BRIDGE_SRC" "$BRIDGE_DST"
      fi
      DEPLOY_SUCCESS=true
      echo "  Updated $BRIDGE_DST (v${VERSION})"
      # 重启 bridge（launchd 或 systemd）
      if [[ "$DEPLOY_MODE" == "launchd" ]]; then
        BRIDGE_SERVICE="com.cecelia.bridge"
        BRIDGE_PLIST="${HOME}/Library/LaunchAgents/${BRIDGE_SERVICE}.plist"
        if [[ -f "$BRIDGE_PLIST" ]]; then
          launchctl kickstart -k "gui/$(id -u)/${BRIDGE_SERVICE}" 2>/dev/null && \
            echo "  Bridge restarted via launchd" || \
            echo "  NOTE: Bridge launchd restart skipped (service may not be running)"
        fi
      elif systemctl is-active cecelia-bridge >/dev/null 2>&1; then
        if command -v sudo >/dev/null 2>&1; then
          SUDO_CMD="sudo -n"
          if $SUDO_CMD sed -i "s|ExecStart=.*cecelia-bridge.*|ExecStart=/usr/bin/node $BRIDGE_DST|" /etc/systemd/system/cecelia-bridge.service 2>/dev/null && \
             $SUDO_CMD systemctl daemon-reload 2>/dev/null && \
             $SUDO_CMD systemctl restart cecelia-bridge 2>/dev/null; then
            echo "  Bridge restarted via systemd (now using $BRIDGE_DST)"
          else
            echo "  NOTE: sudo unavailable. Bridge will use updated file on next manual restart."
          fi
        fi
      fi
    else
      echo "  WARN: $BRIDGE_SRC not found, skipping bridge update"
    fi

    # 10. Trigger Notion sync to catch missed webhook events during restart
    echo ""
    echo "[10/11] Triggering post-deploy Notion sync..."
    SYNC_RESPONSE=$(curl -sf --max-time 30 -X POST http://localhost:5221/api/brain/notion-sync/run 2>&1) || true
    if [[ -n "$SYNC_RESPONSE" ]]; then
      SYNCED=$(echo "$SYNC_RESPONSE" | node -e "try{const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const f=r.fromNotion||{};const t=r.toNotion||{};console.log('fromNotion synced='+( f.synced||0)+' toNotion synced='+(t.synced||0)+' failed='+(t.failed||0))}catch(e){console.log('(parse error)'+ e.message)}" 2>/dev/null || echo "$SYNC_RESPONSE" | head -c 200)
      echo "  Notion sync triggered: $SYNCED"
    else
      echo "  WARN: Notion sync call failed or timed out (non-blocking)"
    fi

    # 11. Post-deploy smoke：跑最近合并 PR 引入的 packages/brain/scripts/smoke/*.sh
    echo ""
    echo "[11/11] Post-deploy smoke..."
    run_post_deploy_smoke || true   # smoke non-fatal — deploy 已成功

    exit 0
  fi
  echo "  Attempt ${TRIES}/${MAX_TRIES}..."
done

# Health check failed
echo ""
echo "[FAIL] Health check timed out after 60s."

# 环境守卫：部署后 5221 未响应 = 控制面 outage 风险，Bark 告警（issue 8ae2e116）
send_bark "部署后自检失败：Brain 5221 (/api/brain/tick/status) 60s 未响应，v${VERSION} 可能未起来，请立即检查"

if [[ "$DEPLOY_MODE" == "launchd" ]]; then
    echo "  Brain failed to start. Check logs: tail -50 $ROOT_DIR/logs/brain-error.log"
    echo "  Manual restart: launchctl kickstart -k gui/$(id -u)/${LAUNCHD_SERVICE}"
else
    echo "[FAIL] Rolling back..."
    if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
        PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
        echo "  Rolling back to v${PREV_VERSION}..."
        CECELIA_RELEASE_IMAGE= BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
          docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
            -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain
        echo "  Rolled back to v${PREV_VERSION}"
    else
        echo "  No previous version found. Stopping container."
        docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
          -f "$ROOT_DIR/${COMPOSE_FILE}" stop node-brain
    fi
fi

exit 1
