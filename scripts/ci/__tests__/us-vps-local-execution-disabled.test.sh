#!/usr/bin/env bash
# 回归测试：us-vps 必须保持「纯调度器」配置形态（铁律 96054a8b）
#
# 守护三件事（2026-09-13 立，us-vps 纯调度器化第一刀）：
#
# ① FLEET_WORKER_US_MAC_M4_URL 默认值不得退回 host.docker.internal
#    该占位符在 host 网络模式的 Linux 容器里不解析。按铁律 ca6bf8e7，Claude 类任务
#    只能路由到 MMV，目标地址不通 = 那类任务的远程派发全废。实测 us-vps 的
#    .env.docker 从未定义过这个变量，所以原注释里「必须在 .env.docker 显式覆盖」
#    从来没被兑现，compose 默认值一直是生效值 —— 因此默认值本身必须是对的。
#
# ② CECELIA_LOCAL_EXECUTION_ENABLED 必须在位且默认 false
#    这是拒绝本机执行的闸（拦在 harness-skill-relay.js 的 spawnSkillRelaySession
#    咽喉上）。丢了它，us-vps 会退回「调度器兼执行体」，重演 2 核机被 442 条
#    skill-relay 打满 CPU 导致任务卡死。
#
# ③ CECELIA_MACHINE_ID 必须仍是 us-mac-m4 —— 这条是防回归到已证伪方案
#    纠正决策 26c1e763 supersede 962281b2：曾提议把它改成 us-vps-scheduler 以表达
#    「我是调度器」，经三条亲验否决 ——
#      · production-transport.js:137 那道 localMachineId 守卫是死代码（四个生产调用方
#        全不传该入参，if 恒为假），改身份触发不到它；
#      · harness-skill-relay.js 对 machineId 引用数为 0，本机 spawn 只看
#        payload.harness_runtime，改身份拦不住、不减一丝 CPU；
#      · credential-broker.js:144 与 github-credential-broker.js:36 硬编码要求
#        controllerMachineId === 'us-mac-m4' —— 这台 Brain 必须自称 us-mac-m4 因为它是
#        凭据权威，改了会让远程派发到 MMV 也签不出凭据，全面 fail-closed。
#    该变量语义 = fleet 可调度节点身份 + 凭据签发权，不是宿主物理机标识。
#
# ⚠️ 关于 100.71.151.105：这个 IP 在本仓库有双重含义，勿一概而论 ——
#    作为「Brain HTTP API 地址」它是过期的（Brain 已迁 us-vps，由
#    brain-deploy-url-points-to-us-vps.test.sh 守着不许再出现在 workflow 里）；
#    作为「MMV 物理机地址」它是现役的（fleet-worker 跑在那台机上）。本测试用的是后者，
#    与那条守卫不冲突（它只扫 .github/workflows/*.yml）。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE="$REPO_ROOT/docker-compose.us-vps.yml"
RELAY="$REPO_ROOT/packages/brain/src/harness-skill-relay.js"
FAIL=0

echo "== us-vps 纯调度器配置形态 =="

if [ ! -f "$COMPOSE" ]; then
  echo "  ❌ 找不到 $COMPOSE"
  exit 1
fi

# ① worker 地址不得是占位符
if grep -qE '^\s*-\s*FLEET_WORKER_US_MAC_M4_URL=.*host\.docker\.internal' "$COMPOSE"; then
  echo "  ❌ FLEET_WORKER_US_MAC_M4_URL 默认值退回了 host.docker.internal（Linux 容器内不解析）"
  FAIL=1
elif grep -qE '^\s*-\s*FLEET_WORKER_US_MAC_M4_URL=' "$COMPOSE"; then
  echo "  ✅ FLEET_WORKER_US_MAC_M4_URL 默认值非 host.docker.internal 占位符"
else
  echo "  ❌ 找不到 FLEET_WORKER_US_MAC_M4_URL 定义"
  FAIL=1
fi

# ② 本机执行闸在位且默认 false
if grep -qE '^\s*-\s*CECELIA_LOCAL_EXECUTION_ENABLED=\$\{CECELIA_LOCAL_EXECUTION_ENABLED:-false\}' "$COMPOSE"; then
  echo "  ✅ CECELIA_LOCAL_EXECUTION_ENABLED 在位且默认 false"
else
  echo "  ❌ CECELIA_LOCAL_EXECUTION_ENABLED 缺失或默认值不是 false（us-vps 会退回调度器兼执行体）"
  FAIL=1
fi

# ③ 机器身份必须保持 us-mac-m4（防回归到已证伪方案）
if grep -qE '^\s*-\s*CECELIA_MACHINE_ID=\$\{CECELIA_MACHINE_ID:-us-mac-m4\}' "$COMPOSE"; then
  echo "  ✅ CECELIA_MACHINE_ID 仍为 us-mac-m4（凭据权威身份未被动）"
else
  echo "  ❌ CECELIA_MACHINE_ID 被改动 —— 这会掐断凭据签发（credential-broker.js:144"
  echo "       硬编码要求它等于 us-mac-m4）。见纠正决策 26c1e763，改用"
  echo "       CECELIA_LOCAL_EXECUTION_ENABLED 表达调度器角色。"
  FAIL=1
fi

# ④ 闸必须读可注入 env（否则不可测，会重演「守卫是死代码」）
if [ -f "$RELAY" ]; then
  if grep -qF '(deps.env ?? process.env).CECELIA_LOCAL_EXECUTION_ENABLED' "$RELAY"; then
    echo "  ✅ 闸读 (deps.env ?? process.env)，可注入可测"
  else
    echo "  ❌ 闸未走 (deps.env ?? process.env) 形式 —— 直接读 process.env 会让它在测试里"
    echo "       不可控，正是 production-transport.js:137 那个死代码守卫的形状"
    FAIL=1
  fi
else
  echo "  ❌ 找不到 $RELAY"
  FAIL=1
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
else
  echo "❌ 存在失败项"
  exit 1
fi
