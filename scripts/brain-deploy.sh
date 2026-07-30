#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSIONS_FILE="$ROOT_DIR/.brain-versions"
BRAIN_DIR="$ROOT_DIR/packages/brain"
DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"

# 蓝绿切换 + Bark 告警工具（顶层 source，保证 Docker/launchd 两模式都有 send_bark/bluegreen_swap）
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/bluegreen.sh"

VERSION=$(node -e "console.log(require('$BRAIN_DIR/package.json').version)")
ENV_REGION="${ENV_REGION:-us}"

# ── 部署状态文件：供 Brain 重启后感知 deploy 结果 ──────────────────────────
DEPLOY_SUCCESS=false
_write_deploy_status() {
    if [[ "$DEPLOY_SUCCESS" == "true" ]]; then
        printf '{"status":"success","version":"%s","finished_at":"%s"}' \
            "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_STATUS_FILE" 2>/dev/null || true
    else
        printf '{"status":"failed","error":"brain-deploy.sh exited before success","finished_at":"%s"}' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_STATUS_FILE" 2>/dev/null || true
    fi
}
trap '_write_deploy_status' EXIT

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

# ── drain_before_swap：swap 前停派发 + 等回调收尾 ────────────────────────────
# 调用 POST /api/brain/tick/drain → 轮询 drain-status.remaining === 0
# 超时（DRAIN_TIMEOUT_SECS，默认 120s）→ 告警 + 继续（non-fatal，不阻止部署）
# Brain 未在线时静默跳过（首次部署/迁移场景无需 drain）
DRAIN_TIMEOUT_SECS="${DRAIN_TIMEOUT_SECS:-120}"

drain_before_swap() {
    local brain_url="http://localhost:5221"

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] POST ${brain_url}/api/brain/tick/drain  # 进入 drain 模式"
        echo "  [dry-run] poll GET ${brain_url}/api/brain/tick/drain-status (timeout=${DRAIN_TIMEOUT_SECS}s)"
        return 0
    fi

    # Brain 不在线则跳过（首次部署无旧实例）
    if ! curl -sf --max-time 3 "${brain_url}/api/brain/tick/status" >/dev/null 2>&1; then
        echo "  [drain] Brain 未响应，跳过 drain（首次部署或离线场景）"
        return 0
    fi

    echo "  [drain] 发送 drain 请求..."
    local drain_resp
    drain_resp=$(curl -sf --max-time 10 -X POST "${brain_url}/api/brain/tick/drain" 2>&1) || {
        echo "  [drain] drain 请求失败（non-fatal），继续部署"
        return 0
    }
    echo "  [drain] drain 已激活: $(echo "$drain_resp" | grep -o '"remaining":[0-9]*' | head -1 || echo 'ok')"

    # 轮询等待 in_progress 归零
    local elapsed=0 remaining=-1
    while [[ "$elapsed" -lt "$DRAIN_TIMEOUT_SECS" ]]; do
        local status_resp
        status_resp=$(curl -sf --max-time 5 "${brain_url}/api/brain/tick/drain-status" 2>/dev/null || echo "")
        if [[ -n "$status_resp" ]]; then
            remaining=$(echo "$status_resp" | grep -o '"remaining":[0-9]*' | grep -o '[0-9]*' | head -1 || echo "-1")
            if [[ "$remaining" == "0" ]]; then
                echo "  [drain] ✅ in_progress 已归零（${elapsed}s），可安全 swap"
                return 0
            fi
            echo "  [drain] 等待中... remaining=${remaining} (${elapsed}s/${DRAIN_TIMEOUT_SECS}s)"
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done

    # 超时：告警但继续
    local warn_msg="brain-deploy drain 超时 ${DRAIN_TIMEOUT_SECS}s，remaining=${remaining}，强制继续 swap——可能有回调丢失，请检查 in_progress 任务"
    echo "  [drain] ⚠️  $warn_msg"
    send_bark "$warn_msg"
    return 0  # non-fatal，继续部署
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

echo "=== Deploying cecelia-brain v${VERSION} (region=${ENV_REGION}, mode=${DEPLOY_MODE}) ==="
echo ""

# ── 主机 home 目录（兼容 Docker 镜像内 /home/xx 和 macOS /Users/xxx）────────
HOST_HOME="${HOST_HOME:-$HOME}"

if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] DEPLOY_MODE=${DEPLOY_MODE}"
    echo "[dry-run] ROOT_DIR=${ROOT_DIR}"
    echo "[dry-run] HOST_HOME=${HOST_HOME}"
    echo ""
fi

# ─── Docker 模式 ─────────────────────────────────────────────────────────────

