#!/usr/bin/env bash
# 验证：entrypoint.sh 优先用 HARNESS_CALLBACK_URL env（spawnNode 传），
# 不再 fallback 到 HOSTNAME（docker 自动生成 hex ID ≠ --name → 404 lookup）
set -uo pipefail

ENTRYPOINT="docker/cecelia-runner/entrypoint.sh"
[ -f "$ENTRYPOINT" ] || { echo "FAIL: $ENTRYPOINT 不存在"; exit 1; }

# 验证 entrypoint.sh 含 HARNESS_CALLBACK_URL 优先逻辑
if ! grep -q 'HARNESS_CALLBACK_URL:-' "$ENTRYPOINT"; then
  echo "FAIL: entrypoint.sh 没含 HARNESS_CALLBACK_URL 优先 fallback"
  exit 1
fi

# 验证不再硬编码 HOSTNAME-only callback URL
HOSTNAME_LINES=$(grep -c 'CONTAINER_ID="${HOSTNAME:-' "$ENTRYPOINT" || true)
if [ "$HOSTNAME_LINES" -ne 1 ]; then
  echo "FAIL: entrypoint.sh HOSTNAME-only fallback 出现次数 $HOSTNAME_LINES（期望 1）"
  exit 1
fi

echo "✅ callback-url smoke PASS — entrypoint.sh 优先 HARNESS_CALLBACK_URL"
exit 0
