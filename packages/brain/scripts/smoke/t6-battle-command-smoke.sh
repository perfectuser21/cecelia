#!/usr/bin/env bash
# Smoke: T6 指挥台配套（88e0b448；军师节 v1→v2 后第 1 项随 golden-path-mode GP6 更新）
# 验证：
#   1. battle-report.js 含军师决策节 v2（v1 notes 明细已被五段取代，深度断言见 battle-report-v2-smoke.sh）
#   2. journeys.js 含 GET /issues 列表路由（status=open 特判）
#   3. task-tasks.js 已放开 claude+headed（无拒绝分支）
#   4. harness-skill-relay.js headed 分支泛化（HEADED_HOSTS 映射 + claude-launch.sh）
#   5. harness-relay-watchdog.js 识别两个 headed host
set -euo pipefail

echo "[t6-battle-command-smoke] 1. battle-report.js 军师决策节 v2"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/battle-report.js', 'utf8');
const checks = [
  ['## 军师决策节 v2', 'v2 渲染节标题'],
  ['goldenPathMode', 'v2 数据字段'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('FAIL: 缺少 ' + d)); process.exit(1); }
if (src.includes('strategistDecisions')) { console.error('FAIL: v1 notes 明细残留'); process.exit(1); }
console.log('battle-report.js 军师决策节 v2 ✓');
"

echo "[t6-battle-command-smoke] 2. journeys.js GET /issues"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/journeys.js', 'utf8');
const checks = [
  [\"router.get('/issues'\", 'GET /issues 路由'],
  ['LOWER(status) NOT IN', 'status=open 未关闭特判'],
  ['ORDER BY priority ASC, created_at DESC', '排序口径'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('FAIL: 缺少 ' + d)); process.exit(1); }
console.log('journeys.js GET /issues ✓');
"

echo "[t6-battle-command-smoke] 3. task-tasks.js claude+headed 已解锁"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/task-tasks.js', 'utf8');
if (src.includes('不支持 mode=headed')) { console.error('FAIL: claude+headed 拒绝分支仍存在'); process.exit(1); }
if (!src.includes('已解锁')) { console.error('FAIL: B1 解锁注释缺失'); process.exit(1); }
console.log('task-tasks.js claude+headed 白名单已放开 ✓');
"

echo "[t6-battle-command-smoke] 4. harness-skill-relay.js headed 泛化"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-skill-relay.js', 'utf8');
const checks = [
  ['const HEADED_HOSTS', 'HEADED_HOSTS 映射'],
  ['skill-relay-claude-headed', 'claude headed host 值'],
  ['claude-relay-', 'claude tmux 前缀'],
  ['claude-launch.sh', 'claude 分支 launcher'],
  ['export { HEADED_HOSTS, HEADED_TMUX_PREFIXES }', '映射导出供 watchdog'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([,d]) => console.error('FAIL: 缺少 ' + d)); process.exit(1); }
console.log('harness-skill-relay.js headed 泛化 ✓');
"

echo "[t6-battle-command-smoke] 5. harness-relay-watchdog.js 双 host 识别"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-relay-watchdog.js', 'utf8');
if (!src.includes('HEADED_HOST_VALUES')) {
  console.error('FAIL: 缺少 host 值集合');
  process.exit(1);
}
const dualHostSql = /orchestrator_host\\s+IN\\s*\\(\\s*'skill-relay-codex-headed'\\s*,\\s*'skill-relay-claude-headed'\\s*\\)/;
if (!dualHostSql.test(src)) {
  console.error('FAIL: 缺少 SQL 双 host 收窗条件');
  process.exit(1);
}
console.log('harness-relay-watchdog.js 双 host 识别 ✓');
"

echo "[t6-battle-command-smoke] ✅ 全部通过"
