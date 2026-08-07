#!/usr/bin/env bash
# Smoke: acceptance-aging — 人验收承诺的机器检查三件套（主理人条件，决策 18174291）
# 1. acceptance-aging 哨兵已挂 scheduler-jobs（48h 超时红灯 + Bark）
# 2. results 端点有驳回转变沿自动开任务（含幂等检测）
# 3. 哨兵含驳回补偿扫描（failed 无修复任务告警）
set -euo pipefail

echo "[acceptance-aging-smoke] 1. 哨兵挂载与阈值"
node -e "
const fs = require('fs');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!sched.includes(\"name: 'acceptance-aging'\")) { console.error('FAIL: scheduler-jobs 缺 acceptance-aging 挂载'); process.exit(1); }
const aging = fs.readFileSync('packages/brain/src/acceptance-aging.js', 'utf8');
if (!aging.includes('48') || !aging.includes('sendBark')) { console.error('FAIL: 缺 48h 阈值或 Bark 告警'); process.exit(1); }
if (!aging.includes('NOT EXISTS')) { console.error('FAIL: 缺驳回补偿扫描'); process.exit(1); }
// A10②：哨兵不止告警，还要把没人开始验的 pending 推进到 expired 终态
if (!/UPDATE acceptance_runs[\s\S]*status = 'expired'/.test(aging)) { console.error('FAIL: 缺 pending→expired 过期转移'); process.exit(1); }
if (!aging.includes('ORPHAN_SCAN_LEGACY_STATUSES')) { console.error('FAIL: orphan 扫描缺历史口径标注常量'); process.exit(1); }
console.log('哨兵挂载/阈值/补偿扫描/过期转移 ✓');
"

echo "[acceptance-aging-smoke] 2. 驳回转变沿"
node -e "
const fs = require('fs');
const routes = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
if (!routes.includes('[验收驳回]')) { console.error('FAIL: results 端点缺驳回自动开任务'); process.exit(1); }
// 转变沿判据已提取成具名函数（7 值状态机重构副产物）。断言锚在函数名而非行内表达式上：
// 上一版断的是 \`prev.status !== 'failed'\` 这个字面量，提取函数后行为没变、断言先死了。
if (!routes.includes('isLegacyRejectionTransition')) { console.error('FAIL: 缺转变沿检测（会重复开任务）'); process.exit(1); }
if (!routes.includes('acceptance_run_key')) { console.error('FAIL: 驳回任务缺 run_key 锚点（查重失效）'); process.exit(1); }
console.log('驳回转变沿 ✓');
"

echo "[acceptance-aging-smoke] 全部通过 ✅"
