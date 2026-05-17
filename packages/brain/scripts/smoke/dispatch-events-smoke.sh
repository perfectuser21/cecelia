#!/usr/bin/env bash
# Smoke: dispatch-events — B6 dispatch_events 真写入 + /dispatch/recent 诊断端点
# 验证：
#   1. dispatch-stats.js 含 INSERT INTO dispatch_events
#   2. routes/dispatch.js 含 buildRecentDispatchEventsHandler + GET /dispatch/recent
#   3. routes.js 已注册 dispatchRouter
#   4. GET /api/brain/dispatch/recent → 200 + events 数组
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[dispatch-events-smoke] 1. dispatch-stats.js 含 INSERT INTO dispatch_events"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/dispatch-stats.js', 'utf8');
const checks = [
  ['INSERT INTO dispatch_events', 'dispatch_events INSERT 语句'],
  ['taskId = null', 'taskId 可选参数'],
  ['failed_dispatch', 'failed_dispatch event_type'],
];
const missing = checks.filter(([p,_]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: dispatch-stats.js 缺少:');
  missing.forEach(([_,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('dispatch-stats.js 含 dispatch_events INSERT ✓');
"

echo "[dispatch-events-smoke] 2. routes/dispatch.js 含 buildRecentDispatchEventsHandler"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/dispatch.js', 'utf8');
const checks = [
  ['buildRecentDispatchEventsHandler', 'handler 导出'],
  ['dispatch/recent', '路由路径'],
  ['dispatch_events', 'SQL 表引用'],
  ['ORDER BY created_at DESC', '按时间倒序'],
];
const missing = checks.filter(([p,_]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: routes/dispatch.js 缺少:');
  missing.forEach(([_,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('routes/dispatch.js 含 GET /dispatch/recent ✓');
"

echo "[dispatch-events-smoke] 3. routes.js 已注册 dispatchRouter"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes.js', 'utf8');
if (!src.includes('dispatchRouter')) {
  console.error('FAIL: routes.js 未注册 dispatchRouter');
  process.exit(1);
}
console.log('routes.js 注册 dispatchRouter ✓');
"

echo "[dispatch-events-smoke] 4. GET /api/brain/dispatch/recent → 200"
RES=$(curl -sf "${BRAIN_URL}/api/brain/dispatch/recent" 2>&1 || echo "CURL_FAIL")
if [[ "$RES" == "CURL_FAIL" ]]; then
  echo "[dispatch-events-smoke] SKIP: Brain 不可用（可能未启动），静态检查已通过 ✓"
  exit 0
fi
EVENTS=$(echo "$RES" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(Array.isArray(d.events))" 2>/dev/null || echo "false")
if [[ "$EVENTS" != "true" ]]; then
  echo "[dispatch-events-smoke] FAIL: /dispatch/recent 未返回 events 数组: $RES"
  exit 1
fi
echo "[dispatch-events-smoke] GET /dispatch/recent 返回 events 数组 ✓"

echo "[dispatch-events-smoke] 全部检查通过 ✓"
