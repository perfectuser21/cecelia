#!/usr/bin/env bash
# t6-dev-dispatch-migration-smoke.sh — T6:dev 派发迁离 LangGraph 结构冒烟
# 守卫:dev-task 图必须保持物理删除,dispatcher 不得再走 _dispatchViaWorkflowRuntime,
# workflows/index.js 不得再注册 dev-task(防回潮——活性信号恒 NULL 的根源)。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── T6 dev 派发迁移 smoke ──"
[[ ! -f "$ROOT/src/workflows/dev-task.graph.js" ]] && ok "dev-task.graph.js 已物理删除" || bad "dev-task.graph.js 仍存在"
! grep -q "_dispatchViaWorkflowRuntime" "$ROOT/src/dispatcher.js" && ok "dispatcher 无 _dispatchViaWorkflowRuntime" || bad "dispatcher 仍引用 workflow runtime"
! grep -E 'registerWorkflow\(.dev-task' "$ROOT/src/workflows/index.js" >/dev/null && ok "workflows/index 无 dev-task 注册" || bad "workflows/index 仍注册 dev-task"
grep -q "triggerCeceliaRun" "$ROOT/src/dispatcher.js" && ok "dev 与其他类型统一走 triggerCeceliaRun" || bad "dispatcher 缺 triggerCeceliaRun 调用"

echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
