#!/usr/bin/env bash
# Smoke: T6 两轴衔接 — KR metadata 轻边 + ability-progress 对账端点
# 验证：
#   1. okr-hierarchy.js 含 /kr/:id/ability-progress 端点（join journey_features + advancement_items + UUID 分流）
#   2. task-goals.js PATCH 含 metadata COALESCE merge 子句（防 NULL 吞写）
#   3. computeProgress 复用自 advancement-progress.js（非重复实现）
set -euo pipefail

echo "[t6-ability-progress-smoke] 1. okr-hierarchy.js 端点结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/okr-hierarchy.js', 'utf8');
const checks = [
  [\"router.get('/kr/:id/ability-progress'\", 'ability-progress 端点注册'],
  ['target_abilities', '读 metadata.target_abilities'],
  ['journey_features', 'join journey_features'],
  ['advancement_items', 'join advancement_items'],
  [\"kind = 'ability'\", '限定 kind=ability'],
  ['missing_ability_ids', '失联引用暴露'],
  ['UUID_RE', '非法 UUID 分流防 500'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: okr-hierarchy.js 缺少:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('okr-hierarchy.js 端点结构正确 ✓');
"

echo "[t6-ability-progress-smoke] 2. task-goals.js metadata merge 子句"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/task-goals.js', 'utf8');
if (!src.includes(\"COALESCE(metadata, '{}'::jsonb) ||\")) {
  console.error('FAIL: task-goals.js PATCH 缺 metadata COALESCE merge（NULL 列会吞写）');
  process.exit(1);
}
console.log('task-goals.js metadata merge 正确 ✓');
"

echo "[t6-ability-progress-smoke] 3. computeProgress 复用"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/okr-hierarchy.js', 'utf8');
if (!src.includes(\"from '../advancement-progress.js'\")) {
  console.error('FAIL: okr-hierarchy.js 未复用 advancement-progress.js 的 computeProgress');
  process.exit(1);
}
console.log('computeProgress 复用正确 ✓');
"

echo "[t6-ability-progress-smoke] ✅ 全部通过"
