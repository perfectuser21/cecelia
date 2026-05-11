#!/usr/bin/env bash
# Smoke: zombie-reaper — Walking Skeleton P1 B2
# 验证：
#   1. zombie-reaper.js 存在且含必要导出
#   2. server.js 已注册 startZombieReaper
#   3. reapZombies 函数结构正确（SQL 查 in_progress + idle 时间）
set -euo pipefail

echo "[zombie-reaper-smoke] 1. zombie-reaper.js 存在且含必要导出"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/zombie-reaper.js', 'utf8');
const checks = [
  ['export async function reapZombies', 'reapZombies 导出'],
  ['export function startZombieReaper', 'startZombieReaper 导出'],
  ['export const ZOMBIE_REAPER_INTERVAL_MS', 'ZOMBIE_REAPER_INTERVAL_MS 导出'],
  [\"status = 'in_progress'\", 'SELECT 查 in_progress 状态'],
  ['updated_at', 'SELECT 检查 updated_at'],
  [\"status = 'failed'\", 'UPDATE 标 failed'],
  ['[reaper] zombie', 'error_message 含 reaper 前缀'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: zombie-reaper.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('zombie-reaper.js 结构正确 ✓');
"

echo "[zombie-reaper-smoke] 2. server.js 已注册 startZombieReaper"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!src.includes('startZombieReaper')) {
  console.error('FAIL: server.js 未注册 startZombieReaper');
  process.exit(1);
}
console.log('server.js 已注册 startZombieReaper ✓');
"

echo "[zombie-reaper-smoke] 3. ZOMBIE_REAPER_INTERVAL_MS 默认 5 分钟"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/zombie-reaper.js', 'utf8');
if (!src.includes('5 * 60 * 1000')) {
  console.error('FAIL: ZOMBIE_REAPER_INTERVAL_MS 不是 5*60*1000');
  process.exit(1);
}
console.log('ZOMBIE_REAPER_INTERVAL_MS = 5min ✓');
"

echo "[zombie-reaper-smoke] 全部检查通过 ✓"
