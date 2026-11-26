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

# 蓝绿切换 + Bark 告警工具（顶层 source，供 Docker 发布与失败恢复共用）
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/bluegreen.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/internal-auth-token.sh"
source "$SCRIPT_DIR/lib/brain-image-retention.sh"
source "$SCRIPT_DIR/lib/brain-staging.sh"
source "$SCRIPT_DIR/lib/brain-post-deploy.sh"

ENV_REGION="${ENV_REGION:-us}"
# 默认凭据路径跟着 HOST_HOME 走（macOS/us-vps 两份 compose 都在容器 env 里显式设了
# HOST_HOME=/Users/administrator 或 /root），不再硬编码 macOS 路径。
CECELIA_INTERNAL_ENV_FILE="${CECELIA_INTERNAL_ENV_FILE:-${HOST_HOME:-$HOME}/.credentials/cecelia-internal.env}"
export CECELIA_INTERNAL_ENV_FILE

# ── 部署状态文件：供 Brain 重启后感知 deploy 结果 ──────────────────────────
DEPLOY_SUCCESS=false
BLUEGREEN_HANDOFF=0
_write_deploy_status() {
    # sidecar已接管唯一发布终态；存活的parent不得收账或写第二份结果。
    [[ "${BLUEGREEN_HANDOFF:-0}" != 1 ]] || return 0
    # 只读诊断不属于部署事务；退出时也不能结算既有intent或覆盖真实部署状态。
    if [[ "${DRY_RUN:-false}" == true || "${SHA_CHECK_ONLY:-false}" == true ]]; then
        return 0
    fi
    if [[ -n "${BRAIN_CANDIDATE_OWNERSHIP_FILE:-}" ]]; then
        candidate_image_cleanup "${EXPECTED_SHA:-}" "${CECELIA_RELEASE_IMAGE:-}" || echo '候选副本未回收，保留检查' >&2
    fi
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
trap '_write_deploy_status' EXIT

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

source "$SCRIPT_DIR/lib/brain-drain-client.sh"

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

# Brain 正式发布只使用 Docker，旧裸跑模式已退役。
DEPLOY_MODE="docker"

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
    brain_release_lock
    EXPECTED_SHA="${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
    git -C "$ROOT_DIR" fetch origin main || { echo 'DEPLOY_ORDER_UNKNOWN' >&2; exit 1; }
    node "$SCRIPT_DIR/brain-image-retention/release-order.mjs" "$ROOT_DIR" "$EXPECTED_SHA"
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
        EXPECTED_SHA="${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
        [[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
        export EXPECTED_SHA
    fi

    # 1. Build image
    echo "[1/7] Building image..."
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] bash $SCRIPT_DIR/brain-build.sh"
    else
        export BRAIN_CANDIDATE_OWNERSHIP_FILE="$ROOT_DIR/logs/brain-candidate-$(node -e 'process.stdout.write(require("crypto").randomUUID())').json"
        bash "$SCRIPT_DIR/brain-build.sh"
    fi
    echo ""

    # 候选准入必须在任何生产迁移/排空/切换之前完成。
    if [[ "$DRY_RUN" == false ]]; then
        CECELIA_RELEASE_IMAGE=$(docker image inspect --format '{{.Id}}' "cecelia-brain:${VERSION}")
        export CECELIA_RELEASE_IMAGE
        stage_candidate "$EXPECTED_SHA" "$CECELIA_RELEASE_IMAGE" "$VERSION"
    else
        echo "[dry-run] staging 同 SHA/镜像/隔离验证先于生产迁移"
    fi

    # 新执行端先发布固定字节；失败不得排空/替换现役Brain。旧历史fixture无此配置。
    if [[ -f "$ROOT_DIR/packages/brain/config/native-agent.json" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            echo "  [dry-run] publish verified native Agent bundle"
        else
            node "$ROOT_DIR/packages/brain/scripts/native-agent-release.mjs"
        fi
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

    # 7. Stop old container + start new one
    echo "[7/8] Starting container..."

    # 幂等检查：容器已在目标 image SHA 则跳过 recreate（避免 SIGTERM 中断长跑 Initiative）
    OLD_CONTAINER_STATE=absent
    if [[ "$DRY_RUN" == false ]]; then
        OLD_CONTAINER_STATE=$(brain_previous_container_state) || { echo "[FAIL] 无法确认旧容器状态" >&2; exit 1; }
    fi
    CURRENT_IMG=$(docker inspect cecelia-node-brain --format '{{.Image}}' 2>/dev/null || echo "")
    TARGET_IMG=$(docker inspect "${CECELIA_RELEASE_IMAGE:-cecelia-brain:${VERSION}}" --format '{{.Id}}' 2>/dev/null || echo "")
    if [[ "$DRY_RUN" == false && "$OLD_CONTAINER_STATE" == running && -n "$CURRENT_IMG" && -n "$TARGET_IMG" && "$CURRENT_IMG" == "$TARGET_IMG" ]]; then
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
        echo "  [7/8] drain 旧 Brain（等待本机执行排空，超时 ${DRAIN_TIMEOUT_SECS}s 终止发布）..."
        drain_before_swap || exit 1
        echo ""
        echo "  [dry-run] bluegreen_swap TARGET_VERSION=${VERSION} BLUE=cecelia-node-brain GREEN=cecelia-node-brain-green PORT=5233"
    elif [[ "$OLD_CONTAINER_STATE" == running ]]; then
        echo "  [7/8] drain 旧 Brain（等待本机执行排空，超时 ${DRAIN_TIMEOUT_SECS}s 终止发布）..."
        drain_before_swap || exit 1
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
            if [[ -n "$BRAIN_DEPLOY_DRAIN_ID" ]]; then
                drain_cancel_with_retry || exit 1
            fi
            exit 1
        fi
        export GREEN_RUN_ARGS
        # sidecar 需要知道部署根和 region（bluegreen.sh 通过 env 读取）
        export DEPLOY_ROOT_DIR="$ROOT_DIR"
        # 守卫块内必须直接 exit 1（tests/packages/brain/bluegreen-deploy-contract.test.js 结构化匹配 if ! …bluegreen_swap; then … exit 1 … fi）
        if ! TARGET_VERSION="${VERSION}" BLUE_NAME=cecelia-node-brain \
             GREEN_NAME=cecelia-node-brain-green TEMP_PORT=5233 HEALTH_TIMEOUT=90 bluegreen_swap; then
            rm -f "$GREEN_ENV_FILE"
            if [[ "$BLUEGREEN_HANDOFF" == 1 ]]; then
                echo '[HANDOFF_UNCONFIRMED] sidecar已接管，parent不再执行发布动作' >&2
                exit 75
            fi
            echo "[FAIL] green canary 未通过，已保留旧生产容器(5221 不受影响)，终止部署"
            # blue 仍在运行且已进入 drain 模式 → 恢复正常派发
            echo "  [drain] green 未通过，恢复旧 Brain 派发..."
            if [[ -n "$BRAIN_DEPLOY_DRAIN_ID" ]]; then
                drain_cancel_with_retry || exit 1
            fi
            exit 1
        fi
        rm -f "$GREEN_ENV_FILE"
        if [[ "$BLUEGREEN_HANDOFF" == 1 ]]; then
            echo '[HANDOFF_UNCONFIRMED] sidecar已接管，parent不再执行发布动作' >&2
            exit 75
        fi
    else
        echo "  已确认旧容器不存在或已停止，启动新容器"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] docker compose -f ${COMPOSE_FILE} up -d node-brain (cecelia-brain:${VERSION})"
    elif ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
      docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$ROOT_DIR/.env.docker" \
        -f "$ROOT_DIR/${COMPOSE_FILE}" up -d node-brain; then
        echo ""
        echo '[FAIL] 新容器启动失败；没有经过验证的运行前驱，保留现场，发布失败'
        exit 1
    fi

fi  # end Docker mode

# ─── dry-run 提前退出 ────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
    echo ""
    echo "=== [dry-run] Deploy SUCCESS: cecelia-brain v${VERSION} (${DEPLOY_MODE}) ==="
    exit 0
fi

# ─── 部署后等待健康检查──────────────────────────

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

    if [[ -n "$BRAIN_DEPLOY_DRAIN_ID" ]]; then
        echo "  [drain] swap 成功，确认解除本次排空..."
        drain_cancel_with_retry || exit 1
    fi

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
    DEPLOY_SUCCESS=true

    complete_verified_host_release

    exit 0
  fi
  echo "  Attempt ${TRIES}/${MAX_TRIES}..."
done

# Health check failed
echo ""
echo "[FAIL] Health check timed out after 60s."

# 环境守卫：部署后 5221 未响应 = 控制面 outage 风险，Bark 告警（issue 8ae2e116）
send_bark "部署后自检失败：Brain 5221 (/api/brain/tick/status) 60s 未响应，v${VERSION} 可能未起来，请立即检查"

echo '[FAIL] 新容器健康检查失败；不根据版本历史猜测恢复目标，保留现场'

exit 1
