#!/usr/bin/env bash
# kr1-kr2-updater-smoke.sh
# 验证：KR1/KR2 成功率自动回写器结构正确
# 检查：常量定义 + SQL 逻辑 + tick-runner 集成 + migration 278 幂等性
set -euo pipefail

echo "[kr1-kr2-updater-smoke] 1. 验证 kr1-kr2-updater.js 存在且含关键常量"
node -e "
const fs = require('fs');
const path = 'packages/brain/src/kr1-kr2-updater.js';
if (!fs.existsSync(path)) {
  console.error('FAIL: kr1-kr2-updater.js 不存在');
  process.exit(1);
}
const src = fs.readFileSync(path, 'utf8');
if (!src.includes('d86f67df-04c8-47dc-922f-c0e4fd0645bb')) {
  console.error('FAIL: KR1_ID 常量缺失');
  process.exit(1);
}
if (!src.includes('f19118cd')) {
  console.error('FAIL: KR2_IDS 常量缺失');
  process.exit(1);
}
if (!src.includes('SUCCESS_RATE_THRESHOLD')) {
  console.error('FAIL: SUCCESS_RATE_THRESHOLD 阈值常量缺失');
  process.exit(1);
}
if (!src.includes('updatePublishSuccessKRs')) {
  console.error('FAIL: 导出函数 updatePublishSuccessKRs 缺失');
  process.exit(1);
}
console.log('kr1-kr2-updater.js 存在，含 KR1/KR2 UUID + 阈值常量 + 导出函数 ✓');
"

echo "[kr1-kr2-updater-smoke] 2. 验证 kr1-kr2-updater.js 查询 publish_success_daily 并回写 key_results"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/kr1-kr2-updater.js', 'utf8');
if (!src.includes('publish_success_daily')) {
  console.error('FAIL: 未查询 publish_success_daily 表');
  process.exit(1);
}
if (!src.includes('UPDATE key_results')) {
  console.error('FAIL: 未回写 key_results 表');
  process.exit(1);
}
if (!src.includes('current_value') || !src.includes('progress')) {
  console.error('FAIL: 未更新 current_value / progress 字段');
  process.exit(1);
}
console.log('数据流 publish_success_daily → key_results.current_value ✓');
"

echo "[kr1-kr2-updater-smoke] 3. 验证 tick-runner.js 集成 updatePublishSuccessKRs"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/tick-runner.js', 'utf8');
if (!src.includes('kr1-kr2-updater')) {
  console.error('FAIL: tick-runner.js 未导入 kr1-kr2-updater');
  process.exit(1);
}
if (!src.includes('updatePublishSuccessKRs')) {
  console.error('FAIL: tick-runner.js 未调用 updatePublishSuccessKRs');
  process.exit(1);
}
console.log('tick-runner.js 已集成 updatePublishSuccessKRs ✓');
"

echo "[kr1-kr2-updater-smoke] 4. 验证 migration 278 SQL 含幂等 KR verifier 更新"
node -e "
const fs = require('fs');
const path = 'packages/brain/migrations/278_kr1_kr2_success_rate_verifier.sql';
if (!fs.existsSync(path)) {
  console.error('FAIL: migration 278 文件不存在:', path);
  process.exit(1);
}
const sql = fs.readFileSync(path, 'utf8');
if (!sql.includes('publish_success_daily')) {
  console.error('FAIL: migration 278 未引用 publish_success_daily');
  process.exit(1);
}
if (!sql.includes('kr_verifiers')) {
  console.error('FAIL: migration 278 未更新 kr_verifiers');
  process.exit(1);
}
if (!sql.includes('BEGIN') || !sql.includes('COMMIT')) {
  console.error('FAIL: migration 278 缺少事务包裹 (BEGIN/COMMIT)');
  process.exit(1);
}
console.log('migration 278 存在，含 publish_success_daily 查询 + kr_verifiers 更新 + 事务 ✓');
"

echo "[kr1-kr2-updater-smoke] 全部检查通过 ✓"
