#!/usr/bin/env bash
# Smoke: 九要素 T3 — 注入扩容 + line_ledger 蒸馏接线 + context-manifest 端点
# 验证：
#   1. harness-line-context.js 扩容常量 + ledger 段常量/查询存在
#   2. line-dreaming.js buildLineDreamData 支持 since（COALESCE 回落）
#   3. routes/warroom.js 注册 GET /line/:id/context-manifest 且组装七键
set -euo pipefail

echo "[t3-context-manifest-smoke] 1. harness-line-context 扩容 + ledger 段"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-line-context.js', 'utf8');
const checks = [
  ['PROMPT_MAX_LEN = 12000', '总长上限 12000'],
  ['MAX_FR_ABILITIES = 50', 'FR 上限 50'],
  ['MAX_LEDGER_LEN = 4000', 'ledger 段截断 4000'],
  ['export const LINE_LEDGER_SECTION_HEADER', 'ledger 段头导出'],
  [\"type='line_ledger'\", 'ledger 查询 design_docs'],
  ['ledger', '返回值含 ledger'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: harness-line-context.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('harness-line-context.js 结构正确 ✓');
"

echo "[t3-context-manifest-smoke] 2. line-dreaming buildLineDreamData since 参数"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/line-dreaming.js', 'utf8');
const checks = [
  ['{ since = null } = {}', 'since 可选参数默认 null'],
  [\"COALESCE(\$2::timestamptz, NOW() - INTERVAL '24 hours')\", 'COALESCE 回落 24h'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: line-dreaming.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
const n = (src.match(/COALESCE\(\\\$2::timestamptz/g) || []).length;
if (n !== 6) { console.error('FAIL: COALESCE 段数=' + n + '，应为 6'); process.exit(1); }
console.log('line-dreaming.js since 参数六段齐全 ✓');
"

echo "[t3-context-manifest-smoke] 3. warroom context-manifest 端点"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/warroom.js', 'utf8');
const checks = [
  [\"router.get('/line/:id/context-manifest'\", '端点注册'],
  ['fetchLineContext', '复用 fetchLineContext'],
  ['buildLineDreamData', '复用 buildLineDreamData'],
  ['formatLineContextForPrompt', 'prompt_block 直出'],
  ['advancement_items', 'delta snake_case 映射'],
  ['strategist_notes', 'delta snake_case 映射'],
  ['cumulative_fr', '累积 FR 键'],
  [\"'journey not found'\", '404 分支'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: routes/warroom.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('routes/warroom.js 端点结构正确 ✓');
"

echo "[t3-context-manifest-smoke] ✅ 全部通过"