if [[ "$DEPLOY_MODE" == "docker" ]]; then

    # 1. Build image
    echo "[1/7] Building image..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] bash $SCRIPT_DIR/brain-build.sh"
    else
        bash "$SCRIPT_DIR/brain-build.sh"
    fi
    echo ""

    # 2. Run migrations in a temporary container
    echo "[2/7] Running migrations..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker run --rm --network host cecelia-brain:${VERSION} node src/migrate.js"
    else
        docker run --rm --network host \
          --env-file "$ROOT_DIR/.env.docker" \
          -e "ENV_REGION=${ENV_REGION}" \
          "cecelia-brain:${VERSION}" \
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
          "cecelia-brain:${VERSION}" \
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
    TARGET_IMG=$(docker inspect "cecelia-brain:${VERSION}" --format '{{.Id}}' 2>/dev/null || echo "")
    if [[ "$DRY_RUN" == false && -n "$CURRENT_IMG" && -n "$TARGET_IMG" && "$CURRENT_IMG" == "$TARGET_IMG" ]]; then
        echo "  [skip] 容器已在 v${VERSION}（image SHA 一致），跳过 recreate"
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
        drain_before_swap
        echo ""
        echo "  [dry-run] bluegreen_swap TARGET_VERSION=${VERSION} BLUE=cecelia-node-brain GREEN=cecelia-node-brain-green PORT=5233"
    elif docker inspect cecelia-node-brain >/dev/null 2>&1; then
        # blue 在跑 → swap 前先 drain（停派发 + 等 in_progress 回调收尾）
        echo "  [7/8] drain 旧 Brain（等 in_progress 归零，超时 ${DRAIN_TIMEOUT_SECS}s）..."
        drain_before_swap
        echo ""

        # blue 是 bridge 网络（docker ps 显示 0.0.0.0:5221->5221），green 用 bridge + -p 5233:5221，
        # 不加 --network host（否则 green 抢占 host 5221 与 blue 冲突）。
        GREEN_ENV=$(docker inspect cecelia-node-brain --format '{{range .Config.Env}}-e {{.}} {{end}}' 2>/dev/null || echo "")
        GREEN_VOL=$(docker inspect cecelia-node-brain --format '{{range .Mounts}}-v {{.Source}}:{{.Destination}}{{if not .RW}}:ro{{end}} {{end}}' 2>/dev/null || echo "")
        export GREEN_RUN_ARGS="${GREEN_ENV} ${GREEN_VOL}"
        # sidecar 需要知道部署根和 region（bluegreen.sh 通过 env 读取）
        export DEPLOY_ROOT_DIR="$ROOT_DIR"
        if ! TARGET_VERSION="${VERSION}" BLUE_NAME=cecelia-node-brain \
             GREEN_NAME=cecelia-node-brain-green TEMP_PORT=5233 HEALTH_TIMEOUT=90 bluegreen_swap; then
            echo "[FAIL] green canary 未通过，已保留旧生产容器(5221 不受影响)，终止部署"
            # blue 仍在运行且已进入 drain 模式 → 恢复正常派发
            echo "  [drain] green 未通过，恢复旧 Brain 派发..."
            curl -sf --max-time 5 -X POST "http://localhost:5221/api/brain/tick/drain-cancel" >/dev/null 2>&1 || true
            exit 1
        fi
    else
        # 无 blue（首次部署）→ 无 outage 风险，跳过 drain + canary 直接起
        echo "  [首次部署] 无旧生产容器，跳过 drain + canary，直接起新容器"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker compose up -d cecelia-brain:${VERSION}"
    elif ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose --env-file "$ROOT_DIR/.env.docker" \
        -f "$ROOT_DIR/docker-compose.yml" up -d; then
        echo ""
        echo "[FAIL] docker compose up -d failed. Rolling back..."
        if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
            PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
            echo "  Rolling back to v${PREV_VERSION}..."
            BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
              docker compose --env-file "$ROOT_DIR/.env.docker" \
                -f "$ROOT_DIR/docker-compose.yml" up -d || true
            echo "  Rolled back to v${PREV_VERSION}"
        else
            echo "  No previous version found. Stopping container."
            docker compose --env-file "$ROOT_DIR/.env.docker" \
              -f "$ROOT_DIR/docker-compose.yml" down || true
        fi
        exit 1
    fi

fi  # end Docker mode

# ─── launchd 模式 ────────────────────────────────────────────────────────────

if [[ "$DEPLOY_MODE" == "launchd" ]]; then

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
    drain_before_swap
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
    DEPLOY_SUCCESS=true
    echo ""
    echo "=== Deploy SUCCESS: cecelia-brain v${VERSION} is healthy (${DEPLOY_MODE}) ==="

    # swap 成功后无条件 drain-cancel（Issue cc28d1af 根因D）：
    # drain_before_swap 的 drain 状态持久化在 working_memory（共享DB），僵尸 in_progress
    # 任务会让 drain 永远等不完 → 120s 超时"继续部署"后不取消 → 新容器 restoreDrainState
    # 恢复 draining → 派发永久瘫痪（0729 16:48 / 0730 10:21 两次实证，均由合并PR自动部署触发）。
    # 部署已收尾，pre-swap 的 drain 使命已结束，新实例不应继承——best-effort 取消。
    echo "  [drain] swap 成功，取消 pre-swap drain（新实例不继承排水状态）..."
    curl -sf --max-time 5 -X POST "http://localhost:5221/api/brain/tick/drain-cancel" >/dev/null 2>&1 || true

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
      # 同 cecelia-run 的 cp identical 防中止
      cp "$BRIDGE_SRC" "$BRIDGE_DST" 2>&1 || true
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
        BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
          docker compose --env-file "$ROOT_DIR/.env.docker" \
            -f "$ROOT_DIR/docker-compose.yml" up -d
        echo "  Rolled back to v${PREV_VERSION}"
    else
        echo "  No previous version found. Stopping container."
        docker compose --env-file "$ROOT_DIR/.env.docker" \
          -f "$ROOT_DIR/docker-compose.yml" down
    fi
fi

exit 1
