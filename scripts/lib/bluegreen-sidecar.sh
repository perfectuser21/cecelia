#!/usr/bin/env bash
# bluegreen-sidecar.sh — 蓝绿切换 sidecar 内部脚本
#
# 由 bluegreen_swap 在独立容器中启动（docker run -d --rm），不受 brain 容器生命周期影响。
# 等待 blue 消失后执行 compose up；失败时走 blue-fallback 恢复，并 Bark 告警。
#
# 所有入参通过 env 传入（由 bluegreen_swap 的 docker run -e 注入）：
#   BRAIN_VERSION — 新版镜像 tag（必填）
#   ENV_REGION    — 环境区域（默认 us）
#   DEPLOY_ROOT   — cecelia-deploy-main 在宿主机的绝对路径（必填）
#   CECELIA_INTERNAL_ENV_FILE — 只读挂载的内部鉴权凭据 SSOT（必填）
#   BARK_TOKEN    — Bark 推送 token（可选，未设则静默）
set -uo pipefail

BRAIN_VERSION="${BRAIN_VERSION:?BRAIN_VERSION 必填}"
ENV_REGION="${ENV_REGION:-us}"
DEPLOY_ROOT="${DEPLOY_ROOT:?DEPLOY_ROOT 必填}"

# compose 文件按 region 选：us-vps 有专用 compose（host 网络 + Linux 路径），
# 硬编码 docker-compose.yml（macOS 版）会把新 Brain 起进 bridge 网络连不上
# 宿主 5432 postgres，崩溃循环（2026-09-17 04:5x 实锤，手动正确 compose 止血）。
COMPOSE_FILE_PATH="$DEPLOY_ROOT/docker-compose.yml"
if [[ "$ENV_REGION" == "us" && -f "$DEPLOY_ROOT/docker-compose.us-vps.yml" ]]; then
  COMPOSE_FILE_PATH="$DEPLOY_ROOT/docker-compose.us-vps.yml"
