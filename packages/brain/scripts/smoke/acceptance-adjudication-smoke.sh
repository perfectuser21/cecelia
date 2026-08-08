#!/usr/bin/env bash
# Smoke: acceptance-adjudication — D4 裁决 API + 聚合分流建任务
# 验证（静态代码检查，无需真实 DB）：
#   1. acceptance.js 含 adjudicate 端点路由注册
#   2. acceptance.js 含 adjudicate-run 端点路由注册
#   3. abandon 端点含前态守卫（adjudicated/stale → 409）
#   4. SAVEPOINT 保护存在（23505 不毒化外层事务）
#   5. FR-2 unverifiable_this_version 例外逻辑存在
set -euo pipefail

ACCEPTANCE_JS="packages/brain/src/routes/acceptance.js"

echo "[acceptance-adjudication-smoke] 1. adjudicate 格裁决端点已注册"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('/runs/:run_key/checks/:check_key/adjudicate')) {
  console.error('FAIL: 缺 adjudicate 格端点注册'); process.exit(1);
}
console.log('adjudicate 格端点 ✓');
"

echo "[acceptance-adjudication-smoke] 2. adjudicate-run 定案端点已注册"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('/runs/:run_key/adjudicate-run')) {
  console.error('FAIL: 缺 adjudicate-run 端点注册'); process.exit(1);
}
console.log('adjudicate-run 端点 ✓');
"

echo "[acceptance-adjudication-smoke] 3. abandon 前态守卫（adjudicated/stale → 409）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('cannot_abandon')) {
  console.error('FAIL: abandon 端点缺 cannot_abandon 守卫'); process.exit(1);
}
if (!src.includes('current_status')) {
  console.error('FAIL: abandon 端点缺 current_status 响应字段'); process.exit(1);
}
console.log('abandon 前态守卫 ✓');
"

echo "[acceptance-adjudication-smoke] 4. SAVEPOINT 保护存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('SAVEPOINT') || !src.includes('ROLLBACK TO SAVEPOINT')) {
  console.error('FAIL: 缺 SAVEPOINT 保护（23505 外层事务保护）'); process.exit(1);
}
console.log('SAVEPOINT 保护 ✓');
"

echo "[acceptance-adjudication-smoke] 5. unverifiable_this_version 例外逻辑存在"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
if (!src.includes('unverifiable_this_version')) {
  console.error('FAIL: 缺 unverifiable_this_version 例外逻辑'); process.exit(1);
}
if (!src.includes('unverifiable_adjudicated')) {
  console.error('FAIL: 缺 unverifiable_adjudicated 注记字段'); process.exit(1);
}
console.log('unverifiable_this_version 例外 ✓');
"

echo "[acceptance-adjudication-smoke] 6. verdict 四字段（verdict/by/reason/at）写入"
node -e "
const fs = require('fs');
const src = fs.readFileSync('${ACCEPTANCE_JS}', 'utf8');
const fields = ['verdict', 'by', 'reason', 'at'];
const missing = fields.filter((f) => !src.includes(f + ':'));
if (missing.length) {
  console.error('FAIL: adjudication 缺字段: ' + missing.join(', ')); process.exit(1);
}
console.log('adjudication 四字段 ✓');
"

echo "[acceptance-adjudication-smoke] 全部通过 ✅"
