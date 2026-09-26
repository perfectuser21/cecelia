#!/usr/bin/env bash
# Smoke: org-units — company/department/leader/members 自动升格骨架（链 bf5088a3 棒6，任务 80e9f816，决策 de1e9ba9）
# 验证：
#   1. evaluateAreaForPromotion 纯逻辑：数据不足/连续 3 天无证据判不合格；7 天全绿判合格；只看最近 7 天窗口
#   2. 迁移 473 结构：两张表 + CHECK 约束 + 幂等种子行 + schema_version 登记 + 回滚脚本存在
#   3. 接线：server.js 挂载 org-units 路由；路由文件导出 GET /org-units
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[org-units-smoke] 1. evaluateAreaForPromotion 纯逻辑"
node --input-type=module -e "
import { evaluateAreaForPromotion, SURVIVAL_TRIAL_DAYS, SURVIVAL_MAX_GAP_DAYS } from './src/lib/org-unit-promotion.js';
function days(pattern) {
  const start = new Date('2026-09-01');
  return pattern.split('').map((c, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), hasEvidence: c === '1' };
  });
}
if (SURVIVAL_TRIAL_DAYS !== 7 || SURVIVAL_MAX_GAP_DAYS !== 3) { console.error('FAIL 常量与决策 de1e9ba9 不符'); process.exit(1); }
if (evaluateAreaForPromotion(null, { recentDays: days('1111111') }).eligible !== false) { console.error('FAIL areaId 缺失应不合格'); process.exit(1); }
if (evaluateAreaForPromotion('a1', { recentDays: days('111') }).eligible !== false) { console.error('FAIL 数据不足 7 天应不合格'); process.exit(1); }
if (evaluateAreaForPromotion('a1', { recentDays: days('1111111') }).eligible !== true) { console.error('FAIL 7 天全绿应合格'); process.exit(1); }
if (evaluateAreaForPromotion('a1', { recentDays: days('1110001') }).eligible !== false) { console.error('FAIL 连续 3 天无证据应不合格'); process.exit(1); }
if (evaluateAreaForPromotion('a1', { recentDays: days('0001111111') }).eligible !== true) { console.error('FAIL 只看最近 7 天窗口失败'); process.exit(1); }
console.log('存活法则判定（7天试用/3天降级阈值/滑动窗口）✓');
"

echo "[org-units-smoke] 2. 迁移 473 结构"
node -e "
const fs = require('fs');
const up = fs.readFileSync('migrations/473_org_units.sql', 'utf8');
const must = [
  'CREATE TABLE IF NOT EXISTS org_units',
  'CREATE TABLE IF NOT EXISTS org_unit_members',
  \"CHECK (unit_type IN ('company', 'department'))\",
  \"CHECK (status IN ('active', 'incubating', 'demoted'))\",
  \"CHECK (member_type IN ('agent', 'human'))\",
  'WHERE NOT EXISTS (SELECT 1 FROM org_units WHERE unit_type = \'company\')',
  \"'473'\",
];
for (const m of must) if (!up.includes(m)) { console.error('FAIL 迁移 473 缺少: ' + m); process.exit(1); }
if (!fs.existsSync('migrations/rollback/473_org_units.down.sql')) { console.error('FAIL 缺回滚脚本'); process.exit(1); }
console.log('迁移 473 两表 + CHECK 约束 + 幂等种子 + 回滚脚本 ✓');
"

echo "[org-units-smoke] 3. 接线：server.js 挂载 + 路由文件"
node -e "
const fs = require('fs');
const server = fs.readFileSync('server.js', 'utf8');
if (!server.includes(\"import orgUnitsRouter from './src/routes/org-units.js'\")) { console.error('FAIL server.js 未 import org-units 路由'); process.exit(1); }
if (!server.includes(\"app.use('/api/brain', orgUnitsRouter)\")) { console.error('FAIL server.js 未挂载 org-units 路由'); process.exit(1); }
const route = fs.readFileSync('src/routes/org-units.js', 'utf8');
if (!route.includes(\"router.get('/org-units'\")) { console.error('FAIL 路由文件缺 GET /org-units'); process.exit(1); }
console.log('server.js 挂载 + 路由定义 ✓');
"

echo "[org-units-smoke] ALL PASS"
