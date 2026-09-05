#!/usr/bin/env bash
# Smoke: launchd-patrol — 宿主 launchd 服务巡检哨兵（任务 a5a6209a）
# 验证：
#   1. launchd-patrol.js 存在且含必要导出 + manifest 四组常量
#   2. scheduler-jobs.js 已注册 launchd-patrol job（needsPool:false）
#   3. 告警链接线正确（sendBark dedupeKey 6h + raise P1）+ fail-open
set -euo pipefail

echo "[launchd-patrol-smoke] 1. launchd-patrol.js 存在且含必要导出"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/launchd-patrol.js', 'utf8');
const checks = [
  ['export async function runLaunchdPatrol', 'runLaunchdPatrol 导出'],
  ['export function __resetLaunchdPatrolForTest', '测试复位导出'],
  ['export const MUST_RUN_DAEMONS', 'MUST_RUN_DAEMONS manifest'],
  ['export const MUST_LOAD_DAEMONS', 'MUST_LOAD_DAEMONS manifest'],
  ['export const MUST_LISTEN_PORTS', 'MUST_LISTEN_PORTS manifest'],
  ['export const EXPECTED_DISABLED', 'EXPECTED_DISABLED manifest'],
  ['com.cecelia.bridge', 'bridge 在必查名单'],
  ['launchctl print-disabled system', 'disabled 表核对'],
  ['host_unreachable', '宿主不可达 fail-open'],
  [\"from './host-exec.js'\", 'ssh 逃逸三件套已提取至 host-exec（复用）'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: launchd-patrol.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
// ssh 逃逸能力（BatchMode）随提取搬到 host-exec.js，改在真源处断言
const hostExec = fs.readFileSync('packages/brain/src/host-exec.js', 'utf8');
if (!hostExec.includes('BatchMode=yes') || !hostExec.includes('export function buildHostCmd')) {
  console.error('FAIL: host-exec.js 缺 ssh 逃逸 BatchMode / buildHostCmd 导出');
  process.exit(1);
}
console.log('launchd-patrol.js 结构正确（ssh 逃逸经 host-exec）✓');
"

echo "[launchd-patrol-smoke] 2. scheduler-jobs.js 已注册 launchd-patrol"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!src.includes(\"name: 'launchd-patrol'\") || !src.includes('runLaunchdPatrol')) {
  console.error('FAIL: scheduler-jobs.js 未注册 launchd-patrol');
  process.exit(1);
}
if (!/name: 'launchd-patrol', needsPool: false/.test(src)) {
  console.error('FAIL: launchd-patrol 应为 needsPool:false');
  process.exit(1);
}
console.log('scheduler-jobs.js 已注册 launchd-patrol（needsPool:false）✓');
"

echo "[launchd-patrol-smoke] 3. 告警链接线（Bark 6h 去重 + raise P1）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/launchd-patrol.js', 'utf8');
const checks = [
  ['dedupeKey', 'sendBark dedupeKey'],
  ['6 * 3600', '6h 去重 TTL'],
  [\"raise('P1', 'launchd_patrol_anomaly'\", 'raise P1 事件'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: 告警链缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('告警链接线正确 ✓');
"

echo "[launchd-patrol-smoke] 全部检查通过 ✓"
