#!/usr/bin/env bash
# Smoke: GP1 — golden_paths 底座
# 验证（纯读源码，CI 兼容不连库）：
#   1. migration 334 存在且含 10 态 CHECK + 关键字段
#   2. routes/golden-paths.js 三端点导出 + 非法流转 422 逻辑
#   3. gp-shelf-life.js 双重 delta 检查导出 + 10min 自 gate
#   4. scheduler-jobs.js 注册 gp-shelf-life job
#   5. server.js 挂载 /api/brain/golden-paths 路由
set -euo pipefail

echo "[gp1-golden-paths-api-smoke] 1. migration 334"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/migrations/334_golden_paths.sql', 'utf8');
const tenStates = ['candidate','proposed','converged','approved','in_dev',
                   'delivered','expired','rejected','blocked_gate','superseded'];
const missing = tenStates.filter(s => !src.includes(s));
if (missing.length) { console.error('FAIL: migration 缺状态: ' + missing.join(', ')); process.exit(1); }
const fields = ['veto_deadline','review_after','findings_log','status_reason','auto_release','judgment_refs'];
const missingF = fields.filter(f => !src.includes(f));
if (missingF.length) { console.error('FAIL: migration 缺字段: ' + missingF.join(', ')); process.exit(1); }
if (!src.includes('CREATE TABLE golden_paths')) { console.error('FAIL: 无 CREATE TABLE golden_paths'); process.exit(1); }
console.log('migration 334 正确 ✓');
"

echo "[gp1-golden-paths-api-smoke] 2. routes/golden-paths.js"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/golden-paths.js', 'utf8');
const checks = [
  ['router.get', 'GET 列表端点'],
  ['router.post', 'POST 建candidate端点'],
  ['router.patch', 'PATCH 状态机端点'],
  ['422', '非法流转 422'],
  ['illegal transition', '非法流转错误消息'],
  ['ALLOWED_TRANSITIONS', '流转表'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { console.error('FAIL:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
console.log('routes/golden-paths.js 结构正确 ✓');
"

echo "[gp1-golden-paths-api-smoke] 3. gp-shelf-life.js"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/gp-shelf-life.js', 'utf8');
const checks = [
  ['export async function runGpShelfLife', 'runGpShelfLife 导出'],
  [\"status = 'expired'\", 'expired 流转'],
  [\"status = 'approved'\", 'auto-approve 流转'],
  ['auto_release', '报备制字段'],
  ['veto_deadline', '否决窗字段'],
  ['review_after', '保质期字段'],
  ['INTERVAL_MS', '10min 自 gate'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { console.error('FAIL:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
console.log('gp-shelf-life.js 结构正确 ✓');
"

echo "[gp1-golden-paths-api-smoke] 4. scheduler-jobs 注册"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
if (!src.includes(\"name: 'gp-shelf-life'\") || !src.includes('runGpShelfLife')) {
  console.error('FAIL: scheduler-jobs 未注册 gp-shelf-life'); process.exit(1);
}
console.log('scheduler-jobs 注册正确 ✓');
"

echo "[gp1-golden-paths-api-smoke] 5. server.js 路由挂载"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!src.includes(\"'/api/brain/golden-paths'\") || !src.includes('goldenPathsRoutes')) {
  console.error('FAIL: server.js 未挂载 /api/brain/golden-paths'); process.exit(1);
}
console.log('server.js 路由挂载正确 ✓');
"

echo "[gp1-golden-paths-api-smoke] ALL PASS ✓"
