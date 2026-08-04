#!/usr/bin/env bash
# Smoke: doc-zombie-retire — 刀0.5 僵尸文档清尸（Brain 注释更新验证）
# 验证：
#   1. seven-ring-audit.js 注释不再引用退役的 write-current-state.sh
#   2. quality.js 注释不再引用退役的 write-current-state.sh
#   3. 两处注释均已更新为说明现行数据源（CI test-pyramid-guard job）
set -euo pipefail

echo "[doc-zombie-retire-smoke] 1. seven-ring-audit.js 不含退役脚本引用"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/seven-ring-audit.js', 'utf8');
if (src.includes('write-current-state.sh')) {
  console.error('FAIL: seven-ring-audit.js 仍含 write-current-state.sh 引用');
  process.exit(1);
}
if (!src.includes('2026-08')) {
  console.error('FAIL: seven-ring-audit.js 未含退役说明时间标记');
  process.exit(1);
}
console.log('seven-ring-audit.js 注释已更新 ✓');
"

echo "[doc-zombie-retire-smoke] 2. quality.js 不含退役脚本引用"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/quality.js', 'utf8');
if (src.includes('write-current-state.sh')) {
  console.error('FAIL: quality.js 仍含 write-current-state.sh 引用');
  process.exit(1);
}
if (!src.includes('2026-08')) {
  console.error('FAIL: quality.js 未含退役说明时间标记');
  process.exit(1);
}
console.log('quality.js 注释已更新 ✓');
"

echo "[doc-zombie-retire-smoke] 3. 退役文件不在原路径"
node -e "
const fs = require('fs');
const retired = [
  '.agent-knowledge/skills-index.md',
  '.agent-knowledge/CURRENT_STATE.md',
  'scripts/write-current-state.sh',
];
const missing = retired.filter(f => fs.existsSync(f));
if (missing.length > 0) {
  console.error('FAIL: 以下退役文件仍在原路径：');
  missing.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('退役文件已从原路径移除 ✓');
"

echo "[doc-zombie-retire-smoke] ✅ 全部验证通过"
