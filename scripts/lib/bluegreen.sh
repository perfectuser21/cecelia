#!/usr/bin/env bash
# scripts/lib/bluegreen.sh
# 蓝绿切换：green canary 验证健康后才切；失败保留 blue 原封不动。
# 可被 brain-deploy.sh source，也可被单测 source 调用（docker 命令走 PATH，可 mock）。
#
# 根因：brain-deploy.sh 原先"先删后建"——docker rm -f blue → compose up 建新，
# 坏镜像/中断时旧容器已删致 5221 outage（2026-07-05 实证，issue f38f989f）。
# 不变量：任何 docker rm -f <blue> 只能在 green canary health 通过之后发生。
#
# 2026-07-10 追加：自杀竞态修法（sidecar）+ blue 存活守卫（bluegreen_guard_blue）
set -uo pipefail

# _url_encode <str>：URL 百分比编码。优先 jq，兜底 python3，均无则原样返回（ASCII 正常，不 fatal）。
_url_encode() {
  local str="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$str" | jq -sRr @uri
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()),end='')" <<<"$str"
  else
    printf '%s' "$str"
  fi
}

# send_bark <msg>：紧急部署告警走 Bark（不走飞书）。未配 token 静默跳过。
# 整个函数 non-fatal：通知失败不阻塞部署（避免容器内无 jq 等依赖缺失致 exit 127）。
send_bark() {
  # shellcheck disable=SC1091
  (
    set +e
    local msg="$1"
    [[ -f "$HOME/.credentials/bark.env" ]] && source "$HOME/.credentials/bark.env"
    if [[ -z "${BARK_TOKEN:-}" ]]; then
      echo "  [bark] 未配 BARK_TOKEN，跳过推送"
      return 0
    fi
    local title body
    title=$(_url_encode "Brain部署")
    body=$(_url_encode "$msg")
    if curl -sf --max-time 10 "https://api.day.app/${BARK_TOKEN}/${title}/${body}?group=brain-deploy" >/dev/null 2>&1; then
      echo "  [bark] 已推送: $msg"
    else
      echo "  [bark] 推送失败(不阻塞): $msg"
    fi
  ) || true
}

# bluegreen_guard_blue <name>: 验证 blue 容器仍在运行，否则尝试 docker start + Bark 告警。
# 在任何部署失败路径中调用，确保 5221 生产流量不中断。
bluegreen_guard_blue() {
  local blue="${1:-cecelia-node-brain}"
  local state
  state=$(docker inspect --format '{{.State.Status}}' "$blue" 2>/dev/null || echo "missing")
  case "$state" in
    running)
      echo "[bluegreen-guard] ✅ blue($blue) 仍在运行"
      return 0
      ;;
    exited|created|paused|restarting)
      echo "[bluegreen-guard] ⚠️ blue($blue) 状态=${state}，尝试 docker start..."
      if docker start "$blue" >/dev/null 2>&1; then
        echo "[bluegreen-guard] ✅ docker start $blue 成功，蓝绿已恢复"
        send_bark "⚠️ 蓝绿守卫：blue($blue) 在失败路径后停止(state=${state})，已 docker start 恢复。请检查部署日志。"
      else
        echo "[bluegreen-guard] ❌ docker start $blue 失败"
        send_bark "🚨 蓝绿守卫：blue($blue) 停止且无法恢复！5221 可能宕机，请立即人工介入。"
      fi
      ;;
    missing)
      echo "[bluegreen-guard] ❌ blue($blue) 容器不存在！蓝绿承诺已被打破。"
      send_bark "🚨 蓝绿承诺被打破：blue($blue) 容器不存在！5221 可能宕机，请立即人工介入。"
      ;;
    *)
      echo "[bluegreen-guard] ⚠️ blue($blue) 未知状态=${state}"
      ;;
  esac
}

