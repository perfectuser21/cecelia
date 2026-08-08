#!/usr/bin/env bash
# Smoke: kernel-stdio-capture — TOP2 战役刀0，解 kernel 零观测
# launchKernelProcess 的 detached kernel 必须把 stdout/stderr 落盘到日志文件，
# 不再 stdio:'ignore'（否则 planner 停摆/崩溃零遗言无法诊断）。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."

echo "[kernel-stdio-capture-smoke] 1. launchKernelProcess 不再用 stdio:'ignore'"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-skill-relay.js', 'utf8');
// launchKernelProcess 段内不得再出现裸 stdio:'ignore' 作为 spawn 配置
const seg = src.slice(src.indexOf('export async function launchKernelProcess'),
                      src.indexOf('export function stampMMDDHHNN'));
if (/stdio:\s*'ignore'\s*,/.test(seg) && !/回落 ignore/.test(seg)) {
  console.error('FAIL: launchKernelProcess 仍硬用 stdio:ignore（零观测未解）');
  process.exit(1);
}
if (!seg.includes('CECELIA_KERNEL_LOG_DIR') || !seg.includes('openSync')) {
  console.error('FAIL: 缺日志落盘（CECELIA_KERNEL_LOG_DIR + openSync）');
  process.exit(1);
}
if (!seg.includes('CECELIA_KERNEL_LOG_PATH')) {
  console.error('FAIL: 未把日志路径透传给 kernel 自身（CECELIA_KERNEL_LOG_PATH）');
  process.exit(1);
}
console.log('stdio 落盘 + env 透传 ✓');
"

echo "[kernel-stdio-capture-smoke] 2. 打不开日志回落 ignore 不阻断 spawn"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-skill-relay.js', 'utf8');
if (!/catch[\s\S]{0,120}回落 stdio:ignore/.test(src)) {
  console.error('FAIL: 缺日志不可用时的 ignore 回落（spawn 不能因日志失败而崩）');
  process.exit(1);
}
console.log('回落守卫 ✓');
"

echo "[kernel-stdio-capture-smoke] ✅ 全部通过"
