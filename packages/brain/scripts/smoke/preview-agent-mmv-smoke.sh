#!/usr/bin/env bash
# Smoke: 预览环境执行下放 MMV
#
# 2026-09-16/17 案卷：Deploy Preview 自 09-09 搬到 us-vps 后一次没成功过
# （preview_environments 842 次历史 → 归零），而且每个 PR 都挂红叉，久而久之被
# 当成"已知故障"绕过——真问题就是这样被噪音掩埋的。
#
# 病根不在某一行代码，在架构：起预览 = 起 Brain 实例 + 克隆数据库 = 执行活，
# 而 us-vps 有零执行铁律（决策 96054a8b）。整套功能（启动脚本硬编码 Mac 路径、
# 磁盘门槛 38.5G 按 Mac 盘设计）本就是 Mac 专用，us-vps 根分区 24G 数学上不可能过。
#
# 本守卫盯住的是"别再搬回去"，以及每个实际踩过的坑。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

AGENT="scripts/preview-agent.mjs"
WF="/dev/null"
[ -f .github/workflows/preview-deploy.yml ] && WF=.github/workflows/preview-deploy.yml

echo "[preview-agent-mmv-smoke] 1. 代理复用 routes/preview.js，不另造一套"
if ! grep -q "routes/preview.js" "$AGENT"; then
  echo "FAIL: 代理未复用 routes/preview.js —— 两份预览实现必然漂移，出事时没人知道信哪份"
  exit 1
fi
echo "OK: 复用既有路由"

echo "[preview-agent-mmv-smoke] 2. 挂载路径与 Brain 一致（CI 才能只改地址）"
if ! grep -q "'/api/brain/preview'" "$AGENT"; then
  echo "FAIL: 挂载路径与 Brain 不一致，request-preview-start.sh 会 404"
  exit 1
fi
echo "OK: 路径一致"

echo "[preview-agent-mmv-smoke] 3. 无鉴权不得启动"
if ! grep -q "DEPLOY_TOKEN" "$AGENT" || ! grep -q "process.exit(1)" "$AGENT"; then
  echo "FAIL: 缺 DEPLOY_TOKEN 时没有拒绝启动 —— 预览接口能起进程、克隆库，裸奔风险太大"
  exit 1
fi
echo "OK: 缺鉴权即拒启"

echo "[preview-agent-mmv-smoke] 4. 不得绑 0.0.0.0 暴露公网"
if grep -qE "listen\([^)]*['\"]0\.0\.0\.0['\"]" "$AGENT"; then
  echo "FAIL: 绑了 0.0.0.0 —— 预览执行入口只应走内网"
  exit 1
fi
echo "OK: 只监听内网"

echo "[preview-agent-mmv-smoke] 5. CI 必须指向执行机，且避开 socat 端口"
if [ "$WF" != "/dev/null" ]; then
  if grep -q "100.79.41.61:5221" "$WF"; then
    echo "FAIL: CI 又指回 us-vps —— 起预览是执行活，违反零执行铁律 96054a8b"
    exit 1
  fi
  if grep -q "100.71.151.105:5221" "$WF"; then
    echo "FAIL: CI 指向 MMV:5221，那是 socat 端口，会把流量整个转发到 us-vps"
    exit 1
  fi
  if ! grep -q "100.71.151.105:5241" "$WF"; then
    echo "FAIL: CI 未指向 MMV 代理端口 5241"
    exit 1
  fi
  echo "OK: CI 指向执行机代理端口"
fi

echo "[preview-agent-mmv-smoke] 6. 未引入新 secret（沿用既有 DEPLOY_TOKEN）"
if [ "$WF" != "/dev/null" ] && grep -q "PREVIEW_SSH_KEY" "$WF"; then
  echo "FAIL: 引入了新 secret —— 本方案的前提就是不新增 secret"
  exit 1
fi
echo "OK: 无新增 secret"

echo "[preview-agent-mmv-smoke] 7. 克隆源可配置且源库缺失时明确报错"
if ! grep -q "PREVIEW_SOURCE_DB" scripts/preview-env-start.sh; then
  echo "FAIL: 克隆源写死 —— 执行机上没有生产库 cecelia，会以 pg_dump 失败的形式表现出来"
  exit 1
fi
if ! grep -q "克隆源库 \${PREVIEW_SOURCE_DB} 不存在" scripts/preview-env-start.sh; then
  echo "FAIL: 源库不存在时没有明确报错，会退化成难查的静默失败"
  exit 1
fi
echo "OK: 克隆源可配置且有明确报错"

echo "[preview-agent-mmv-smoke] 8. 代理语法可执行"
node --check "$AGENT" 2>/dev/null || { echo "FAIL: $AGENT 语法错误"; exit 1; }
bash -n scripts/preview-env-start.sh || { echo "FAIL: preview-env-start.sh 语法错误"; exit 1; }
bash -n scripts/preview-agent-install.sh || { echo "FAIL: preview-agent-install.sh 语法错误"; exit 1; }
echo "OK: 语法检查通过"

echo "[preview-agent-mmv-smoke] 9. 单元测试跑通"
cd packages/brain && npx vitest run src/__tests__/preview-agent.test.js --reporter=basic 2>&1 | tail -5

echo "[preview-agent-mmv-smoke] ALL PASS"
