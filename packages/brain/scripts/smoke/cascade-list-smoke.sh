#!/usr/bin/env bash
# Smoke: S3 联动清单（MJ5 刀3）——cascade-list 模块结构 + 逻辑校验
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. cascade-list.js 存在且导出正确
[ -f "packages/brain/src/cascade-list.js" ] \
  || { echo "FAIL: cascade-list.js 不存在"; exit 1; }
echo "OK: cascade-list.js 存在"

grep -q "export function isRunnable" packages/brain/src/cascade-list.js \
  || { echo "FAIL: isRunnable 未导出"; exit 1; }
grep -q "export function buildCascadeReport" packages/brain/src/cascade-list.js \
  || { echo "FAIL: buildCascadeReport 未导出"; exit 1; }
echo "OK: isRunnable + buildCascadeReport 已导出"

# 2. cascade-writeback.js 存在且导出正确
[ -f "packages/brain/src/lib/cascade-writeback.js" ] \
  || { echo "FAIL: lib/cascade-writeback.js 不存在"; exit 1; }
grep -q "export async function writeCascadeCellStatuses" packages/brain/src/lib/cascade-writeback.js \
  || { echo "FAIL: writeCascadeCellStatuses 未导出"; exit 1; }
echo "OK: writeCascadeCellStatuses 已导出"

# 3. journeys.js 接入 cascade-list
grep -q "import.*cascade-list" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: journeys.js 未 import cascade-list"; exit 1; }
grep -q "cascade-list" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: journeys.js 缺少 /cascade-list 路由"; exit 1; }
echo "OK: journeys.js 已接入 cascade-list 路由"

# 4. execution.js 已接入 cascade writeback
grep -q "cascade-writeback" packages/brain/src/routes/execution.js \
  || { echo "FAIL: execution.js 未引入 cascade-writeback"; exit 1; }
grep -q "writeCascadeCellStatuses" packages/brain/src/routes/execution.js \
  || { echo "FAIL: execution.js 缺少 writeCascadeCellStatuses 调用"; exit 1; }
echo "OK: execution.js cascade writeback 已接入"

# 5. evaluator SKILL.md 含 S3 联动清单步骤
grep -q "S3 联动清单\|cascade-list\|cascade_report" packages/workflows/skills/harness-evaluator/SKILL.md \
  || { echo "FAIL: evaluator SKILL.md 未含 S3 联动清单步骤"; exit 1; }
echo "OK: evaluator SKILL.md 含 S3 联动清单步骤"

# 6. 用 node 跑 cascade-list 逻辑验证
node --input-type=module -e "
import { isRunnable, buildCascadeReport } from './packages/brain/src/cascade-list.js';

// isRunnable
if (!isRunnable('tests/brain/foo.test.js')) { console.error('FAIL: tests/ isRunnable'); process.exit(1); }
if (!isRunnable('manual:curl localhost:5221/ping')) { console.error('FAIL: manual: isRunnable'); process.exit(1); }
if (isRunnable(null)) { console.error('FAIL: null should not be runnable'); process.exit(1); }
if (isRunnable('L3:real-device')) { console.error('FAIL: L3: should not be runnable'); process.exit(1); }
console.log('OK: isRunnable 逻辑正确（4 case）');

// buildCascadeReport
const cells = [
  { assertion_ref: 'tests/a.test.js', na_reason: null },
  { assertion_ref: 'manual:curl', na_reason: null },
  { assertion_ref: 'L3:device', na_reason: null },
  { assertion_ref: null, na_reason: null },
];
const r = buildCascadeReport(cells);
if (r.total !== 4) { console.error('FAIL: total', r.total); process.exit(1); }
if (r.runnable_count !== 2) { console.error('FAIL: runnable_count', r.runnable_count); process.exit(1); }
if (r.nightly_pending_count !== 1) { console.error('FAIL: nightly_pending', r.nightly_pending_count); process.exit(1); }
if (r.unregistered_count !== 1) { console.error('FAIL: unregistered', r.unregistered_count); process.exit(1); }
if (!r.report_text.includes('4')) { console.error('FAIL: report_text missing 4:', r.report_text); process.exit(1); }
console.log('OK: buildCascadeReport 逻辑正确，report_text:', r.report_text);

console.log('');
console.log('✅ cascade-list smoke 全部通过');
"

echo ""
echo "✅ S3 cascade-list smoke 全部通过"
