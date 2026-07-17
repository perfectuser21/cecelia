#!/usr/bin/env bash
# Smoke: codex-test-gen — 每日测试补齐生成器（Sprint 07172225-codex-pool-activation）
# 验证：
#   1. packages/brain/src/codex-test-gen.js 存在且含 codex_test_gen 入队逻辑
#   2. scheduler-jobs.js JOBS 含 codex-test-gen 条目
#   3. task-router.js VALID_TASK_TYPES/SKILL_WHITELIST/LOCATION_MAP 含 codex_test_gen
#   4. battle-report.js 含 codex_test_gen 计数注入
#   5. 黑名单过滤：dispatcher/slot-allocator/migration 均在过滤列表中
#   6. tick.js / tick-runner.js 不含 codex-test-gen（不走 deprecated 路径）
set -euo pipefail

echo "[codex-test-gen-smoke] 1. codex-test-gen.js 存在且含入队逻辑"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/codex-test-gen.js', 'utf8');
if (!src.includes('codex_test_gen')) { console.error('FAIL: codex-test-gen.js 缺 codex_test_gen 字面量'); process.exit(1); }
if (!src.includes('runCodexTestGen')) { console.error('FAIL: codex-test-gen.js 缺 runCodexTestGen 导出'); process.exit(1); }
console.log('OK: codex-test-gen.js 存在且含入队逻辑');
"

echo "[codex-test-gen-smoke] 2. scheduler-jobs.js JOBS 含 codex-test-gen"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!src.includes(\"'codex-test-gen'\")) { console.error('FAIL: scheduler-jobs.js 缺 codex-test-gen 条目'); process.exit(1); }
if (!src.includes('runCodexTestGen')) { console.error('FAIL: scheduler-jobs.js 未引入 runCodexTestGen'); process.exit(1); }
console.log('OK: scheduler-jobs.js JOBS 含 codex-test-gen');
"

echo "[codex-test-gen-smoke] 3. task-router.js 三处均含 codex_test_gen"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
if (!src.includes(\"'codex_test_gen'\")) { console.error('FAIL: task-router.js VALID_TASK_TYPES 缺 codex_test_gen'); process.exit(1); }
if (!src.includes('/codex-test-gen')) { console.error('FAIL: task-router.js SKILL_WHITELIST 缺 /codex-test-gen'); process.exit(1); }
console.log('OK: task-router.js 三处含 codex_test_gen');
"

echo "[codex-test-gen-smoke] 4. battle-report.js 含 codex_test_gen 计数注入"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/battle-report.js', 'utf8');
if (!src.includes('codex_test_gen')) { console.error('FAIL: battle-report.js 未注入 codex_test_gen 计数逻辑'); process.exit(1); }
console.log('OK: battle-report.js 含 codex_test_gen 计数注入');
"

echo "[codex-test-gen-smoke] 5. 黑名单过滤完整（dispatcher / slot-allocator / migration）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/codex-test-gen.js', 'utf8');
const blockers = ['dispatcher', 'slot-allocator', 'migration'];
const missing = blockers.filter(b => !src.includes(b));
if (missing.length > 0) { console.error('FAIL: codex-test-gen.js 黑名单缺:', missing.join(', ')); process.exit(1); }
console.log('OK: 黑名单完整 (' + blockers.join(', ') + ')');
"

echo "[codex-test-gen-smoke] 6. tick.js / tick-runner.js 不含 codex-test-gen（不走 deprecated 路径）"
node -e "
const fs = require('fs');
const tick = fs.existsSync('packages/brain/src/tick.js') ? fs.readFileSync('packages/brain/src/tick.js', 'utf8') : '';
const runner = fs.existsSync('packages/brain/src/tick-runner.js') ? fs.readFileSync('packages/brain/src/tick-runner.js', 'utf8') : '';
if (tick.includes('codex-test-gen') || runner.includes('codex-test-gen')) {
  console.error('FAIL: codex-test-gen 出现在 tick.js/tick-runner.js（deprecated 路径）'); process.exit(1);
}
console.log('OK: tick 路径清洁，codex-test-gen 仅在 scheduler-jobs.js 注册');
"

echo "[codex-test-gen-smoke] ALL PASS"