fi
CECELIA_INTERNAL_ENV_FILE="${CECELIA_INTERNAL_ENV_FILE:?CECELIA_INTERNAL_ENV_FILE 必填}"
BARK_TOKEN="${BARK_TOKEN:-}"
source "$DEPLOY_ROOT/scripts/lib/brain-image-retention.sh"
# 收尾使用既有 Docker socket 进入固定 Brain 容器；不依赖 bridge→宿主端口。
EXPECTED_SHA="${EXPECTED_SHA:?EXPECTED_SHA 必填}"
[[ "$BRAIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1

# 告警（non-fatal，token 缺失静默）
_sidecar_bark() {
  local msg="$1"
  [ -z "$BARK_TOKEN" ] && return 0
  local body
  body=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$msg" 2>/dev/null \
         || printf '%s' "$msg")
  curl -sf --max-time 10 "https://api.day.app/$BARK_TOKEN/Brain部署/$body?group=brain-deploy" \
    >/dev/null 2>&1 || true
}

# 写 sidecar 失败日志到宿主机挂载目录（容器死亡后可查）
_sidecar_log() {
  mkdir -p "$DEPLOY_ROOT/logs" 2>/dev/null || true
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)
  printf '%s %s\n' "$ts" "$1" \
    >> "$DEPLOY_ROOT/logs/cecelia-deploy-sidecar-failures.log" 2>/dev/null || true
}

# 镜像身份在 compose 前冻结；仅输出非敏感 GIT_SHA，不读取或打印其它环境值。
_sidecar_image() {
  docker image inspect --format '{{.Id}}|{{json .RepoTags}}|{{range .Config.Env}}{{if eq (index (split . "=") 0) "GIT_SHA"}}{{.}}{{end}}{{end}}' "$1"
}
_sidecar_same_target() {
  local observed
  observed=$(docker inspect --format '{{.Id}} {{.Image}} {{.Name}} {{.State.Running}} {{index .Config.Labels "com.docker.compose.service"}}' cecelia-node-brain) || return 1
  [[ "$observed" == "$TARGET_CONTAINER $TARGET_IMAGE /cecelia-node-brain true node-brain" ]]
}
_sidecar_pin_target() {
  local outcome="$1" observed extra name running service
  if [[ "$outcome" == success ]]; then
    TARGET_IMAGE="$PRIMARY_IMAGE"; TARGET_SHA="$EXPECTED_SHA"; TARGET_TAGS="$PRIMARY_TAGS"
  else
    TARGET_IMAGE="$FALLBACK_IMAGE"; TARGET_SHA="$FALLBACK_SHA"; TARGET_TAGS="$FALLBACK_TAGS"
  fi
  [[ "$TARGET_IMAGE" =~ ^sha256:[a-f0-9]{64}$ && "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || return 1
  observed=$(docker inspect --format '{{.Id}} {{.Image}} {{.Name}} {{.State.Running}} {{index .Config.Labels "com.docker.compose.service"}}' cecelia-node-brain) || return 1
  read -r TARGET_CONTAINER extra name running service <<< "$observed"
  [[ "$TARGET_CONTAINER" =~ ^[a-f0-9]{64}$ ]] && _sidecar_same_target
}
_sidecar_health() {
  local health
  _sidecar_same_target || return 1
  docker exec "$TARGET_CONTAINER" curl -q -fsm 3 http://127.0.0.1:5221/api/brain/healthz >/dev/null 2>&1 || return 1
  health=$(docker exec "$TARGET_CONTAINER" curl -q -fsm 5 http://127.0.0.1:5221/api/brain/health) || return 1
  printf '%s' "$health" | node -e '
    let data="";process.stdin.on("data",x=>data+=x);process.stdin.on("end",()=>{
      try { const h=JSON.parse(data), [sha,tags,version]=process.argv.slice(1);
        if(h.status!=="healthy" || h.git_sha!==sha || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(h.version)
          || !JSON.parse(tags).includes("cecelia-brain:"+h.version) || (version && h.version!==version)) process.exit(1);
      } catch {process.exit(1);}
    });' "$TARGET_SHA" "$TARGET_TAGS" "$HEALTH_VERSION" || return 1
  _sidecar_same_target
}
# 保留官方 ledger 的身份、锁、健康、镜像版本/SHA和幂等回执校验，只改变执行位置。
retention_finish() {
  [[ -n "${CECELIA_IMAGE_DEPLOYMENT_ID:-}" ]] || return 0
  local receipt
  _sidecar_same_target || return 1
  receipt=$(docker exec -e BRAIN_URL=http://127.0.0.1:5221 \
    -e "CECELIA_IMAGE_RETENTION_DIR=${CECELIA_IMAGE_RETENTION_DIR}" "$TARGET_CONTAINER" \
    node /app/scripts/brain-image-retention/cli.mjs finish "$CECELIA_IMAGE_DEPLOYMENT_ID" "$1") || return 1
  [[ "$receipt" == "$1" ]] && _sidecar_same_target
}

# 健康未确认、身份漂移、drain失败都不进入finish，不把compose成功当部署成功。
cancel_drain_after_up() {
  local outcome="$1" i response
  HEALTH_VERSION=""; [[ "$outcome" != success ]] || HEALTH_VERSION="$BRAIN_VERSION"
  if ! _sidecar_pin_target "$outcome"; then
    _sidecar_log "[completion-fail] target_identity_unconfirmed brain_version=${BRAIN_VERSION}"
    return 1
  fi
  echo "[sidecar] 等待固定 Brain 容器 healthz 与版本/SHA 就绪后再收 drain..."
  HEALTHZ_OK=0
  for i in $(seq 1 90); do
    # 身份漂移不重新选择容器，也不尝试回退或删除。
    _sidecar_same_target || break
    if _sidecar_health; then HEALTHZ_OK=1; break; fi
    sleep 2
  done
  if [ "$HEALTHZ_OK" != "1" ]; then
    _sidecar_log "[cancel-drain-fail] healthz_poll_timeout_or_identity_mismatch brain_version=${BRAIN_VERSION}"
    return 1
  fi
  DRAIN_CANCEL_OK=0
  for i in 1 2 3 4 5; do
    _sidecar_same_target || break
    if response=$(docker exec "$TARGET_CONTAINER" curl -q -fsm 5 -X POST http://127.0.0.1:5221/api/brain/tick/drain-cancel) \
      && printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{if(JSON.parse(s).success!==true)process.exit(1)}catch{process.exit(1)}})' \
      && _sidecar_same_target; then
      DRAIN_CANCEL_OK=1; break
    fi
    sleep 5
  done
  if [ "$DRAIN_CANCEL_OK" != "1" ]; then
    _sidecar_log "[cancel-drain-fail] drain_cancel_retries_exhausted brain_version=${BRAIN_VERSION}"
    return 1
  fi
}

PRIMARY_METADATA=$(_sidecar_image "cecelia-brain:${BRAIN_VERSION}") || exit 1
IFS='|' read -r PRIMARY_IMAGE PRIMARY_TAGS PRIMARY_SHA <<< "$PRIMARY_METADATA"
if [[ "$PRIMARY_SHA" != "GIT_SHA=$EXPECTED_SHA" || ! "$PRIMARY_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  _sidecar_log "[completion-fail] requested_image_sha_mismatch brain_version=${BRAIN_VERSION}"
  exit 1
fi
FALLBACK_IMAGE=""; FALLBACK_TAGS='[]'; FALLBACK_SHA=""
if FALLBACK_METADATA=$(_sidecar_image cecelia-brain:blue-fallback 2>/dev/null); then
  IFS='|' read -r FALLBACK_IMAGE FALLBACK_TAGS FALLBACK_SHA <<< "$FALLBACK_METADATA"
  FALLBACK_SHA="${FALLBACK_SHA#GIT_SHA=}"
fi

# ── 等待 blue 容器消失（brain-deploy.sh 将 docker rm -f blue）───────────────
echo "[sidecar] 等待 cecelia-node-brain 消失..."
for i in $(seq 1 30); do
  docker inspect cecelia-node-brain >/dev/null 2>&1 || { echo "[sidecar] blue 已消失 (${i}s)"; break; }
  sleep 1
done

# ── 主路径：用新版镜像 compose up ────────────────────────────────────────────
echo "[sidecar] compose up node-brain (BRAIN_VERSION=${BRAIN_VERSION})..."
if BRAIN_VERSION="$BRAIN_VERSION" ENV_REGION="$ENV_REGION" \
    docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$DEPLOY_ROOT/.env.docker" \
      -f "$COMPOSE_FILE_PATH" up -d node-brain 2>&1; then
  echo "[sidecar] ✅ compose up 成功 v${BRAIN_VERSION}"

  cancel_drain_after_up success || exit 1
  retention_finish success || { _sidecar_log "[completion-fail] retention_finish_unconfirmed outcome=success"; exit 1; }

  exit 0
else
  PRIMARY_EXIT=$?
fi

echo "[sidecar] ❌ compose up 失败 exit=${PRIMARY_EXIT}，尝试 blue-fallback 恢复..."

# ── 恢复路径：用 blue-fallback 镜像重启（bluegreen_swap 在起 sidecar 前已 tag）──
# blue-fallback = 删 blue 前由 bluegreen_swap 打的 docker tag，是最后一次健康 blue 的快照。
# 退出码语义：fallback 成功 → exit 0（5221 已恢复）；fallback 也失败 → exit 1（5221 宕机）
if BRAIN_VERSION=blue-fallback ENV_REGION="$ENV_REGION" \
    docker compose ${RETENTION_COMPOSE_ARGS[@]+"${RETENTION_COMPOSE_ARGS[@]}"} --env-file "$DEPLOY_ROOT/.env.docker" \
      -f "$COMPOSE_FILE_PATH" up -d node-brain 2>&1; then
  echo "[sidecar] ✅ blue-fallback 恢复成功，5221 已恢复旧版本"
  _sidecar_bark "⚠️ 蓝绿 sidecar：v${BRAIN_VERSION} 新镜像启动失败，已回退 blue-fallback，5221 已恢复，请检查新镜像问题"
  _sidecar_log "[sidecar-partial-fail] primary_exit=${PRIMARY_EXIT} brain_version=${BRAIN_VERSION} recovered=blue-fallback"

  cancel_drain_after_up recovered || exit 1
  retention_finish recovered || { _sidecar_log "[completion-fail] retention_finish_unconfirmed outcome=recovered"; exit 1; }

  exit 0  # 5221 已恢复，sidecar 整体视为成功
else
  FALLBACK_EXIT=$?
  echo "[sidecar] ❌ blue-fallback 也失败 exit=${FALLBACK_EXIT}！5221 宕机！需人工介入！"
  _sidecar_bark "🚨 蓝绿 sidecar 全失败：v${BRAIN_VERSION} 和 blue-fallback 均无法启动！5221 宕机！请立即人工介入！"
  _sidecar_log "[sidecar-full-fail] primary_exit=${PRIMARY_EXIT} fallback_exit=${FALLBACK_EXIT} brain_version=${BRAIN_VERSION} recovered=none"
  exit 1  # 5221 宕机，明确报错
fi
