#!/usr/bin/env bash
# brain-compose-envfile-authority-smoke.sh — Brain 容器 fleet bridge token 被 compose 空值覆盖回归守卫
#
# 守的病（2026-08-16 09:38Z 生产实证）：
#   docker-compose.yml node-brain 的 environment: 段写了
#     - KERNEL_FLEET_BRIDGE_TOKEN=${KERNEL_FLEET_BRIDGE_TOKEN:-}
#   compose 里 environment 优先级高于 env_file——`${VAR:-}` 从调用方 shell/--env-file 插值，
#   任何不带 `--env-file .env.docker` 的 `compose up`（brain-docker-up.sh / brain-rollback.sh）
#   都会把 .env.docker 里的 token 盖成空串 → production-transport fail-closed
#   → evaluator callback 503 无限重试 → run 48d57838 controller lease 过期判死、dbe7ca64 launch 即死。
#
# 三段断言（纯静态，CI 无 docker 也能跑）：
#   A docker-compose.yml node-brain 的 environment 段不得再出现 KERNEL_FLEET_BRIDGE_TOKEN 覆盖行
#     （env_file=.env.docker 是唯一权威）
#   B scripts/ 下所有 `compose ... up ... node-brain` 调用都必须带 --env-file
#   C Brain /health 暴露 fleet_transport 就绪态（源码级：goals.js 含 fleet_transport）
#
# 用法： bash scripts/smoke/brain-compose-envfile-authority-smoke.sh
# 退出码： 0=全绿  1=有红

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
red()   { echo "  ❌ $*"; FAIL=1; }
green() { echo "  ✅ $*"; }

echo "[A] docker-compose.yml：environment 段不得覆盖 KERNEL_FLEET_BRIDGE_TOKEN"
if grep -nE '^\s*-\s*KERNEL_FLEET_BRIDGE_TOKEN=' "$ROOT_DIR/docker-compose.yml" >/dev/null; then
  red "docker-compose.yml 仍在 environment 段写 KERNEL_FLEET_BRIDGE_TOKEN=…（会盖掉 env_file 值）"
  grep -nE '^\s*-\s*KERNEL_FLEET_BRIDGE_TOKEN=' "$ROOT_DIR/docker-compose.yml"
else
  green "environment 段无 KERNEL_FLEET_BRIDGE_TOKEN 覆盖行"
fi
if grep -nE '^\s*-\s*\./?\.env\.docker\s*$' "$ROOT_DIR/docker-compose.yml" >/dev/null \
   || grep -nE '^\s*-\s*\.env\.docker' "$ROOT_DIR/docker-compose.yml" >/dev/null; then
  green "node-brain env_file 仍指向 .env.docker"
else
  red "docker-compose.yml 找不到 env_file .env.docker（token 将无来源）"
fi

echo "[B] scripts/*.sh：所有 compose up node-brain 都必须带 --env-file"
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"; text="${rest#*:}"
  # 允许多行反斜杠续行：把该行与前一行拼起来判断
  prev="$(sed -n "$((line-1))p" "$file")"
  if [[ "$text $prev" == *"--env-file"* ]]; then
    green "$(basename "$file"):$line 带 --env-file"
  else
    red "$(basename "$file"):$line compose up node-brain 未带 --env-file .env.docker → token 会被清空"
  fi
done < <(grep -nE '(docker compose|docker-compose)[^#]*\bup\b[^#]*node-brain' "$ROOT_DIR"/scripts/*.sh 2>/dev/null \
          | grep -v '^\s*#' | grep -vE ':\s*(echo|#)')

echo "[C] /health 暴露 fleet_transport 就绪态"
if grep -q 'fleet_transport' "$ROOT_DIR/packages/brain/src/routes/goals.js"; then
  green "goals.js /health 含 fleet_transport"
else
  red "goals.js /health 未暴露 fleet_transport（token 缺失将继续静默到第一次 attempt 才炸）"
fi

if [[ $FAIL -eq 0 ]]; then echo "PASS: brain-compose-envfile-authority-smoke"; exit 0; fi
echo "FAIL: brain-compose-envfile-authority-smoke"; exit 1
