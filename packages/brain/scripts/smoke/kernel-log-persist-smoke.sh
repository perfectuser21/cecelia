#!/usr/bin/env bash
# Smoke: kernel-log-persist — kernel 落盘日志跨部署持久化 + TTL 清理策略
# 刀0(PR #4721)的默认落盘目录在容器 tmpfs、未 bind-mount，Brain 每次部署即清空，
# 诊断 planner 停摆恰好必然伴随一次部署，缺口和原问题同形状（生产实测确认）。
# 本 smoke 验证：①真实调用 cleanOldKernelLogs 对真实文件做 TTL 清理（非 mock）
# ②disk-guard.js 真挂了清理钩子（kernel-v1 启动路径已随 A5 删除，落盘目录断言随之移除）
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."

CLEANUP_FILE="packages/brain/src/cron/kernel-log-cleanup.js"
DISK_GUARD_FILE="packages/brain/src/cron/disk-guard.js"

echo "[kernel-log-persist-smoke] 1. 真实调用 cleanOldKernelLogs 对真实文件做 TTL 清理（非 mock）"
node -e "
(async () => {
  const { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } = require('fs');
  const { tmpdir } = require('os');
  const { join } = require('path');
  const { pathToFileURL } = require('url');

  const mod = await import(pathToFileURL('$CLEANUP_FILE').href);
  const { cleanOldKernelLogs, KERNEL_LOG_TTL_MS } = mod;

  if (typeof cleanOldKernelLogs !== 'function') {
    console.error('FAIL: cleanOldKernelLogs 未导出为函数');
    process.exit(1);
  }
  if (KERNEL_LOG_TTL_MS !== 7 * 24 * 60 * 60 * 1000) {
    console.error('FAIL: 默认 TTL 不是 7 天，实际=' + KERNEL_LOG_TTL_MS);
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), 'kernel-log-persist-smoke-'));
  try {
    const oldFile = join(dir, 'kernel-old-run.log');
    const freshFile = join(dir, 'kernel-fresh-run.log');
    writeFileSync(oldFile, 'stale kernel run log');
    writeFileSync(freshFile, 'active kernel run log');

    const now = Date.now();
    const ttlMs = 7 * 24 * 60 * 60 * 1000;
    utimesSync(oldFile, new Date(now - ttlMs - 60_000), new Date(now - ttlMs - 60_000));
    utimesSync(freshFile, new Date(now - 60_000), new Date(now - 60_000));

    const result = cleanOldKernelLogs(dir, ttlMs, now);
    if (existsSync(oldFile)) {
      console.error('FAIL: 超 TTL 的真实文件未被清理: ' + oldFile);
      process.exit(1);
    }
    if (!existsSync(freshFile)) {
      console.error('FAIL: 未超 TTL 的真实文件被误删: ' + freshFile);
      process.exit(1);
    }
    if (result.scanned !== 2 || result.removed !== 1) {
      console.error('FAIL: 扫描/清理计数不对，实际=' + JSON.stringify(result));
      process.exit(1);
    }
    console.log('  PASS: 真实临时目录/文件被正确扫描与清理，scanned=2 removed=1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
"

echo "[kernel-log-persist-smoke] 2. disk-guard.js 已挂 kernel 日志 TTL 清理钩子"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$DISK_GUARD_FILE', 'utf8');
if (!/kernel-log-cleanup\.js/.test(src)) {
  console.error('FAIL: disk-guard.js 未 import kernel-log-cleanup.js');
  process.exit(1);
}
if (!/deps\.cleanOldKernelLogs/.test(src)) {
  console.error('FAIL: 未见依赖注入 deps.cleanOldKernelLogs（跟 runWorktreeReaper 同款写法）');
  process.exit(1);
}
console.log('  PASS: disk-guard.js 清理序列已挂 kernel 日志 TTL 清理');
"

echo "[kernel-log-persist-smoke] ✅ 全部通过"
