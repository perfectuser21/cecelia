#!/usr/bin/env bash
# Smoke: publish-success-daily — migration 276 + writeStats 每日快照写入
# 验证：publish_success_daily 表结构正确，writeStats 含 upsert 逻辑，
#       migration SQL 含 UNIQUE 约束 (platform, date)
set -euo pipefail

echo "[publish-success-daily-smoke] 1. 验证 migration 276 SQL 文件存在"
node -e "
const fs = require('fs');
const path = 'packages/brain/migrations/276_publish_success_daily.sql';
if (!fs.existsSync(path)) {
  console.error('FAIL: migration 276 文件不存在:', path);
  process.exit(1);
}
const sql = fs.readFileSync(path, 'utf8');
if (!sql.includes('publish_success_daily')) {
  console.error('FAIL: migration 276 未创建 publish_success_daily 表');
  process.exit(1);
}
if (!sql.includes('UNIQUE') || !sql.includes('platform') || !sql.includes('date')) {
  console.error('FAIL: migration 276 缺少 UNIQUE(platform, date) 约束');
  process.exit(1);
}
console.log('migration 276 存在，含 publish_success_daily + UNIQUE 约束 ✓');
"

echo "[publish-success-daily-smoke] 2. 验证 publish-monitor.js writeStats 含 upsert 逻辑"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/publish-monitor.js', 'utf8');
if (!src.includes('publish_success_daily')) {
  console.error('FAIL: publish-monitor.js 未写入 publish_success_daily');
  process.exit(1);
}
if (!src.includes('ON CONFLICT (platform, date)')) {
  console.error('FAIL: publish-monitor.js 缺少 ON CONFLICT (platform, date) upsert 语句');
  process.exit(1);
}
if (!src.includes('success_rate')) {
  console.error('FAIL: publish-monitor.js 未写入 success_rate 字段');
  process.exit(1);
}
console.log('writeStats 含 publish_success_daily upsert 逻辑 ✓');
"

echo "[publish-success-daily-smoke] 3. 验证 selfcheck.js EXPECTED_SCHEMA_VERSION >= 276"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/selfcheck.js', 'utf8');
const m = src.match(/EXPECTED_SCHEMA_VERSION\s*=\s*'(\d+)'/);
if (!m) { console.error('FAIL: 未找到 EXPECTED_SCHEMA_VERSION'); process.exit(1); }
if (parseInt(m[1]) < 276) { console.error('FAIL: EXPECTED_SCHEMA_VERSION = ' + m[1] + ' 未升至 >= 276'); process.exit(1); }
console.log('EXPECTED_SCHEMA_VERSION = ' + m[1] + ' (>= 276) ✓');
"

echo "[publish-success-daily-smoke] 4. 验证 slot-allocator.js content_publish 在背压白名单"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/slot-allocator.js', 'utf8');
if (!src.includes(\"'content_publish'\")) {
  console.error('FAIL: slot-allocator.js BACKPRESSURE_BYPASS_TASK_TYPES 未含 content_publish');
  process.exit(1);
}
console.log('content_publish 在 BACKPRESSURE_BYPASS_TASK_TYPES ✓');
"

echo "[publish-success-daily-smoke] 全部检查通过 ✓"
