#!/usr/bin/env bash
# Smoke: MJ5 S4 保鲜对账（nightly）——结构校验 + A3 纸门修复验证（v2）
# v2: 追加 kind='base' 纸门删除校验 + group 家②/家③ 收口校验
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. promise-map-nightly.js 存在且导出正确
[ -f "packages/brain/src/promise-map-nightly.js" ] \
  || { echo "FAIL: promise-map-nightly.js 不存在"; exit 1; }
grep -q "export.*runPromiseMapNightly" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: runPromiseMapNightly 未导出"; exit 1; }
grep -q "export.*buildNightlyAssertions" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: buildNightlyAssertions 未导出"; exit 1; }
grep -q "export.*SENTINEL_KEY" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: SENTINEL_KEY 未导出"; exit 1; }
echo "OK: promise-map-nightly.js 导出完整"

# 2. scheduler-jobs.js 已注册
grep -q "promise-map-nightly" packages/brain/src/scheduler-jobs.js \
  || { echo "FAIL: scheduler-jobs.js 未注册 promise-map-nightly"; exit 1; }
grep -q "runPromiseMapNightly" packages/brain/src/scheduler-jobs.js \
  || { echo "FAIL: scheduler-jobs.js 未引入 runPromiseMapNightly"; exit 1; }
echo "OK: scheduler-jobs.js 已注册 promise-map-nightly job"

# 3. 四条断言 key 存在（代码审查）
grep -q "anchor_cell_writeback" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: A1 anchor_cell_writeback 断言缺失"; exit 1; }
grep -q "zero_unanchored_merges" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: A2 zero_unanchored_merges 断言缺失"; exit 1; }
grep -q "ledger_integrity" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: A3 ledger_integrity 断言缺失"; exit 1; }
grep -q "gate_heartbeat" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: A4 gate_heartbeat 断言缺失"; exit 1; }
echo "OK: 4 条断言 key 均在代码中（A1-A4）"

# 4. Bark 告警接入
grep -q "sendBark" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: sendBark 未接入"; exit 1; }
echo "OK: Bark 告警已接入"

# 5. TDD 测试文件存在
[ -f "packages/brain/src/__tests__/promise-map-nightly.test.js" ] \
  || { echo "FAIL: TDD 测试文件不存在"; exit 1; }
grep -q "S4-N" packages/brain/src/__tests__/promise-map-nightly.test.js \
  || { echo "FAIL: 测试文件缺少 S4-N BEHAVIOR 标注"; exit 1; }
echo "OK: TDD 测试文件存在（S4-N 系列）"

# 6. node 逻辑验证——时间窗口和哨兵去重
node --input-type=module -e "
import { NIGHTLY_HOUR_UTC, SENTINEL_KEY } from './packages/brain/src/promise-map-nightly.js';

if (typeof NIGHTLY_HOUR_UTC !== 'number') {
  console.error('FAIL: NIGHTLY_HOUR_UTC 不是数字，实际:', NIGHTLY_HOUR_UTC);
  process.exit(1);
}
if (NIGHTLY_HOUR_UTC < 0 || NIGHTLY_HOUR_UTC > 23) {
  console.error('FAIL: NIGHTLY_HOUR_UTC 超出范围:', NIGHTLY_HOUR_UTC);
  process.exit(1);
}
if (!SENTINEL_KEY || typeof SENTINEL_KEY !== 'string') {
  console.error('FAIL: SENTINEL_KEY 无效:', SENTINEL_KEY);
  process.exit(1);
}
console.log('OK: NIGHTLY_HOUR_UTC =', NIGHTLY_HOUR_UTC, ', SENTINEL_KEY =', SENTINEL_KEY);
"

# 7. A3 纸门修复校验（v2 追加）——kind='base' 已删，改用 group 家②/家③ 收口
if grep -q "kind = 'base'" packages/brain/src/promise-map-nightly.js 2>/dev/null; then
  echo "FAIL: A3 仍使用 kind='base'（永绿纸门），请改为按 group 家②/家③ 收口"; exit 1
fi
grep -q "家③横切件池" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: A3 SQL 缺少 '家③横切件池' group 收口"; exit 1; }
grep -q "家②共享前置" packages/brain/src/promise-map-nightly.js \
  || { echo "FAIL: A3 SQL 缺少 '家②共享前置' group 收口"; exit 1; }
echo "OK: A3 纸门修复校验通过（group 家②/家③ 收口，无 kind='base'）"

echo ""
echo "✅ MJ5 S4 promise-map-nightly smoke 全部通过（v2：A3 纸门修复已验证）"
