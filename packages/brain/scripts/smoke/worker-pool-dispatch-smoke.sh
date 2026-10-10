#!/usr/bin/env bash
# Smoke: worker-pool-dispatch — 并行血管P1 worker池自动派发（任务 873acc6d）
# 原实现往宿主 tmux slot7-9 发射交互 claude；Claude 无头通道已退役（任务 76a160b3，决策 067867c8），
# 本 smoke 改验退役收口：
# 1. job 仍挂 scheduler-jobs 注册表（调度不崩）
# 2. runWorkerPoolDispatch 每轮只返回 skipped=claude_channel_retired，不查库、不执行任何命令
# 3. 实现代码里不再出现 tmux / ssh / claude 启动
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT_DIR"

echo "[worker-pool-smoke] 1. scheduler-jobs 挂载"
node -e "
const fs = require('fs');
const sched = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!sched.includes(\"name: 'worker-pool-dispatch'\")) { console.error('FAIL: scheduler-jobs 缺 worker-pool-dispatch 挂载'); process.exit(1); }
console.log('挂载 ✓');
"

echo "[worker-pool-smoke] 2. 退役收口"
node --input-type=module -e "
import { runWorkerPoolDispatch } from './packages/brain/src/worker-pool-dispatch.js';
let queried = false;
const pool = { query: async () => { queried = true; return { rows: [] }; } };
const out = await runWorkerPoolDispatch(pool);
if (out?.skipped !== 'claude_channel_retired' || out?.dispatched !== 0) { console.error('FAIL: 未返回 skipped=claude_channel_retired: ' + JSON.stringify(out)); process.exit(1); }
if (queried) { console.error('FAIL: 退役后仍查库认领任务'); process.exit(1); }
console.log('skipped=claude_channel_retired ✓');
"

echo "[worker-pool-smoke] 3. 实现不再启动任何进程"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/worker-pool-dispatch.js', 'utf8');
const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
if (/child_process|tmux|ssh|execSync|spawn/.test(code)) { console.error('FAIL: 实现代码里仍有进程启动'); process.exit(1); }
console.log('无进程启动 ✓');
"

echo "[worker-pool-smoke] ALL PASS"
