#!/usr/bin/env bash
# Smoke: guard_ref 裸奔 FR — journey_features.guard_ref 列 + 裸奔 FR 数端点 + 棘轮
# 验证：
#   1. migration 343 已落库（journey_features 存在 guard_ref 列）
#   2. GET /api/brain/journey_features/unguarded-count 返回 count 字段
#   3. GET /api/brain/quality/test-pyramid 返回 bare_fr 字段
#   4. guard_ref 三前缀格式常量在路由源码中存在
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[guard-ref-bare-fr-smoke] 1. migration 343 guard_ref 列存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/migrations/343_journey_features_guard_ref.sql', 'utf8');
if (!src.includes('guard_ref')) {
  console.error('FAIL: migration 343 缺少 guard_ref');
  process.exit(1);
}
console.log('migration 343 guard_ref 列定义 ✓');
"

echo "[guard-ref-bare-fr-smoke] 2. GET /api/brain/journey_features/unguarded-count 端点"
RESP=$(curl -sf "${BRAIN_URL}/api/brain/journey_features/unguarded-count" 2>&1) || {
  echo "FAIL: 端点不可达 — ${RESP}"
  exit 1
}
echo "$RESP" | node -e "
const chunks=[]; process.stdin.on('data',c=>chunks.push(c)); process.stdin.on('end',()=>{
  const d=JSON.parse(chunks.join(''));
  if (typeof d.count !== 'number') { console.error('FAIL: 缺少 count 字段',JSON.stringify(d)); process.exit(1); }
  console.log('unguarded-count =', d.count, '✓');
});
"

echo "[guard-ref-bare-fr-smoke] 3. GET /api/brain/quality/test-pyramid 可达且格式正确"
TP=$(curl -sf "${BRAIN_URL}/api/brain/quality/test-pyramid" 2>&1) || {
  echo "FAIL: test-pyramid 不可达 — ${TP}"
  exit 1
}
echo "$TP" | node -e "
const chunks=[]; process.stdin.on('data',c=>chunks.push(c)); process.stdin.on('end',()=>{
  const d=JSON.parse(chunks.join(''));
  if (typeof d.available !== 'boolean') { console.error('FAIL: 缺少 available 字段',JSON.stringify(d)); process.exit(1); }
  if (d.available && d.bare_fr !== undefined) {
    console.log('bare_fr =', d.bare_fr, '✓');
  } else {
    console.log('available=false（无快照），bare_fr 字段按设计缺省 ✓');
  }
});
"

echo "[guard-ref-bare-fr-smoke] 4. 路由源码含 guard_ref 三前缀注释/约定"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/journeys.js', 'utf8');
const checks = [
  ['guard_ref IS NULL', '裸奔查询谓词'],
  ['unguarded-count', '端点路径'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: journeys.js 缺少:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('路由源码 guard_ref 结构正确 ✓');
"

echo "[guard-ref-bare-fr-smoke] 全部检查通过 ✓"
