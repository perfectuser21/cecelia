#!/usr/bin/env bash
# Smoke: oom-aware-retry — 刀A7 OOM 感知重试 [task:610ecc9e]
# 验证：
#   1. harness-relay-watchdog.js 含 OOM 感知分支逻辑
#   2. harness-callback.js 含 last_container_exit_code 写入逻辑
#   3. harness-skill-relay.js 含 HARNESS_RELAY_MEMORY_OVERRIDE 传递逻辑
set -euo pipefail

echo "[oom-aware-retry-smoke] 1. harness-relay-watchdog.js 含 OOM 感知重试逻辑"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-relay-watchdog.js', 'utf8');
const checks = [
  ['last_container_exit_code', 'last_container_exit_code 读取'],
  ['oom_upgraded', 'oom_upgraded 标记检查'],
  ['oom_wall', 'oom_wall 失败路径'],
  ['resume_oom_upgraded', 'resume_oom_upgraded 日志标记'],
  ['memoryTier', 'memoryTier 升档选项'],
  ['HARNESS_RELAY_MEMORY_OVERRIDE', 'HARNESS_RELAY_MEMORY_OVERRIDE 环境变量注入'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: harness-relay-watchdog.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('harness-relay-watchdog.js OOM 感知逻辑 ✓');
"

echo "[oom-aware-retry-smoke] 2. harness-callback.js 含 last_container_exit_code 写入"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/harness-callback.js', 'utf8');
const checks = [
  ['last_container_exit_code', 'last_container_exit_code 写入'],
  ['exit_code', 'exit_code 参数读取'],
  ['cecelia-relay-', 'relay 容器分支'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: harness-callback.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('harness-callback.js last_container_exit_code 写入逻辑 ✓');
"

echo "[oom-aware-retry-smoke] 3. harness-skill-relay.js 含 HARNESS_RELAY_MEMORY_OVERRIDE 传递"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-skill-relay.js', 'utf8');
const checks = [
  ['HARNESS_RELAY_MEMORY_OVERRIDE', 'HARNESS_RELAY_MEMORY_OVERRIDE 支持'],
  ['effectiveMemoryOverride', 'effectiveMemoryOverride 合并逻辑'],
  ['memoryOverride', 'memoryOverride 选项'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: harness-skill-relay.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('harness-skill-relay.js HARNESS_RELAY_MEMORY_OVERRIDE 传递逻辑 ✓');
"

echo "[oom-aware-retry-smoke] 所有检查通过 ✓"
