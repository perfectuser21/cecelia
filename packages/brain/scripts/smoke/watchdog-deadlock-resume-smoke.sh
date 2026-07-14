#!/usr/bin/env bash
# smoke: watchdog 死局解除在位（OPEN PR 的 BEHIND/CI-FAIL 路径）
# task d3343415 合同 [BEHAVIOR-1~4]：BEHIND→重点火 / CI-FAIL→重点火 / pending→等待 / cap→熔断优先
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node -e "
const fs = require('fs');
const wd = fs.readFileSync('packages/brain/src/harness-relay-watchdog.js','utf8');
if (!/resume_ci_red/.test(wd)) { console.error('FAIL: resume_ci_red 标签缺失'); process.exit(1); }
if (!/wait_ci_running/.test(wd)) { console.error('FAIL: wait_ci_running 标签缺失'); process.exit(1); }
if (!/skip_green_waiting_merge/.test(wd)) { console.error('FAIL: skip_green_waiting_merge 标签缺失'); process.exit(1); }
if (!/mapCiStatus/.test(wd)) { console.error('FAIL: mapCiStatus 未内联/导入'); process.exit(1); }
if (!/mergeStateStatus/.test(wd)) { console.error('FAIL: mergeStateStatus 查询缺失'); process.exit(1); }
if (!/gh pr checks/.test(wd)) { console.error('FAIL: gh pr checks 调用缺失'); process.exit(1); }
console.log('OK: watchdog-deadlock-resume smoke passed');
"
