#!/usr/bin/env bash
# Regression: docker-compose.dev.yml 曾缺 name: 字段，落到根 .env 的
# COMPOSE_PROJECT_NAME=cecelia（docker compose 优先级：env var > 文件 name: 字段），
# 与 prod 的 docker-compose.yml(name: cecelia) 撞成同一个 project。
# dev.yml 里还遗留了重复定义的 node-brain/frontend 死代码块
#（container_name 直接等于 prod 的 cecelia-node-brain/cecelia-frontend，
# Linux 专属挂载路径 /home/xx/... 在本机根本不存在，明显是遗留死代码）。
# 后果：任何 `docker compose -f docker-compose.dev.yml up -d --remove-orphans`
# 会把 prod 的 node-brain/frontend 当作本项目的"孤儿容器"，用 dev 里过时的坏定义
# 重建，直接打断生产。2026-07-14 手动重新拉起 Cecelia staging/dev 前端时复现两次
# （各约 60-90s，已手动恢复并验证 200）。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../.."

PASS=0
FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

get_name() {
  grep -E '^name:' "$1" 2>/dev/null | head -1 | sed -E 's/^name:[[:space:]]*//'
}

echo "── 三档 compose 文件必须各自声明独立的 name: 字段 ──"
PROD_NAME=$(get_name "$REPO_ROOT/docker-compose.yml")
DEV_NAME=$(get_name "$REPO_ROOT/docker-compose.dev.yml")
STAGING_NAME=$(get_name "$REPO_ROOT/docker-compose.staging.yml")

[[ -n "$PROD_NAME" ]]    && ok "docker-compose.yml 声明 name: $PROD_NAME"    || bad "docker-compose.yml 缺 name: 字段"
[[ -n "$DEV_NAME" ]]     && ok "docker-compose.dev.yml 声明 name: $DEV_NAME"     || bad "docker-compose.dev.yml 缺 name: 字段"
[[ -n "$STAGING_NAME" ]] && ok "docker-compose.staging.yml 声明 name: $STAGING_NAME" || bad "docker-compose.staging.yml 缺 name: 字段"

echo "── 三个 name 必须两两不同（否则 --remove-orphans 会跨档互删容器）──"
if [[ -n "$PROD_NAME" && -n "$DEV_NAME" && -n "$STAGING_NAME" ]]; then
  UNIQ_COUNT=$(printf '%s\n%s\n%s\n' "$PROD_NAME" "$DEV_NAME" "$STAGING_NAME" | sort -u | wc -l | tr -d ' ')
  [[ "$UNIQ_COUNT" -eq 3 ]] && ok "prod/dev/staging 三个 project name 互不相同" \
    || bad "prod/dev/staging 存在重复 project name（撞名会导致 up --remove-orphans 互删容器）"
else
  bad "上一步已有文件缺 name:，跳过唯一性检查"
fi

echo "── dev.yml 不应重复定义 prod 的 container_name（cecelia-node-brain / cecelia-frontend）──"
DEV_COMPOSE="$REPO_ROOT/docker-compose.dev.yml"
if grep -qE 'container_name:[[:space:]]*cecelia-node-brain[[:space:]]*$' "$DEV_COMPOSE"; then
  bad "docker-compose.dev.yml 里存在 container_name: cecelia-node-brain（与 prod 撞名）"
else
  ok "docker-compose.dev.yml 未重复定义 cecelia-node-brain"
fi
if grep -qE 'container_name:[[:space:]]*cecelia-frontend[[:space:]]*$' "$DEV_COMPOSE"; then
  bad "docker-compose.dev.yml 里存在 container_name: cecelia-frontend（与 prod 撞名）"
else
  ok "docker-compose.dev.yml 未重复定义 cecelia-frontend"
fi

echo "── prod Fleet Worker 默认地址必须可从 OrbStack 容器解析 ──"
PROD_COMPOSE="$REPO_ROOT/docker-compose.yml"
if grep -Fq 'FLEET_WORKER_XIAN_MAC_M4_URL=${FLEET_WORKER_XIAN_MAC_M4_URL:-http://100.86.57.69:5231}' "$PROD_COMPOSE"; then
  ok "Xian M4 默认使用 NodeProfile 固定 Tailscale IP"
else
  bad "Xian M4 默认地址未使用 100.86.57.69:5231"
fi
if grep -Fq 'FLEET_WORKER_XIAN_MAC_M1_URL=${FLEET_WORKER_XIAN_MAC_M1_URL:-http://100.88.166.55:5231}' "$PROD_COMPOSE"; then
  ok "Xian M1 默认使用 NodeProfile 固定 Tailscale IP"
else
  bad "Xian M1 默认地址未使用 100.88.166.55:5231"
fi
if grep -qE 'http://xian-mac-m(4|1):5231' "$PROD_COMPOSE"; then
  bad "prod compose 仍含 OrbStack 容器无法解析的 Xian 主机名"
else
  ok "prod compose 不含不可解析的 Xian 主机名"
fi

echo ""
echo "PASS:$PASS FAIL:$FAIL"
[[ "$FAIL" -eq 0 ]]
