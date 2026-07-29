#!/usr/bin/env bash
# Smoke: acceptance-catalog — GP 目录快照通道（product-map → Brain → Notion Worker）
set -euo pipefail

echo "[acceptance-catalog-smoke] 1. migration 371 结构"
node -e "
const fs = require('fs');
const sql = fs.readFileSync('packages/brain/migrations/371_acceptance_catalog.sql', 'utf8');
for (const needle of ['acceptance_catalog', 'CHECK (id = 1)', \"VALUES ('371'\"]) {
  if (!sql.includes(needle)) { console.error('FAIL: migration 371 缺 ' + needle); process.exit(1); }
}
console.log('migration 371 ✓');
"

echo "[acceptance-catalog-smoke] 2. 端点存在性与安全边界"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
if (!src.includes(\"router.post('/catalog'\")) { console.error('FAIL: 缺内网上载端点'); process.exit(1); }
if (!src.includes(\"'/acceptance/catalog'\")) { console.error('FAIL: 缺公网拉取端点'); process.exit(1); }
// 公网 catalog 端点 500 必须脱敏
const pubIdx = src.indexOf(\"'/acceptance/catalog'\");
const pubSeg = src.slice(pubIdx, pubIdx + 600);
if (!pubSeg.includes('internal_error')) { console.error('FAIL: 公网 catalog 500 未脱敏'); process.exit(1); }
console.log('端点与安全边界 ✓');
"

echo "[acceptance-catalog-smoke] 全部通过 ✅"
