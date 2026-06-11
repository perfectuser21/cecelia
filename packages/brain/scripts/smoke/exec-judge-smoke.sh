#!/usr/bin/env bash
# exec-judge-smoke.sh
# 验收：executeContractCommands / validateCoverageTable / isLegacyMode 函数正确导出
set -uo pipefail

PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. executeContractCommands 导出存在
echo "── executeContractCommands export ──"
result=$(node --input-type=module -e "
import { executeContractCommands } from '/workspace/packages/brain/src/harness-final-e2e.js';
console.log(typeof executeContractCommands === 'function' ? 'ok' : 'missing');
" 2>/dev/null || echo "error")
[[ "$result" == "ok" ]] \
  && ok "executeContractCommands 导出存在" \
  || fail "executeContractCommands 未导出（$result）"

# 2. validateCoverageTable 导出存在
echo "── validateCoverageTable export ──"
result=$(node --input-type=module -e "
import { validateCoverageTable } from './packages/brain/src/harness-final-e2e.js';
console.log(typeof validateCoverageTable === 'function' ? 'ok' : 'missing');
" 2>/dev/null || echo "error")
[[ "$result" == "ok" ]] \
  && ok "validateCoverageTable 导出存在" \
  || fail "validateCoverageTable 未导出（$result）"

# 3. isLegacyMode 导出存在，无 EVALUATOR_LEGACY 时返回 false
echo "── isLegacyMode export ──"
result=$(node --input-type=module -e "
import { isLegacyMode } from './packages/brain/src/harness-final-e2e.js';
console.log(isLegacyMode() === false ? 'ok' : 'wrong');
" 2>/dev/null || echo "error")
[[ "$result" == "ok" ]] \
  && ok "isLegacyMode() 导出且默认返回 false" \
  || fail "isLegacyMode 导出/行为异常（$result）"

# 4. validateCoverageTable 缺步时返回 ok=false
echo "── validateCoverageTable logic ──"
result=$(node --input-type=module -e "
import { validateCoverageTable } from './packages/brain/src/harness-final-e2e.js';
const r = validateCoverageTable({steps:[]}, ['Step A','Step B']);
console.log(r.ok === false && r.missing.length === 2 ? 'ok' : 'wrong:'+JSON.stringify(r));
" 2>/dev/null || echo "error")
[[ "$result" == "ok" ]] \
  && ok "validateCoverageTable 缺步返回 ok=false + missing" \
  || fail "validateCoverageTable 逻辑异常（$result）"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
