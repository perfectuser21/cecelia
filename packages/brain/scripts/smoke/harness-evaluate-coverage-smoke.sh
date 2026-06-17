#!/usr/bin/env bash
# harness-evaluate-coverage-smoke.sh
# 验收：harness-shared.js EvaluatorOutputSchema 含 coverage 字段，evaluate 模块可导入
set -uo pipefail

PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. harness-shared.js 含 coverage 字段声明
echo "── harness-shared.js coverage schema ──"
node -e "
  const fs = require('fs');
  const c = fs.readFileSync('packages/brain/src/harness-shared.js', 'utf8');
  if (!c.includes('coverage')) { console.error('coverage missing'); process.exit(1); }
  console.log('coverage field present');
" && ok "harness-shared.js 含 coverage 字段" || fail "harness-shared.js 缺 coverage 字段"

# 2. evaluate.js 可导入（ESM 模块加载不报错）
echo "── evaluate.js 可导入 ──"
node --input-type=module -e "
  import('./packages/engine/src/harness/evaluate.js').then(m => {
    if (typeof m.runEvaluate !== 'function') throw new Error('runEvaluate missing');
    if (typeof m.parseE2EScript !== 'function') throw new Error('parseE2EScript missing');
    console.log('evaluate module OK');
  });
" 2>/dev/null && ok "evaluate.js 导出 runEvaluate + parseE2EScript" || fail "evaluate.js 导入失败"

# 3. runner.js 可导入
echo "── runner.js 可导入 ──"
node --input-type=module -e "
  import('./packages/engine/src/harness/runner.js').then(m => {
    if (typeof m.executeAndRecord !== 'function') throw new Error('executeAndRecord missing');
    console.log('runner module OK');
  });
" 2>/dev/null && ok "runner.js 导出 executeAndRecord" || fail "runner.js 导入失败"

# 4. e2e-judge.js 可导入
echo "── e2e-judge.js 可导入 ──"
node --input-type=module -e "
  import('./packages/engine/src/harness/e2e-judge.js').then(m => {
    if (typeof m.judgeExecution !== 'function') throw new Error('judgeExecution missing');
    console.log('e2e-judge module OK');
  });
" 2>/dev/null && ok "e2e-judge.js 导出 judgeExecution" || fail "e2e-judge.js 导入失败"

# 5. Brain API /health 存活（smoke 需要 API 真在线才能跑全量）
echo "── Brain API health ──"
API="${BRAIN_URL:-http://localhost:5221}"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API/health" 2>/dev/null || echo "000")
if [[ "$code" == "200" ]]; then
  ok "Brain /health → 200（服务在线）"
else
  echo "⏭️  Brain 未启动（/health → $code），跳过 API 检查"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
