#!/usr/bin/env bash
# Smoke: acceptance-d3-backtoback — D3 背靠背服务端裁剪 + 三 token 分权
# task_id: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
#
# 验证：
#   1. loadChecks / loadRunsWithChecks 不对 acceptance_checks 使用 SELECT *
#   2. GET /runs/:run_key 含 view 参数处理逻辑（view=review + human_complete 校验）
#   3. createBearerAuth 空 token 容错（不 throw，返回 null）
#   4. createAcceptancePublicRouter 不注册 POST /acceptance/results（路由已休眠）
#   5. submitAcceptanceResults 函数体保留（不删码）
#   6. 三 token 分权结构（ACCEPTANCE_AI_TOKEN / ACCEPTANCE_GATE_TOKEN / ACCEPTANCE_API_TOKEN）
set -euo pipefail

ACCEPTANCE_JS="packages/brain/src/routes/acceptance.js"
PUBLIC_SERVER_JS="packages/brain/src/acceptance-public-server.js"

echo "[d3-backtoback-smoke] 1. acceptance_checks 查询不使用 SELECT *（列白名单）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
// acceptance_checks 查询不应用 SELECT *（runs 表可以用 SELECT *，checks 表不行）
if (/SELECT\s+\*\s+FROM\s+acceptance_checks/i.test(src)) {
  console.error('FAIL: 仍有 SELECT * FROM acceptance_checks，违反 [SQL列白名单默认隐藏] 铁律');
  process.exit(1);
}
// 验证 CHECKS_DEFAULT_COLS 包含 check_key（白名单列存在）
if (!src.includes('CHECKS_DEFAULT_COLS')) {
  console.error('FAIL: 缺少 CHECKS_DEFAULT_COLS 列白名单定义');
  process.exit(1);
}
console.log('acceptance_checks 列白名单 ✓');
"

echo "[d3-backtoback-smoke] 2. stripAiCols 代码层双保险存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('stripAiCols')) {
  console.error('FAIL: 缺 stripAiCols 代码层过滤函数');
  process.exit(1);
}
const aiCols = ['ai_verdict', 'ai_evidence', 'ai_run_at', 'adjudication'];
for (const col of aiCols) {
  if (!src.includes(col)) {
    console.error('FAIL: 缺 AI 四列定义: ' + col);
    process.exit(1);
  }
}
console.log('stripAiCols 双保险 ✓');
"

echo "[d3-backtoback-smoke] 3. GET /runs/:run_key 含 view=review 逻辑"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes(\"view === 'review'\")) {
  console.error('FAIL: GET /runs/:run_key 缺 view=review 处理逻辑');
  process.exit(1);
}
if (!src.includes(\"status !== 'human_complete'\")) {
  console.error('FAIL: GET /runs/:run_key 缺 human_complete 检查');
  process.exit(1);
}
if (!src.includes('.status(403)')) {
  console.error('FAIL: 缺 403 响应');
  process.exit(1);
}
console.log('GET /runs/:run_key view=review 逻辑 ✓');
"

echo "[d3-backtoback-smoke] 4. createBearerAuth 空 token 容错（不 throw，返回 null）"
node -e "
const src = require('fs').readFileSync('${PUBLIC_SERVER_JS}', 'utf8');
// createBearerAuth 内不应再有 throw new Error
if (/createBearerAuth[\s\S]{0,200}throw new Error/m.test(src)) {
  console.error('FAIL: createBearerAuth 仍含 throw（违反 [createBearerAuth容错] 铁律）');
  process.exit(1);
}
if (!src.includes('return null')) {
  console.error('FAIL: createBearerAuth 空 token 路径未 return null');
  process.exit(1);
}
console.log('createBearerAuth 容错 ✓');
"

echo "[d3-backtoback-smoke] 5. POST /acceptance/results 已从公网路由解挂（铁律 [公网端点休眠不删码]）"
node -e "
const src = require('fs').readFileSync('${ACCEPTANCE_JS}', 'utf8');
// 找 createAcceptancePublicRouter 区段：检查没有活跃的 router.post('/acceptance/results'
// 用简单字符串搜索：注释行里有这个字符串是 OK 的，但活跃路由注册应已移除
// 合同 B12 要求路由不注册，但函数体保留
const publicRouterIdx = src.indexOf('export function createAcceptancePublicRouter');
if (publicRouterIdx === -1) { console.error('FAIL: createAcceptancePublicRouter 未找到'); process.exit(1); }
const afterPublic = src.slice(publicRouterIdx);
// 在函数体里不应有非注释的 router.post('/acceptance/results'
const lines = afterPublic.split('\n');
let inBraces = 0;
let foundActive = false;
for (const line of lines) {
  if (line.includes('{')) inBraces++;
  if (line.includes('}')) inBraces--;
  // 只检查函数体内（inBraces > 0），且不是注释行
  const trimmed = line.trim();
  if (inBraces > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') &&
      (trimmed.includes(\"router.post('/acceptance/results'\") || trimmed.includes('router.post(\"/acceptance/results\"'))) {
    foundActive = true;
    break;
  }
  if (inBraces <= 0 && line.trim() === '}' && lines.indexOf(line) > 0) break;
}
if (foundActive) {
  console.error('FAIL: POST /acceptance/results 路由仍活跃（应已休眠）');
  process.exit(1);
}
console.log('POST /acceptance/results 已休眠 ✓');
"

echo "[d3-backtoback-smoke] 6. submitAcceptanceResults 函数体保留（不删码）"
node -e "
const src = require('fs').readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('export async function submitAcceptanceResults')) {
  console.error('FAIL: submitAcceptanceResults 函数体已删除（违反 [公网端点休眠不删码] 铁律）');
  process.exit(1);
}
console.log('submitAcceptanceResults 函数体保留 ✓');
"

echo "[d3-backtoback-smoke] 7. 三 token 分权结构（ACCEPTANCE_AI_TOKEN 等）"
node -e "
const src = require('fs').readFileSync('${PUBLIC_SERVER_JS}', 'utf8');
const tokens = ['ACCEPTANCE_AI_TOKEN', 'ACCEPTANCE_GATE_TOKEN', 'ACCEPTANCE_API_TOKEN'];
for (const t of tokens) {
  if (!src.includes(t)) {
    console.error('FAIL: 公网 server 缺 ' + t + ' 三 token 分权配置');
    process.exit(1);
  }
}
console.log('三 token 分权结构 ✓');
"

echo "[d3-backtoback-smoke] 全部通过 ✅"
