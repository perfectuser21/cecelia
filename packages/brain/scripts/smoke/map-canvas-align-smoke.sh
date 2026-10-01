#!/usr/bin/env bash
# Smoke: map↔画布对齐（Crystal 件7）
# 验证：
#   1. abilities.js 含画布生成器端点（golden_path/canvas）且 stage 显式携带 step_id
#   2. 旧 run-result 永久 410，旧回执写入/成熟度推进逻辑已删除（行为回归见 golden-path-observation.test.js）
#   3. migration 434 golden_path_run_receipts 存在且含幂等唯一键
set -euo pipefail

echo "[map-canvas-smoke] 1. 画布生成器端点结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/abilities.js', 'utf8');
const checks = [
  [\"'/golden_path/canvas'\", '生成器路由 GET /golden_path/canvas'],
  ['step_id: row.id', 'stage 显式携带 step_id（判定点 e66cf847）'],
  ['ORDER BY gp.order_no ASC', 'stages 按 order_no 排序'],
  ['max_attempts', 'V4 黄金格式 max_attempts 字段'],
  ['LEFT JOIN LATERAL', '体检表最近回执 last_run'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('FAIL: ' + d)); process.exit(1); }
console.log('生成器端点结构正确 ✓');
"

echo "[map-canvas-smoke] 2. 旧回执写口退役结构"
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const src = readFileSync('packages/brain/src/routes/abilities.js', 'utf8');
const retired = /router\.post\('\/golden_path\/:id\/run-result',[^\n]*sendGoldenPathRetired\(res, \{ write: true \}\)/.test(src);
if (!retired || src.includes('INSERT INTO golden_path_run_receipts')
    || src.includes("UPDATE journey_features SET status='working'")) {
  console.error('FAIL: 旧回执路由须永久 410 且删除旧写入/成熟度推进代码');
  process.exit(1);
}
console.log('旧回执写口永久退役结构正确 ✓');
JS

echo "[map-canvas-smoke] 3. migration 434 幂等唯一键"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/migrations/434_golden_path_run_receipts.sql', 'utf8');
const checks = [
  ['golden_path_run_receipts', '回执表'],
  ['UNIQUE (golden_path_id, run_id)', '幂等唯一键'],
  [\"CHECK (verdict IN ('completed', 'failed'))\", 'verdict 封闭词表约束'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('FAIL: ' + d)); process.exit(1); }
console.log('migration 434 结构正确 ✓');
"

echo "[map-canvas-smoke] 全部检查通过 ✓"
