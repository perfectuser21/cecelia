#!/usr/bin/env bash
# Smoke: kernel-log-persist — kernel 落盘日志跨部署持久化 + TTL 清理策略
# 刀0(PR #4721)的默认落盘目录在容器 tmpfs、未 bind-mount，Brain 每次部署即清空，
# 诊断 planner 停摆恰好必然伴随一次部署，缺口和原问题同形状（生产实测确认）。
# 本 smoke 验证：①真实调用 cleanOldKernelLogs 对真实文件做 TTL 清理（非 mock）
# ②harness-skill-relay.js 默认落盘目录不再硬编码 /tmp ③disk-guard.js 真挂了清理钩子
# ④import.meta.url 兜底路径在当前真实 checkout 里确实解析到存在的 repo 根目录
# （3 级 vs 4 级层级数字曾是本次修复的核心风险点，这里用真实文件系统校验，不只是断言字符串）
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."

RELAY_FILE="packages/brain/src/harness-skill-relay.js"
CLEANUP_FILE="packages/brain/src/cron/kernel-log-cleanup.js"
DISK_GUARD_FILE="packages/brain/src/cron/disk-guard.js"

echo "[kernel-log-persist-smoke] 1. 默认落盘目录不再硬编码 /tmp/cecelia-kernel-logs"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$RELAY_FILE', 'utf8');
const seg = src.slice(src.indexOf('export async function launchKernelProcess'),
                      src.indexOf('export function stampMMDDHHNN'));
if (/'\/tmp\/cecelia-kernel-logs'/.test(seg)) {
  console.error('FAIL: 默认 logDir 仍硬编码 /tmp/cecelia-kernel-logs（部署即清空的老问题未修）');
  process.exit(1);
}
if (!/REPO_ROOT/.test(seg) || !seg.includes(\"'logs'\") || !seg.includes(\"'kernel'\")) {
  console.error('FAIL: 未见 REPO_ROOT + logs/kernel 持久路径拼接逻辑');
  process.exit(1);
}
if (!/fileURLToPath/.test(seg)) {
  console.error('FAIL: 未用 fileURLToPath 解码 import.meta.url（percent-encoding 特殊字符路径隐患）');
  process.exit(1);
}
console.log('  PASS: 默认落盘目录已改为 REPO_ROOT/logs/kernel/，用 fileURLToPath 正确解码');
"

echo "[kernel-log-persist-smoke] 2. 真实调用 cleanOldKernelLogs 对真实文件做 TTL 清理（非 mock）"
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

echo "[kernel-log-persist-smoke] 3. disk-guard.js 已挂 kernel 日志 TTL 清理钩子"
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

echo "[kernel-log-persist-smoke] 4. import.meta.url 兜底路径在当前真实 checkout 里解析到存在的 repo 根"
node -e "
const { existsSync } = require('fs');
const { fileURLToPath, pathToFileURL } = require('url');
const { join } = require('path');

// harness-skill-relay.js 在 packages/brain/src/，3 级 ../../.. 应回到 repo 根
const relayUrl = pathToFileURL('$RELAY_FILE').href;
const relayRoot = fileURLToPath(new URL('../../..', relayUrl));
if (!existsSync(join(relayRoot, 'package.json')) || !existsSync(join(relayRoot, 'packages', 'brain'))) {
  console.error('FAIL: harness-skill-relay.js 的 3 级兜底路径未落在真实 repo 根: ' + relayRoot);
  process.exit(1);
}
console.log('  PASS: harness-skill-relay.js 3 级 ../../.. 落在真实 repo 根: ' + relayRoot);

// disk-guard.js 在 packages/brain/src/cron/，比上面深一层，4 级 ../../../.. 应回到同一个 repo 根
const guardUrl = pathToFileURL('$DISK_GUARD_FILE').href;
const guardRoot = fileURLToPath(new URL('../../../..', guardUrl));
if (guardRoot !== relayRoot) {
  console.error('FAIL: disk-guard.js 的 4 级兜底路径与 harness-skill-relay.js 的 3 级兜底路径算出了不同的 repo 根（应该相同）: ' + guardRoot + ' vs ' + relayRoot);
  process.exit(1);
}
console.log('  PASS: disk-guard.js 4 级 ../../../.. 与 harness-skill-relay.js 3 级算出同一个真实 repo 根');
"

echo ""
echo "[kernel-log-persist-smoke] ✅ 全部通过"
