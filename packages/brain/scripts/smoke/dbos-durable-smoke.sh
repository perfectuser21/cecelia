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

# 3. 公共 Runner 模块加载与接口导出（只注册，不 launch、不连接数据库）
echo "── 公共 Runner durable 注册 ──"
if node --input-type=module -e "
import * as runner from './src/durable/common-runner-durable.js';
const need = ['configureCommonRunnerDurableDeps', 'durableCommonRunnerWorkflow', 'startDurableCommonRunner'];
process.exit(need.every(k => typeof runner[k] === 'function') ? 0 : 1);
" 2>/dev/null; then ok "公共 Runner 顶层注册及接口导出成功"; else fail "公共 Runner 注册或接口导出失败"; fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
