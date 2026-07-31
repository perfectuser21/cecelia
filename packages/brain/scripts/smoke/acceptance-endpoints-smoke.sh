#!/usr/bin/env bash
# Smoke: acceptance-endpoints — Acceptance 刀 1（Notion Worker 验收闭环 Brain 地基）
# 验证：
#   1. src/routes/acceptance.js 导出内网/公网两个工厂 + 枚举常量
#   2. server.js 已接线：内网 router 挂载 + 公网 listener 启动 + gracefulShutdown 收编
#   3. acceptance-public-server.js 安全不变量：fail-closed / timingSafeEqual / 绑 127.0.0.1 / 限流先于 json 解析
#   4. migration 369 存在且含两表 + schema_version 收尾
set -euo pipefail

echo "[acceptance-smoke] 1. routes/acceptance.js 导出齐全"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/acceptance.js', 'utf8');
const wants = ['createAcceptanceInternalRouter', 'createAcceptancePublicRouter', 'ACCEPTANCE_KINDS', 'ACCEPTANCE_RESULTS'];
const missing = wants.filter((w) => !new RegExp('export\\\\s+(function|const)\\\\s+' + w + '\\\\b').test(src));
if (missing.length) { missing.forEach((m) => console.error('缺少导出: ' + m)); process.exit(1); }
console.log('acceptance.js 导出齐全 ✓');
"

echo "[acceptance-smoke] 2. server.js 接线完整"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/server.js', 'utf8');
const checks = [
  [\"app.use('/api/brain/acceptance'\", '内网 router 挂载'],
  ['startAcceptancePublicServer', '公网 listener 启动调用'],
  ['acceptancePublicServer.close', 'gracefulShutdown 收编 5223'],
];
for (const [needle, label] of checks) {
  if (!src.includes(needle)) { console.error('FAIL: server.js 缺 ' + label); process.exit(1); }
}
console.log('server.js 接线完整 ✓');
"

echo "[acceptance-smoke] 3. 公网 listener 安全不变量"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/acceptance-public-server.js', 'utf8');
if (!src.includes('ACCEPTANCE_API_TOKEN')) { console.error('FAIL: 缺 fail-closed token 检查'); process.exit(1); }
if (!src.includes('timingSafeEqual')) { console.error('FAIL: 缺 timingSafeEqual'); process.exit(1); }
if (!src.includes(\"'127.0.0.1'\")) { console.error('FAIL: 缺默认绑定 127.0.0.1'); process.exit(1); }
const rateIdx = src.indexOf('rateLimit(');
const jsonIdx = src.indexOf('express.json(');
if (rateIdx === -1 || jsonIdx === -1 || rateIdx > jsonIdx) {
  console.error('FAIL: 限流必须在 express.json 之前（公网 DoS 面，审查 C1）');
  process.exit(1);
}
console.log('公网 listener 安全不变量 ✓');
"

echo "[acceptance-smoke] 4. migration 369 结构"
node -e "
const fs = require('fs');
const sql = fs.readFileSync('packages/brain/migrations/369_acceptance_tables.sql', 'utf8');
for (const needle of ['acceptance_runs', 'acceptance_checks', \"VALUES ('369'\", 'idx_acceptance_runs_status', 'NUMERIC(4,3)']) {
  if (!sql.includes(needle)) { console.error('FAIL: migration 369 缺 ' + needle); process.exit(1); }
}
console.log('migration 369 结构完整 ✓');
"


BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[acceptance-smoke] 5. 内网 pending 端点存在性"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/acceptance/pending")
[ "$STATUS" = "200" ] || { echo "FAIL: pending 端点非200，实得 $STATUS"; exit 1; }
echo "pending 端点 200 ✓"

echo "[acceptance-smoke] 6. 内网历史查询缺 gp_id 应 400"
STATUS2=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/acceptance/runs")
[ "$STATUS2" = "400" ] || { echo "FAIL: runs 缺gp_id应400，实得 $STATUS2"; exit 1; }
echo "runs 缺 gp_id 返回 400 ✓"

echo "[acceptance-smoke] 7. 内网 results 端点空数组应 400"
STATUS3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/acceptance/results" \
  -H "Content-Type: application/json" -d '{"results":[]}')
[ "$STATUS3" = "400" ] || { echo "FAIL: results 空数组应400，实得 $STATUS3"; exit 1; }
echo "results 空数组返回 400 ✓"

echo "[acceptance-smoke] 全部通过 ✅"
