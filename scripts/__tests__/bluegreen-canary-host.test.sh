#!/bin/bash
# Regression: bluegreen 金丝雀探活/smoke 的目标地址必须是宿主视角可配置的 CANARY_HOST，
# 不能写死 localhost——deploy-webhook 在 brain 容器内 spawn deploy-local.sh 时，
# 容器内 localhost:5223 无监听，三轮生产部署全部假红"保留 blue 终止"（2026-07-14 实证，
# 宿主同秒 curl 5223 可达）。容器内默认 host.docker.internal，宿主默认 localhost。
set -e
BG="$(dirname "$0")/../lib/bluegreen.sh"
FAIL=0

# 1. 必须定义 CANARY_HOST，且带 /.dockerenv 容器检测 + host.docker.internal 默认值
if ! grep -q "CANARY_HOST" "$BG"; then
  echo "❌ bluegreen.sh 未定义 CANARY_HOST"; FAIL=1
fi
if ! grep -q "host.docker.internal" "$BG"; then
  echo "❌ bluegreen.sh 无 host.docker.internal 容器内默认值"; FAIL=1
fi
if ! grep -q "dockerenv" "$BG"; then
  echo "❌ bluegreen.sh 无 /.dockerenv 容器环境检测"; FAIL=1
fi

# 2. 健康探活与 smoke BRAIN_URL 不得再出现写死的 http://localhost:${port}
if grep -n 'http://localhost:\${port}' "$BG"; then
  echo "❌ bluegreen.sh 仍有写死 localhost 的金丝雀地址（上列行）"; FAIL=1
fi

# 3. 语法有效
bash -n "$BG" || { echo "❌ bluegreen.sh 语法错误"; FAIL=1; }

if [ "$FAIL" -ne 0 ]; then exit 1; fi
echo "✅ bluegreen-canary-host regression 全过"
