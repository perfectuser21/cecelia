#!/usr/bin/env bash
# smoke: harness-xian-relay-smoke.sh
# 静态验证 _spawnXianBridgeSession + skill-relay-xian 字面量存在（ART-6）
# BEHAVIOR-7: 确认无 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 字面量
# TASK_ID: 7750cd32-d73b-4a53-91cf-8fd171bf358b

set -euo pipefail

RELAY_FILE="packages/brain/src/harness-skill-relay.js"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== harness-xian-relay-smoke 静态验证 ==="

# 1. 确认 _spawnXianBridgeSession 存在
echo "[1] 检查 _spawnXianBridgeSession 字面量..."
if grep -q '_spawnXianBridgeSession' "$REPO_ROOT/$RELAY_FILE"; then
  echo "    OK: _spawnXianBridgeSession 存在"
else
  echo "    FAIL: _spawnXianBridgeSession 不存在于 $RELAY_FILE"
  exit 1
fi

# 2. 确认 skill-relay-xian 存在
echo "[2] 检查 skill-relay-xian 字面量..."
if grep -q 'skill-relay-xian' "$REPO_ROOT/$RELAY_FILE"; then
  echo "    OK: skill-relay-xian 存在"
else
  echo "    FAIL: skill-relay-xian 不存在于 $RELAY_FILE"
  exit 1
fi

# 3. 确认无 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 字面量（INV-4）
echo "[3] 检查无禁用字面量（INV-4）..."
FORBIDDEN=$(grep -r 'HARNESS_XIAN_ENABLED\|HARNESS_XIAN_BRIDGE_URL' \
  "$REPO_ROOT/packages/brain/src/" \
  "$REPO_ROOT/packages/engine/" \
  --include='*.js' --include='*.cjs' --include='*.mjs' \
  --exclude-dir='__tests__' 2>/dev/null || true)
if [ -z "$FORBIDDEN" ]; then
  echo "    OK: 无禁用字面量"
else
  echo "    FAIL: 发现禁用字面量:"
  echo "$FORBIDDEN"
  exit 1
fi

# 4. 确认 codex-bridge.cjs 有 docker_available 字段（BEHAVIOR-5）
echo "[4] 检查 codex-bridge.cjs 含 docker_available..."
BRIDGE_FILE="packages/brain/scripts/codex-bridge/codex-bridge.cjs"
if grep -q 'docker_available' "$REPO_ROOT/$BRIDGE_FILE"; then
  echo "    OK: docker_available 存在于 codex-bridge.cjs"
else
  echo "    FAIL: docker_available 不存在于 $BRIDGE_FILE"
  exit 1
fi

# 5. 确认 task-router.js 的 getTaskLocation 支持对象入参（BEHAVIOR-1）
echo "[5] 检查 getTaskLocation 对象入参支持..."
ROUTER_FILE="packages/brain/src/task-router.js"
if grep -q 'typeof taskTypeOrTask.*object' "$REPO_ROOT/$ROUTER_FILE"; then
  echo "    OK: getTaskLocation 支持对象入参"
else
  echo "    FAIL: getTaskLocation 未实现对象入参支持"
  exit 1
fi

# 6. 确认 dispatcher.js 有 task.location === 'xian' 直接判断（BEHAVIOR-8）
echo "[6] 检查 dispatcher.js xianBypass task.location 直接判断..."
DISPATCHER_FILE="packages/brain/src/dispatcher.js"
if grep -q "nextTask?.location === 'xian'" "$REPO_ROOT/$DISPATCHER_FILE"; then
  echo "    OK: dispatcher.js 有 task.location 直接判断"
else
  echo "    FAIL: dispatcher.js 未加 task.location === 'xian' 判断"
  exit 1
fi

echo ""
echo "=== 全部 6 项检查通过 ==="
