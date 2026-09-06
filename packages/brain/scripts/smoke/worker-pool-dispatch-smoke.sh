#!/usr/bin/env bash
# Smoke: worker-pool-dispatch — 并行血管P1 worker池自动派发（任务 873acc6d）
# 1. job 已挂 scheduler-jobs 注册表
# 2. slot 白名单铁律：只用 slot7-9，slot1-6（harness/主理人地盘）绝不出现
# 3. 并发上限/预占/记账三件套在实现里
set -euo pipefail

echo "[worker-pool-smoke] 1. scheduler-jobs 挂载"
node -e "
const fs = require('fs');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!sched.includes(\"name: 'worker-pool-dispatch'\")) { console.error('FAIL: scheduler-jobs 缺 worker-pool-dispatch 挂载'); process.exit(1); }
console.log('挂载 ✓');
"

echo "[worker-pool-smoke] 2. slot 白名单铁律"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/worker-pool-dispatch.js', 'utf8');
if (!src.includes(\"['slot7', 'slot8', 'slot9']\")) { console.error('FAIL: WORKER_SLOTS 白名单被改动'); process.exit(1); }
// 只查代码（剥注释），防注释里提及'slot1-6 禁碰'被误咬
const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
if (/slot[1-6]\b/.test(code)) { console.error('FAIL: 实现代码里出现 slot1-6（harness 地盘）'); process.exit(1); }
console.log('slot7-9 白名单 ✓');
"

echo "[worker-pool-smoke] 3. 并发上限/预占/记账"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/worker-pool-dispatch.js', 'utf8');
if (!src.includes('MAX_CONCURRENT = 2')) { console.error('FAIL: 并发上限不是 2'); process.exit(1); }
if (!src.includes(\"'interactive-dev-skill'\")) { console.error('FAIL: 缺 interactive-dev-skill 预占（/dev 409 约定）'); process.exit(1); }
if (!src.includes('dispatch_events')) { console.error('FAIL: 缺 dispatch_events 记账'); process.exit(1); }
if (!src.includes('claimed_by IS NULL')) { console.error('FAIL: 预占缺 CAS 条件'); process.exit(1); }
console.log('并发2/预占/记账 ✓');
"

echo "[worker-pool-smoke] ALL PASS"