# bluegreen_swap：green canary 验证后原子切。入参走 env：
#   BLUE_NAME(默认 cecelia-node-brain) / GREEN_NAME(默认 cecelia-node-brain-green)
#   TEMP_PORT(默认 5223) / TARGET_VERSION(必填，镜像 tag) / HEALTH_TIMEOUT(默认 60)
#   GREEN_RUN_ARGS(可选，起 green 的额外 docker run 参数：env/mounts 等)
#   DEPLOY_ROOT_DIR(可选，设置后启动 compose sidecar 规避自杀竞态)
# 返回：0 = green 健康、blue 已删（或 sidecar 已启动将删）、compose up 将由 sidecar 完成
#       1 = green 未通过 或 sidecar 启动失败、blue 原封不动（调用方应 exit 1 终止部署）
bluegreen_swap() {
  local blue="${BLUE_NAME:-cecelia-node-brain}"
  local green="${GREEN_NAME:-cecelia-node-brain-green}"
  local port="${TEMP_PORT:-5223}"
  local timeout="${HEALTH_TIMEOUT:-60}"
  local version="${TARGET_VERSION:?TARGET_VERSION 必填}"
  # 金丝雀探活/smoke 目标主机：deploy-webhook 在 brain 容器内 spawn 本脚本时，
  # 容器 localhost:${port} 无监听（端口映射在宿主）——必须走 host.docker.internal。
  # 宿主直跑保持 localhost。可用 env CANARY_HOST 显式覆盖。
  local canary_host="${CANARY_HOST:-}"
  if [ -z "$canary_host" ]; then
    if [ -f /.dockerenv ]; then canary_host="host.docker.internal"; else canary_host="localhost"; fi
  fi
  echo "[bluegreen] canary 探活主机: ${canary_host}（容器内=$( [ -f /.dockerenv ] && echo yes || echo no )）"

  echo "[bluegreen] 起 green canary（${green}，端口 ${port}，tick 关）..."
  docker rm -f "$green" >/dev/null 2>&1 || true
  # BRAIN_DEPLOY_CANARY=1 关 tick，避免 canary 与 blue 连同一 DB double-dispatch
  # shellcheck disable=SC2086
  if ! docker run -d --name "$green" -p "${port}:5221" \
        -e BRAIN_DEPLOY_CANARY=1 ${GREEN_RUN_ARGS:-} "cecelia-brain:${version}" >/dev/null 2>&1; then
    echo "[bluegreen] green 起容器失败，保留 blue"
    docker rm -f "$green" >/dev/null 2>&1 || true
    send_bark "green 镜像 v${version} 启动失败，已保留旧版(5221不受影响)"
    bluegreen_guard_blue "$blue"
    return 1
  fi

  # poll green health（先 curl 临时端口，兜底 docker inspect health）
  local elapsed=0 healthy=false
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -sf "http://${canary_host}:${port}/api/brain/tick/status" >/dev/null 2>&1; then
      healthy=true; break
    fi
    local hs
    hs=$(docker inspect "$green" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo missing)
    if [ "$hs" = "healthy" ]; then healthy=true; break; fi
    if [ "$hs" = "unhealthy" ]; then break; fi
    sleep 2; elapsed=$((elapsed + 2))
  done

  if [ "$healthy" != true ]; then
    echo "[bluegreen] ❌ green 健康检查未通过，保留 blue($blue) 原封不动"
    docker rm -f "$green" >/dev/null 2>&1 || true
    send_bark "green 镜像 v${version} 健康检查失败，已保留旧版(5221不受影响)"
    bluegreen_guard_blue "$blue"
    return 1
  fi

  # ── Pre-swap 核心 smoke（T2 闸）─────────────────────────────────────────────
  # green 健康后、切换前跑 smoke-core.txt，任一失败 → 保留 blue 不切。
  # SKIP_PRE_SWAP_SMOKE=1 可紧急绕过（须 Bark 告警记录）。
  local core_list="${DEPLOY_ROOT_DIR:-}/packages/quality/smoke-core.txt"
  local smoke_dir="${DEPLOY_ROOT_DIR:-}/packages/brain/scripts/smoke"
  if [[ "${SKIP_PRE_SWAP_SMOKE:-0}" == "1" ]]; then
    echo "[bluegreen] ⚠️  SKIP_PRE_SWAP_SMOKE=1，跳过 pre-swap smoke（紧急模式）"
    send_bark "⚠️ brain-deploy 紧急模式：SKIP_PRE_SWAP_SMOKE=1，pre-swap smoke 已跳过，v${version}"
  elif [[ -n "${DEPLOY_ROOT_DIR:-}" && -f "$core_list" ]]; then
    echo "[bluegreen] 跑 pre-swap 核心 smoke（green:${port}，预算 ${SMOKE_CORE_TIMEOUT_SECS:-600}s）..."
    local _smoke_failed=0 _smoke_ran=0 _smoke_start _smoke_elapsed
    _smoke_start=$(date +%s)
    while IFS= read -r _script || [[ -n "$_script" ]]; do
      [[ "$_script" =~ ^[[:space:]]*# ]] && continue
      [[ -z "${_script// }" ]] && continue
      local _sf="${smoke_dir}/${_script}"
      if [[ ! -f "$_sf" ]]; then
        echo "  [pre-swap-smoke] WARN: ${_script} 不存在，跳过"
        continue
      fi
      _smoke_ran=$((_smoke_ran + 1))
      _smoke_elapsed=$(( $(date +%s) - _smoke_start ))
      if [[ "$_smoke_elapsed" -ge "${SMOKE_CORE_TIMEOUT_SECS:-600}" ]]; then
        echo "  [pre-swap-smoke] ⏰ 超时 ${SMOKE_CORE_TIMEOUT_SECS:-600}s，中止 smoke"
        _smoke_failed=$((_smoke_failed + 1))
        break
      fi
      if BRAIN_URL="http://${canary_host}:${port}" bash "$_sf"; then
        echo "  [pre-swap-smoke] ✅ ${_script}"
      else
        echo "  [pre-swap-smoke] ❌ ${_script}"
        _smoke_failed=$((_smoke_failed + 1))
      fi
    done < "$core_list"
    _smoke_elapsed=$(( $(date +%s) - _smoke_start ))
    echo "  [pre-swap-smoke] 共跑 ${_smoke_ran} 条，失败 ${_smoke_failed} 条，用时 ${_smoke_elapsed}s"
    if [[ "$_smoke_failed" -gt 0 ]]; then
      echo "[bluegreen] ❌ pre-swap smoke 未通过（${_smoke_failed} 条失败），保留 blue($blue) 不切"
      docker rm -f "$green" >/dev/null 2>&1 || true
      send_bark "pre-swap smoke 失败 v${version}（${_smoke_failed}/${_smoke_ran} 条），已保留 blue(5221不受影响)"
      bluegreen_guard_blue "$blue"
      return 1
    fi
    echo "[bluegreen] ✅ pre-swap smoke 全部通过（${_smoke_ran} 条，${_smoke_elapsed}s），继续切换"
  else
    echo "[bluegreen] ℹ️  smoke-core.txt 不存在或 DEPLOY_ROOT_DIR 未设，跳过 pre-swap smoke"
  fi
  # ─────────────────────────────────────────────────────────────────────────

  echo "[bluegreen] ✅ green 健康，切换：清 canary → 启 compose sidecar → 删 blue"
  docker rm -f "$green" >/dev/null 2>&1 || true   # canary 仅验证用，切换前清掉

  # ── 自杀竞态防护（2026-07-10 生产宕机根因）────────────────────────────────
  # 问题：brain-deploy.sh 在 cecelia-node-brain 容器内运行，直接调
  # "docker rm -f blue" 会即刻 SIGKILL 本进程，后续 compose up 永远无法执行 →
  # 5221 空窗宕机（本次 incident 根因）。
  # 解法：在删 blue 之前，先在宿主侧启动独立 sidecar 容器（不受 brain 容器
  # 生命周期影响）。sidecar 等 blue 消失后执行 docker compose up -d，新 Brain
  # 接管 5221。若 sidecar 启动失败则终止切换，blue 保留（fail-safe）。
  # ─────────────────────────────────────────────────────────────────────────
  local root_dir="${DEPLOY_ROOT_DIR:-}"
  local env_region="${ENV_REGION:-us}"
  local sidecar_name="cecelia-bluegreen-sidecar"

  if [[ -n "$root_dir" ]]; then
    docker rm -f "$sidecar_name" >/dev/null 2>&1 || true  # 清理上次残留

    # ── 打 blue-fallback 快照（sidecar compose up 失败时回退用）──────────────
    # 在任何 rm -f 之前完成；tag 存在即可，不阻塞部署
    local blue_img
    blue_img=$(docker inspect "$blue" --format '{{.Image}}' 2>/dev/null || true)
    if [[ -n "$blue_img" ]]; then
      docker tag "$blue_img" "cecelia-brain:blue-fallback" 2>/dev/null || true
      echo "[bluegreen] blue-fallback 已 tag: ${blue_img:0:20}..."
    fi

    # ── 读取 BARK_TOKEN（供 sidecar 告警用）──────────────────────────────────
    local bark_token=""
    # shellcheck disable=SC1091
    [[ -f "$HOME/.credentials/bark.env" ]] && \
      bark_token=$(bash -c 'source "$1"; echo "${BARK_TOKEN:-}"' _ "$HOME/.credentials/bark.env" 2>/dev/null) || true

    echo "[bluegreen] 启动 compose sidecar（${sidecar_name}）以规避自杀竞态..."
    # 使用 cecelia-brain 镜像（已含 docker-cli + docker-cli-compose），
    # 挂载 docker.sock 和部署根目录，等 blue 消失后执行 compose up。
    # sidecar 脚本（bluegreen-sidecar.sh）通过 root_dir 挂载可访问，
    # 失败时自动用 blue-fallback tag 恢复（见 bluegreen-sidecar.sh）。
    if docker run -d --rm \
        --name "$sidecar_name" \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v "${root_dir}:${root_dir}:rw" \
        -w "${root_dir}" \
        -e "BRAIN_VERSION=${version}" \
        -e "ENV_REGION=${env_region}" \
        -e "DEPLOY_ROOT=${root_dir}" \
        -e "BARK_TOKEN=${bark_token}" \
        "cecelia-brain:${version}" \
        bash "${root_dir}/scripts/lib/bluegreen-sidecar.sh" >/dev/null 2>&1; then
      echo "[bluegreen] ✅ sidecar 已启动，将在 blue 删除后完成 compose up（失败自动回退 blue-fallback）"
    else
      echo "[bluegreen] ❌ sidecar 启动失败，终止切换（blue 保留，5221 不受影响）"
      send_bark "⚠️ 蓝绿 sidecar 启动失败 v${version}，已保留 blue（5221 仍用旧版），请检查 docker 状态"
      return 1  # fail-safe：不删 blue
    fi
  else
    echo "[bluegreen] ℹ️ DEPLOY_ROOT_DIR 未设置，跳过 sidecar（launchd 模式下正常，compose up 由调用方负责）"
  fi

  docker rm -f "$blue" >/dev/null 2>&1 || true    # ← 仅在 green 通过且 sidecar 已启动后才删 blue
  # Docker 模式下本行及以下不会执行（docker rm -f 自杀），launchd 模式下正常执行。
  return 0
}
