#!/usr/bin/env bash
# Smoke: dao1e-pipeline-events — 刀1e 新增 Brain pipeline 端点（供 ZJ API 替代跨库直查）
# 验证：
#   1. GET /:id/events 端点已注册在 content-pipeline.js
#   2. HEAD /:id 端点已注册在 content-pipeline.js
#   3. with_last_event 参数已支持（SQL 含 LATERAL JOIN cecelia_events）
#   4. 10 个单元测试覆盖三端点（routes/__tests__/content-pipeline.test.js）
set -euo pipefail

echo "[dao1e-pipeline-events-smoke] 1. GET /:id/events 端点注册正确"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/content-pipeline.js', 'utf8');
const checks = [
  [\"router.get('/:id/events'\", 'GET /:id/events 路由已注册'],
  ['content_pipeline_step', 'events 查询过滤 event_type = content_pipeline_step'],
  ['ORDER BY id', '事件按 id 升序（确保步骤顺序）'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: content-pipeline.js 缺少:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('GET /:id/events 端点正确 ✓');
"

echo "[dao1e-pipeline-events-smoke] 2. HEAD /:id 端点注册正确"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/content-pipeline.js', 'utf8');
const checks = [
  [\"router.head('/:id'\", 'HEAD /:id 路由已注册'],
  [\"task_type = 'content-pipeline'\", 'HEAD 查询 task_type 过滤'],
  ['res.status(result.rows.length > 0 ? 200 : 404)', '200/404 语义正确'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: HEAD /:id 端点结构有误:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('HEAD /:id 端点正确 ✓');
"

echo "[dao1e-pipeline-events-smoke] 3. with_last_event 参数支持 LATERAL JOIN"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/content-pipeline.js', 'utf8');
const checks = [
  ['with_last_event', 'with_last_event 参数读取'],
  ['LATERAL', 'LATERAL JOIN cecelia_events 聚合最后一个事件'],
  ['last_node', 'last_node 字段透传'],
  ['last_error', 'last_error 字段透传'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: with_last_event 支持不完整:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('with_last_event LATERAL JOIN 正确 ✓');
"

echo "[dao1e-pipeline-events-smoke] 4. 单元测试文件覆盖三端点"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/__tests__/content-pipeline.test.js', 'utf8');
const checks = [
  ['GET /api/brain/pipelines/:id/events', '/:id/events 测试 describe 块'],
  ['HEAD /api/brain/pipelines/:id', 'HEAD /:id 测试 describe 块'],
  ['with_last_event=1', 'with_last_event 参数测试'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: content-pipeline.test.js 测试覆盖不足:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('单元测试覆盖完整 ✓');
"

echo "[dao1e-pipeline-events-smoke] ALL PASS"
