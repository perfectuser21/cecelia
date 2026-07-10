#!/usr/bin/env bash
# scripts/lib/bluegreen.sh
# 蓝绿切换：green canary 验证健康后才切；失败保留 blue 原封不动。
# 可被 brain-deploy.sh source，也可被单测 source 调用（docker 命令走 PATH，可 mock）。
#
# 根因：brain-deploy.sh 原先"先删后建"——docker rm -f blue → compose up 建新，
# 坏镜像/中断时旧容器已删致 5221 outage（2026-07-05 实证，issue f38f989f）。
# 不变量：任何 docker rm -f <blue> 只能在 green canary health 通过之后发生。
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

# bluegreen_swap：green canary 验证后原子切。入参走 env：
#   BLUE_NAME(默认 cecelia-node-brain) / GREEN_NAME(默认 cecelia-node-brain-green)
#   TEMP_PORT(默认 5223) / TARGET_VERSION(必填，镜像 tag) / HEALTH_TIMEOUT(默认 60)
#   GREEN_RUN_ARGS(可选，起 green 的额外 docker run 参数：env/mounts 等)
# 返回：0 = green 健康、blue 已删、可由调用方 compose up 起新生产容器
#       1 = green 未通过、blue 原封不动（调用方应 exit 1 终止部署）
bluegreen_swap() {
  local blue="${BLUE_NAME:-cecelia-node-brain}"
  local green="${GREEN_NAME:-cecelia-node-brain-green}"
  local port="${TEMP_PORT:-5223}"
  local timeout="${HEALTH_TIMEOUT:-60}"
  local version="${TARGET_VERSION:?TARGET_VERSION 必填}"

  echo "[bluegreen] 起 green canary（${green}，端口 ${port}，tick 关）..."
  docker rm -f "$green" >/dev/null 2>&1 || true
  # BRAIN_DEPLOY_CANARY=1 关 tick，避免 canary 与 blue 连同一 DB double-dispatch
  # shellcheck disable=SC2086
  if ! docker run -d --name "$green" -p "${port}:5221" \
        -e BRAIN_DEPLOY_CANARY=1 ${GREEN_RUN_ARGS:-} "cecelia-brain:${version}" >/dev/null 2>&1; then
    echo "[bluegreen] green 起容器失败，保留 blue"
    docker rm -f "$green" >/dev/null 2>&1 || true
    send_bark "green 镜像 v${version} 启动失败，已保留旧版(5221不受影响)"
    return 1
  fi

  # poll green health（先 curl 临时端口，兜底 docker inspect health）
  local elapsed=0 healthy=false
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -sf "http://localhost:${port}/api/brain/tick/status" >/dev/null 2>&1; then
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
    return 1
  fi

  echo "[bluegreen] ✅ green 健康，切换：清 canary → 删 blue"
  docker rm -f "$green" >/dev/null 2>&1 || true   # canary 仅验证用，切换前清掉
  docker rm -f "$blue" >/dev/null 2>&1 || true    # ← 仅在 green 通过后才删 blue
  return 0
}
