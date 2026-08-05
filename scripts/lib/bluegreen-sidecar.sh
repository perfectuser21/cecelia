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
#   BARK_TOKEN    — Bark 推送 token（可选，未设则静默）
set -uo pipefail

BRAIN_VERSION="${BRAIN_VERSION:?BRAIN_VERSION 必填}"
ENV_REGION="${ENV_REGION:-us}"
DEPLOY_ROOT="${DEPLOY_ROOT:?DEPLOY_ROOT 必填}"
BARK_TOKEN="${BARK_TOKEN:-}"
# sidecar 本身由 `docker run` 起在独立容器内（见 bluegreen.sh bluegreen_swap），
# 不在 node-brain 的 compose 网络里，也未 --network host。要够到宿主发布的
# 5221 必须走 host.docker.internal（同 bluegreen_canary_host 的 /.dockerenv 判据，
# 这里恒为容器内执行，直接定死，不必再判 /.dockerenv）。可用 BRAIN_URL 覆盖测试。
BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"

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

# ── drain 收尾（issue 53e7ee4b 根治①）─────────────────────────────
# 部署型 drain 由 brain-deploy.sh pre-swap 挂上；Docker 蓝绿下 deploy 进程随 blue
# 容器被 docker rm -f 截断，其 brain-deploy.sh:520 的 drain_cancel_with_retry 永远够
# 不着——sidecar 是 swap 后唯一存活路径，必须由这里收 drain。cancel 失败不 fail 部署
# （15min 过期闸与 getDrainStatus 归零是下层兜底），但必须红日志留痕。
#
# cancel 前先等 healthz 就绪：容器刚起时 Brain 尚未监听端口，原先 5×5s(~20-45s) 的
# cancel 重试兜不住 Brain 实测启动耗时（>68s），会在 Brain 还没起来时就把 5 次重试
# 打空。按 CI 预算轮询 healthz：最多 90 次、每次 2s，通了立即 break；超时打 ❌ 红日
# 志但继续往下尝试 drain-cancel（"不 fail 部署"原则不变）。主路径成功分支与
# blue-fallback 成功分支都要收 drain，抽成函数两处各调一次，避免重复漂移。
cancel_drain_after_up() {
  echo "[sidecar] 等待 Brain healthz 就绪后再收 drain..."
  HEALTHZ_OK=0
  for i in $(seq 1 90); do
    if curl -fsm 3 "${BRAIN_URL}/api/brain/healthz" >/dev/null 2>&1; then
      echo "[sidecar] healthz 就绪（第 ${i} 次，约 $((i * 2))s）"
      HEALTHZ_OK=1; break
    fi
    sleep 2
  done
  [ "$HEALTHZ_OK" = "1" ] || echo "[sidecar] ❌ healthz 轮询 90 次未就绪，仍继续尝试 drain-cancel"

  DRAIN_CANCEL_OK=0
  for i in 1 2 3 4 5; do
    if curl -fsm 5 -X POST "${BRAIN_URL}/api/brain/tick/drain-cancel" >/dev/null 2>&1; then
      echo "[sidecar] drain-cancel 成功（第 ${i} 次尝试）"
      DRAIN_CANCEL_OK=1; break
    fi
    echo "[sidecar] drain-cancel 第 ${i} 次失败，5s 后重试"
    sleep 5
  done
  [ "$DRAIN_CANCEL_OK" = "1" ] || echo "[sidecar] ❌ drain-cancel 5 次全失败——依赖 15min 过期闸兜底，请检查（issue 53e7ee4b）"
}

# ── 等待 blue 容器消失（brain-deploy.sh 将 docker rm -f blue）───────────────
echo "[sidecar] 等待 cecelia-node-brain 消失..."
for i in $(seq 1 30); do
  docker inspect cecelia-node-brain >/dev/null 2>&1 || { echo "[sidecar] blue 已消失 (${i}s)"; break; }
  sleep 1
done

# ── 主路径：用新版镜像 compose up ────────────────────────────────────────────
echo "[sidecar] compose up node-brain (BRAIN_VERSION=${BRAIN_VERSION})..."
if BRAIN_VERSION="$BRAIN_VERSION" ENV_REGION="$ENV_REGION" \
    docker compose --env-file "$DEPLOY_ROOT/.env.docker" \
      -f "$DEPLOY_ROOT/docker-compose.yml" up -d node-brain 2>&1; then
  echo "[sidecar] ✅ compose up 成功 v${BRAIN_VERSION}"

  cancel_drain_after_up

  exit 0
fi

PRIMARY_EXIT=$?
echo "[sidecar] ❌ compose up 失败 exit=${PRIMARY_EXIT}，尝试 blue-fallback 恢复..."

# ── 恢复路径：用 blue-fallback 镜像重启（bluegreen_swap 在起 sidecar 前已 tag）──
# blue-fallback = 删 blue 前由 bluegreen_swap 打的 docker tag，是最后一次健康 blue 的快照。
# 退出码语义：fallback 成功 → exit 0（5221 已恢复）；fallback 也失败 → exit 1（5221 宕机）
if BRAIN_VERSION=blue-fallback ENV_REGION="$ENV_REGION" \
    docker compose --env-file "$DEPLOY_ROOT/.env.docker" \
      -f "$DEPLOY_ROOT/docker-compose.yml" up -d node-brain 2>&1; then
  echo "[sidecar] ✅ blue-fallback 恢复成功，5221 已恢复旧版本"
  _sidecar_bark "⚠️ 蓝绿 sidecar：v${BRAIN_VERSION} 新镜像启动失败，已回退 blue-fallback，5221 已恢复，请检查新镜像问题"
  _sidecar_log "[sidecar-partial-fail] primary_exit=${PRIMARY_EXIT} brain_version=${BRAIN_VERSION} recovered=blue-fallback"

  cancel_drain_after_up

  exit 0  # 5221 已恢复，sidecar 整体视为成功
else
  FALLBACK_EXIT=$?
  echo "[sidecar] ❌ blue-fallback 也失败 exit=${FALLBACK_EXIT}！5221 宕机！需人工介入！"
  _sidecar_bark "🚨 蓝绿 sidecar 全失败：v${BRAIN_VERSION} 和 blue-fallback 均无法启动！5221 宕机！请立即人工介入！"
  _sidecar_log "[sidecar-full-fail] primary_exit=${PRIMARY_EXIT} fallback_exit=${FALLBACK_EXIT} brain_version=${BRAIN_VERSION} recovered=none"
  exit 1  # 5221 宕机，明确报错
fi
