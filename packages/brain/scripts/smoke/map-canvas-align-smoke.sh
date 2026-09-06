#!/usr/bin/env bash
# Smoke: map↔画布对齐（Crystal 件7）
# 验证：
#   1. abilities.js 含画布生成器端点（golden_path/canvas）且 stage 显式携带 step_id
#   2. abilities.js 含 run 终态回写端点（run-result）：封闭词表 + 幂等 ON CONFLICT + 单级推进谓词
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

echo "[map-canvas-smoke] 2. run 终态回写端点结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/abilities.js', 'utf8');
const checks = [
  [\"'/golden_path/:id/run-result'\", '回写路由 POST /golden_path/:id/run-result'],
  [\"['completed', 'failed']\", 'verdict 封闭词表'],
  ['ON CONFLICT (golden_path_id, run_id) DO NOTHING', '幂等回执'],
  [\"WHERE id=\$1 AND status='planned'\", '成熟度单级推进谓词（禁跳级/防并发覆盖）'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('FAIL: ' + d)); process.exit(1); }
console.log('回写端点结构正确 ✓');
"

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
