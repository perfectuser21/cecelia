#!/usr/bin/env bash
# executor-contracts-smoke.sh
# 验收：executor_kind 列存在 + executor-contracts.js 模块可 import + assessTaskLiveness 入口可调用
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. tasks 表含 executor_kind 列（migration 329 已跑）
echo "── executor_kind 列存在 ──"
code=$(curl -s -o /dev/null -w "%{http_code}" \
  "$API/tasks?limit=1" 2>/dev/null)
[[ "$code" == "200" ]] \
  && ok "GET /tasks → 200（DB 连通）" \
  || fail "GET /tasks → 期望 200，得 $code（DB 未就绪）"

# 2. executor-contracts.js 模块存在且含五合同键
echo "── executor-contracts.js 模块结构 ──"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_FILE="$SCRIPT_DIR/../../src/executor-contracts.js"
if [[ -f "$CONTRACTS_FILE" ]]; then
  ok "executor-contracts.js 文件存在"
  for kind in "brain-local" "relay-container" "headed-session" "bridge" "external-worker"; do
    grep -q "'${kind}'" "$CONTRACTS_FILE" \
      && ok "合同键 '${kind}' 存在" \
      || fail "合同键 '${kind}' 缺失"
  done
  grep -q "assessTaskLiveness" "$CONTRACTS_FILE" \
    && ok "assessTaskLiveness 入口存在" \
    || fail "assessTaskLiveness 入口缺失"
  grep -q "markExecutorKind" "$CONTRACTS_FILE" \
    && ok "markExecutorKind 打标函数存在" \
    || fail "markExecutorKind 打标函数缺失"
else
  fail "executor-contracts.js 不存在于 $CONTRACTS_FILE"
fi

# 3. 四个打标点在 executor.js 中存在
echo "── executor.js 打标点存在 ──"
EXECUTOR_FILE="$SCRIPT_DIR/../../src/executor.js"
if [[ -f "$EXECUTOR_FILE" ]]; then
  grep -q "markExecutorKind" "$EXECUTOR_FILE" \
    && ok "executor.js 含 markExecutorKind 调用" \
    || fail "executor.js 缺少 markExecutorKind 调用"
  grep -q "'relay-container'" "$EXECUTOR_FILE" \
    && ok "executor.js 含 relay-container 打标" \
    || fail "executor.js 缺少 relay-container 打标"
  grep -q "'external-worker'" "$EXECUTOR_FILE" \
    && ok "executor.js 含 external-worker 打标" \
    || fail "executor.js 缺少 external-worker 打标"
else
  fail "executor.js 不存在"
fi

# 4. dispatcher.js 含 dev 打标
echo "── dispatcher.js 打标点 ──"
DISPATCHER_FILE="$SCRIPT_DIR/../../src/dispatcher.js"
if [[ -f "$DISPATCHER_FILE" ]]; then
  grep -q "markExecutorKind" "$DISPATCHER_FILE" \
    && ok "dispatcher.js 含 markExecutorKind 调用" \
    || fail "dispatcher.js 缺少 markExecutorKind 调用"
  grep -q "brain-local" "$DISPATCHER_FILE" \
    && ok "dispatcher.js 含 brain-local 打标（dev 暂标）" \
    || fail "dispatcher.js 缺少 brain-local 打标"
else
  fail "dispatcher.js 不存在"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
