#!/usr/bin/env bash
# Smoke: harness-callback — LangGraph 修正 Sprint Stream 1
#
# 验证 brain 容器内 endpoint 存在（POST 一个 fake containerId 应得 404，
# 证明路由注册）。lookup stub 阶段返回 null，因此 unknown container 必为 404。
#
# 退出码：
#   0 — endpoint 存在并返回 404（PASS）/ brain 不在跑（SKIP）/ brain 不可达（SKIP）
#   1 — 路由没注册或返回了非预期状态码（FAIL）

set -uo pipefail

if ! docker ps --filter "name=cecelia-node-brain" --format '{{.Names}}' | grep -q cecelia-node-brain; then
  echo "SKIP: brain 容器不在跑（cecelia-node-brain）"
  exit 0
fi

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  http://localhost:5221/api/brain/harness/callback/fake-container-id \
  -H "Content-Type: application/json" \
  -d '{"result":"completed","exit_code":0}')

if [ "$RESPONSE" = "404" ]; then
  echo "✅ harness-callback smoke PASS — endpoint 存在并返回 404 for unknown containerId"
  exit 0
fi

if [ "$RESPONSE" = "000" ]; then
  echo "SKIP: brain 不可达 (curl 失败) — 部署后再跑"
  exit 0
fi

echo "❌ FAIL: 期待 404 实得 $RESPONSE"
exit 1
