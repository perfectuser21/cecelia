#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSIONS_FILE="$ROOT_DIR/.brain-versions"
BRAIN_DIR="$ROOT_DIR/packages/brain"
DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"

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
    seen_file=$(mktemp -t post_deploy_smoke_seen.XXXXXX)
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

# ── 参数解析 ─────────────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
    esac
done

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

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker compose up -d cecelia-brain:${VERSION}"
    elif ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose -f "$ROOT_DIR/docker-compose.yml" up -d; then
        echo ""
        echo "[FAIL] docker compose up -d failed. Rolling back..."
        if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
            PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
            echo "  Rolling back to v${PREV_VERSION}..."
            BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
              docker compose -f "$ROOT_DIR/docker-compose.yml" up -d || true
            echo "  Rolled back to v${PREV_VERSION}"
        else
            echo "  No previous version found. Stopping container."
            docker compose -f "$ROOT_DIR/docker-compose.yml" down || true
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

    # 8. Update cecelia-run on host (self-update: keeps executor in sync with repo)
    echo ""
    echo "[8/8] Updating cecelia-run on host..."
    CECELIA_RUN_SRC="$ROOT_DIR/packages/brain/scripts/cecelia-run.sh"
    CECELIA_RUN_DST="${HOST_HOME}/bin/cecelia-run"
    if [[ -f "$CECELIA_RUN_SRC" ]]; then
      cp "$CECELIA_RUN_SRC" "$CECELIA_RUN_DST"
      chmod +x "$CECELIA_RUN_DST"
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
      cp "$BRIDGE_SRC" "$BRIDGE_DST"
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

if [[ "$DEPLOY_MODE" == "launchd" ]]; then
    echo "  Brain failed to start. Check logs: tail -50 $ROOT_DIR/logs/brain-error.log"
    echo "  Manual restart: launchctl kickstart -k gui/$(id -u)/${LAUNCHD_SERVICE}"
else
    echo "[FAIL] Rolling back..."
    if [ -f "$VERSIONS_FILE" ] && [ "$(wc -l < "$VERSIONS_FILE")" -ge 2 ]; then
        PREV_VERSION=$(tail -2 "$VERSIONS_FILE" | head -1)
        echo "  Rolling back to v${PREV_VERSION}..."
        BRAIN_VERSION="${PREV_VERSION}" ENV_REGION="${ENV_REGION}" \
          docker compose -f "$ROOT_DIR/docker-compose.yml" up -d
        echo "  Rolled back to v${PREV_VERSION}"
    else
        echo "  No previous version found. Stopping container."
        docker compose -f "$ROOT_DIR/docker-compose.yml" down
    fi
fi

exit 1
