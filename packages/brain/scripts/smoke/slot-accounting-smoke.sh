#!/usr/bin/env bash
# Smoke: slot-accounting — DB-authoritative in_progress 对齐
# 验证：calculateSlotBudget() 不再用 Math.max(sessions.total, db)，
#       totalRunning = userSlotsUsed + ceceliaUsed + autoDispatchUsed
set -euo pipefail

echo "[slot-accounting-smoke] 1. 验证 slot-allocator.js 可执行代码中消除 Math.max(sessions.total"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/slot-allocator.js', 'utf8');
// 过滤注释行后检查是否仍有 Math.max(sessions.total 调用
const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
const code = codeLines.join('\n');
if (code.includes('Math.max(sessions.total')) {
  console.error('FAIL: slot-allocator.js 可执行代码仍含 Math.max(sessions.total ...) — 孤儿进程污染 Pool C');
  process.exit(1);
}
console.log('Math.max(sessions.total 已从可执行代码中消除 ✓');
"

echo "[slot-accounting-smoke] 2. 验证 totalRunning 使用三源相加公式"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/slot-allocator.js', 'utf8');
if (!src.includes('totalRunning = userSlotsUsed + ceceliaUsed + autoDispatchUsed')) {
  console.error('FAIL: slot-allocator.js 缺少 totalRunning = userSlotsUsed + ceceliaUsed + autoDispatchUsed');
  process.exit(1);
}
console.log('totalRunning 三源公式存在 ✓');
"

echo "[slot-accounting-smoke] 3. 验证测试文件存在"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/src/__tests__/slot-accounting.test.js')) {
  console.error('FAIL: slot-accounting.test.js 不存在');
  process.exit(1);
}
const src = fs.readFileSync('packages/brain/src/__tests__/slot-accounting.test.js', 'utf8');
if (!src.includes('zombie') || !src.includes('DB in_progress=0')) {
  console.error('FAIL: slot-accounting.test.js 缺少 zombie/DB 场景测试');
  process.exit(1);
}
console.log('slot-accounting.test.js 存在且含 zombie 场景 ✓');
"

echo "[slot-accounting-smoke] 全部检查通过 ✓"
