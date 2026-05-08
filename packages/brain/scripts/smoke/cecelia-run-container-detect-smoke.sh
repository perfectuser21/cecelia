#!/usr/bin/env bash
# 真 brain 容器内 docker exec 跑 cecelia-run.sh：不应报 sudo not found
set -uo pipefail

CONTAINER="cecelia-node-brain"

if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "SKIP: $CONTAINER 容器不在跑（CI 环境无 brain 容器）"
  exit 0
fi

CECELIA_RUN_PATH="/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh"

# 在容器内跑 cecelia-run.sh（缺 PROMPT_FILE 会早 exit）；只看 stderr 是否含 "sudo: not found"
OUTPUT=$(docker exec "$CONTAINER" bash -c "$CECELIA_RUN_PATH 2>&1 || true" | head -20)

if echo "$OUTPUT" | grep -q "sudo: not found"; then
  echo "❌ FAIL: cecelia-run.sh 仍报 sudo not found"
  echo "$OUTPUT"
  exit 1
fi

if echo "$OUTPUT" | grep -q "切换到 administrator 重新执行"; then
  echo "❌ FAIL: cecelia-run.sh 在容器内仍尝试 sudo 切换（应跳过）"
  echo "$OUTPUT"
  exit 1
fi

echo "✅ cecelia-run-container-detect smoke PASS — 容器内不调 sudo"
exit 0
