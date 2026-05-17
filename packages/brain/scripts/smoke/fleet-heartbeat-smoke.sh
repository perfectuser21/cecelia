#!/usr/bin/env bash
# Smoke: fleet-heartbeat — fleet 心跳可信度字段验证
# 验证：fleet-resource-cache.js 含 HEARTBEAT_OFFLINE_GRACE_MIN + last_ping_at + offline_reason
set -euo pipefail

echo "[fleet-heartbeat-smoke] 1. 验证 fleet-resource-cache.js 含 HEARTBEAT_OFFLINE_GRACE_MIN"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/fleet-resource-cache.js', 'utf8');
if (!src.includes('HEARTBEAT_OFFLINE_GRACE_MIN')) {
  console.error('FAIL: fleet-resource-cache.js 缺少 HEARTBEAT_OFFLINE_GRACE_MIN'); process.exit(1);
}
console.log('HEARTBEAT_OFFLINE_GRACE_MIN 存在 ✓');
"

echo "[fleet-heartbeat-smoke] 2. 验证 last_ping_at 字段存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/fleet-resource-cache.js', 'utf8');
if (!src.includes('last_ping_at')) {
  console.error('FAIL: fleet-resource-cache.js 缺少 last_ping_at'); process.exit(1);
}
console.log('last_ping_at 字段存在 ✓');
"

echo "[fleet-heartbeat-smoke] 3. 验证 offline_reason 字段及两种取值"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/fleet-resource-cache.js', 'utf8');
if (!src.includes('offline_reason')) {
  console.error('FAIL: fleet-resource-cache.js 缺少 offline_reason'); process.exit(1);
}
if (!src.includes('fetch_failed') || !src.includes('no_ping_grace_exceeded')) {
  console.error('FAIL: offline_reason 缺少枚举值 fetch_failed / no_ping_grace_exceeded'); process.exit(1);
}
console.log('offline_reason 及枚举值存在 ✓');
"

echo "[fleet-heartbeat-smoke] 4. 验证测试文件存在"
node -e "
require('fs').accessSync('packages/brain/src/__tests__/fleet-heartbeat.test.js');
console.log('fleet-heartbeat.test.js 存在 ✓');
"

echo "[fleet-heartbeat-smoke] 全部检查通过 ✓"
