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

# 外层时限覆盖 Docker socket/exec 握手；输出有界后才交给 shell 解析。
# timeout/Node 留在新版 sidecar，旧 fallback 内仍只依赖 curl。
_sidecar_docker() {
  timeout -k 2 8 docker "$@" | node -e '
    let text="", size=0;
    process.stdin.on("data", data=>{
      size+=data.length;if(size>262144)process.exit(1);text+=data.toString();
    });
    process.stdin.on("end",()=>process.stdout.write(text));'
}

# 镜像身份在 compose 前冻结；仅输出非敏感 GIT_SHA，不读取或打印其它环境值。
_sidecar_image() {
  _sidecar_docker image inspect --format '{{.Id}}|{{json .RepoTags}}|{{range .Config.Env}}{{if eq (index (split . "=") 0) "GIT_SHA"}}{{.}}{{end}}{{end}}' "$1"
}
_sidecar_same_target() {
  local observed
  observed=$(_sidecar_docker inspect --format '{{.Id}} {{.Image}} {{.Name}} {{.State.Running}} {{index .Config.Labels "com.docker.compose.service"}}' cecelia-node-brain) || return 1
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
  observed=$(_sidecar_docker inspect --format '{{.Id}} {{.Image}} {{.Name}} {{.State.Running}} {{index .Config.Labels "com.docker.compose.service"}}' cecelia-node-brain) || return 1
  read -r TARGET_CONTAINER extra name running service <<< "$observed"
  [[ "$TARGET_CONTAINER" =~ ^[a-f0-9]{64}$ ]] && _sidecar_same_target
}
# /healthz 以 tick 存活为 200 条件；tick 被有意封停（决策 751f73be）后恒为 503（body: db=connected, tick=dead）。
# 只放行「503 且 db=connected」——DB 连不上仍失败；tick 死亡是否属有意封停，由后面的 /health 折算判定
#（scheduler.enabled=false 才折算，否则 degraded 照旧失败）。传输失败/其他状态码一律失败。
_sidecar_healthz() {
  local out code body
  out=$(_sidecar_docker exec "$TARGET_CONTAINER" curl -q -sm 3 --max-filesize 262144 -w '\n%{http_code}' http://127.0.0.1:5221/api/brain/healthz 2>/dev/null) || return 1
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  [[ "$code" == 200 ]] && return 0
  [[ "$code" == 503 ]] || return 1
  printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{
    try{process.exit(JSON.parse(s).db==="connected"?0:1)}catch{process.exit(1)}})'
}
_sidecar_health() {
  local health
  _sidecar_same_target || return 1
  _sidecar_healthz || return 1
  health=$(_sidecar_docker exec "$TARGET_CONTAINER" curl -q -fsm 5 --max-filesize 262144 http://127.0.0.1:5221/api/brain/health) || return 1
  # 健康口径与官方收账同源（policy.deployHealth）：tick 被有意封停（决策 751f73be）使 /health 恒为 degraded，
  # 仅折算这一个原因；导入失败（旧镜像无该模块）= 严格口径，不放宽。version/git_sha/tags 逐项核对不变。
  printf '%s' "$health" | node --input-type=module -e '
    const [sha,tags,version]=process.argv.slice(1);
    let data="";for await (const x of process.stdin) data+=x;
    let fold=h=>h;
    try { const m=await import(process.env.CECELIA_RETENTION_POLICY||"/app/scripts/brain-image-retention/policy.mjs");
      if(typeof m.deployHealth==="function") fold=h=>({...h,...m.deployHealth(h)}); } catch {}
    try { const h=fold(JSON.parse(data));
      if(h.status!=="healthy" || h.git_sha!==sha || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(h.version)
        || !JSON.parse(tags).includes("cecelia-brain:"+h.version) || (version && h.version!==version)) process.exit(1);
    } catch {process.exit(1);}' "$TARGET_SHA" "$TARGET_TAGS" "$HEALTH_VERSION" || return 1
  _sidecar_same_target
}
# 当前发布的官方CLI持锁收尾；健康探测在固定目标容器内执行，旧fallback无需新CLI。
# 单次 finish 可能因锁被 janitor 占用（IMAGE_RETENTION_BUSY）等瞬时原因失败；只试一次会把 pending 留在台账，
# 下一次 begin 抛 DEPLOYMENT_PENDING 卡死整条部署链（10-09 三次，约 7 小时）。故有界重试（退避+总时长上限），
# 每次失败的退出码与 stderr 落 sidecar 失败日志；身份漂移不重试。finish 本身幂等，重复调用不会重复记成功史。
RETENTION_FINISH_ATTEMPTS="${RETENTION_FINISH_ATTEMPTS:-5}"
RETENTION_FINISH_DEADLINE_SECS="${RETENTION_FINISH_DEADLINE_SECS:-180}"
RETENTION_FINISH_LAST=""
_retention_finish_once() {
  local errfile="$1" receipt
  receipt=$(BRAIN_URL=http://127.0.0.1:5221 CECELIA_IMAGE_EXPECTED_CONTAINER_ID="$TARGET_CONTAINER" \
    timeout -k 5 60 node /app/scripts/brain-image-retention/cli.mjs finish "$CECELIA_IMAGE_DEPLOYMENT_ID" "$2" 2>"$errfile") || return $?
  [[ "$receipt" == "$2" ]] || { printf 'RECEIPT_MISMATCH:%s' "${receipt:0:64}" >> "$errfile"; return 1; }
}
retention_finish() {
  [[ -n "${CECELIA_IMAGE_DEPLOYMENT_ID:-}" ]] || return 0
  local outcome="$1" attempt=0 delay=3 code err errfile started=$SECONDS
  [[ "$RETENTION_FINISH_ATTEMPTS" =~ ^[1-9][0-9]?$ ]] || RETENTION_FINISH_ATTEMPTS=5
  errfile=$(mktemp 2>/dev/null) || errfile="/tmp/sidecar-finish-$$.err"
  while (( attempt < RETENTION_FINISH_ATTEMPTS )); do
    attempt=$((attempt + 1))
    if ! _sidecar_same_target; then
      RETENTION_FINISH_LAST="attempts=${attempt} exit=identity stderr=target_identity_drift"; break
    fi
    : > "$errfile"
    if _retention_finish_once "$errfile" "$outcome" && _sidecar_same_target; then
      rm -f "$errfile"; return 0
    else
      code=$?
    fi
    err=$(tr '\n\r\t' '   ' < "$errfile" 2>/dev/null | head -c 300); err="${err// /_}"
    RETENTION_FINISH_LAST="attempts=${attempt} exit=${code} stderr=${err:-none}"
    _sidecar_log "[completion-retry] retention_finish attempt=${attempt}/${RETENTION_FINISH_ATTEMPTS} outcome=${outcome} exit=${code} stderr=${err:-none}"
    (( attempt < RETENTION_FINISH_ATTEMPTS )) || break
    (( SECONDS - started + delay <= RETENTION_FINISH_DEADLINE_SECS )) || break
    sleep "$delay"; delay=$((delay * 2))
  done
  rm -f "$errfile"
  return 1
}
# 最终收账失败：落日志 + Bark 告警（pending 原样保留，下一次 begin 由 reconcile 核验补收账或中止）。
_retention_finish_failed() {
  _sidecar_log "[completion-fail] retention_finish_unconfirmed outcome=$1 ${RETENTION_FINISH_LAST}"
  _sidecar_bark "🚨 部署收账失败 v${BRAIN_VERSION} outcome=$1（${RETENTION_FINISH_LAST}），台账 pending 未清，下次部署将先核验补收账"
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
    if response=$(_sidecar_docker exec "$TARGET_CONTAINER" curl -q -fsm 5 --max-filesize 262144 -X POST http://127.0.0.1:5221/api/brain/tick/drain-cancel) \
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
  retention_finish success || { _retention_finish_failed success; exit 1; }

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
  retention_finish recovered || { _retention_finish_failed recovered; exit 1; }

  exit 0  # 5221 已恢复，sidecar 整体视为成功
else
  FALLBACK_EXIT=$?
  echo "[sidecar] ❌ blue-fallback 也失败 exit=${FALLBACK_EXIT}！5221 宕机！需人工介入！"
  _sidecar_bark "🚨 蓝绿 sidecar 全失败：v${BRAIN_VERSION} 和 blue-fallback 均无法启动！5221 宕机！请立即人工介入！"
  _sidecar_log "[sidecar-full-fail] primary_exit=${PRIMARY_EXIT} fallback_exit=${FALLBACK_EXIT} brain_version=${BRAIN_VERSION} recovered=none"
  exit 1  # 5221 宕机，明确报错
fi
