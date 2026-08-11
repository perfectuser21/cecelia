#!/usr/bin/env bash
# 回归测试：bluegreen TEMP_PORT 默认值不能与 dashboard-slot-server SLOT_PORT 默认值撞车。
#
# 背景：dashboard-slot-server.cjs 是常驻 staging 预览服务(默认绑 0.0.0.0:5251)。
# Brain 蓝绿部署 green canary 探测走 host.docker.internal:${TEMP_PORT}，该路径在 OrbStack
# 下会绕过容器间端口转发、直接命中宿主机原生监听进程 —— 如果 TEMP_PORT 与它相同，
# green canary 的 pre-swap smoke 会误判为失败（打到 slot-server 的前端 HTML 而非
# green Brain 的 JSON）。此测试锁死两个默认端口不能相等。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BLUEGREEN_SH="$REPO_ROOT/scripts/lib/bluegreen.sh"
BRAIN_DEPLOY_SH="$REPO_ROOT/scripts/brain-deploy.sh"
SLOT_SERVER_JS="$REPO_ROOT/scripts/dashboard-slot-server.cjs"

FAIL=0

# 提取 bluegreen.sh 里 TEMP_PORT 的默认值。
bluegreen_port=$(grep -oE 'TEMP_PORT:-[0-9]+' "$BLUEGREEN_SH" | head -1 | grep -oE '[0-9]+$')
if [ -z "$bluegreen_port" ]; then
  echo "FAIL: 未能从 $BLUEGREEN_SH 提取 TEMP_PORT 默认值"
  FAIL=1
fi

# 提取 brain-deploy.sh 里硬编码的 TEMP_PORT= 值
deploy_port=$(grep -oE 'TEMP_PORT=[0-9]+' "$BRAIN_DEPLOY_SH" | head -1 | grep -oE '[0-9]+$')
if [ -z "$deploy_port" ]; then
  echo "FAIL: 未能从 $BRAIN_DEPLOY_SH 提取 TEMP_PORT 硬编码值"
  FAIL=1
fi

# 提取 dashboard-slot-server.cjs 里 SLOT_PORT 的默认值
slot_port=$(grep -oE "SLOT_PORT \|\| '[0-9]+'" "$SLOT_SERVER_JS" | head -1 | grep -oE '[0-9]+')
if [ -z "$slot_port" ]; then
  echo "FAIL: 未能从 $SLOT_SERVER_JS 提取 SLOT_PORT 默认值"
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  exit 1
fi

echo "bluegreen.sh TEMP_PORT 默认值: $bluegreen_port"
echo "brain-deploy.sh TEMP_PORT 硬编码值: $deploy_port"
echo "dashboard-slot-server.cjs SLOT_PORT 默认值: $slot_port"

if [ "$bluegreen_port" = "$slot_port" ]; then
  echo "FAIL: bluegreen.sh TEMP_PORT 默认值($bluegreen_port) 与 SLOT_PORT 默认值($slot_port) 撞车"
  FAIL=1
fi

if [ "$deploy_port" = "$slot_port" ]; then
  echo "FAIL: brain-deploy.sh TEMP_PORT 硬编码值($deploy_port) 与 SLOT_PORT 默认值($slot_port) 撞车"
  FAIL=1
fi

if [ "$bluegreen_port" != "$deploy_port" ]; then
  echo "FAIL: bluegreen.sh 默认值($bluegreen_port) 与 brain-deploy.sh 硬编码值($deploy_port) 不一致"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "PASS: TEMP_PORT($bluegreen_port) 与 SLOT_PORT($slot_port) 不撞车，且 bluegreen.sh/brain-deploy.sh 两处 TEMP_PORT 一致"
fi

exit $FAIL
