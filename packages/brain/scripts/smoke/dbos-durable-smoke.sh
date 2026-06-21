#!/usr/bin/env bash
# dbos-durable-smoke.sh
# 验收：DBOS durable 底座 flag 门控行为（默认关=行为零变化、flag 切换生效、durable 模块可加载且顶层注册不抛）。
# 纯模块级校验，无需 live brain / DB，CI 可直接跑。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1   # → packages/brain
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. flag 默认关 → isDurableEnabled()=false（行为零变化的根）
echo "── flag 默认关 ──"
unset DBOS_DURABLE_ENABLED
if node --input-type=module -e "
import { isDurableEnabled } from './src/durable/dbos-runtime.js';
process.exit(isDurableEnabled() === false ? 0 : 1);
" 2>/dev/null; then ok "DBOS_DURABLE_ENABLED 未设 → isDurableEnabled()=false"; else fail "flag 默认应为 false"; fi

# 2. flag=true → isDurableEnabled()=true
echo "── flag 开 ──"
if DBOS_DURABLE_ENABLED=true node --input-type=module -e "
import { isDurableEnabled } from './src/durable/dbos-runtime.js';
process.exit(isDurableEnabled() === true ? 0 : 1);
" 2>/dev/null; then ok "DBOS_DURABLE_ENABLED=true → isDurableEnabled()=true"; else fail "flag=true 未生效"; fi

# 3. durable 模块加载 + 顶层注册不抛（C1 修复的根：注册必须能在 launch 前完成）
echo "── durable 模块加载 ──"
if node --input-type=module -e "
import './src/durable/daily-report-durable.js';
import './src/durable/daily-report-router.js';
" 2>/dev/null; then ok "durable 模块加载成功（顶层 registerStep/registerWorkflow 不抛）"; else fail "durable 模块加载失败"; fi

# 4. daily-report-generator 仍导出 step 函数（durable 复用基础，回归不破）
echo "── 复用基础 ──"
if node --input-type=module -e "
import * as g from './src/daily-report-generator.js';
const need = ['hasTodayReport','buildReportText','saveReportToWorkingMemory','isInReportTriggerWindow'];
process.exit(need.every(k => typeof g[k] === 'function') ? 0 : 1);
" 2>/dev/null; then ok "daily-report step 函数已导出供 durable 复用"; else fail "step 函数导出缺失"; fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
