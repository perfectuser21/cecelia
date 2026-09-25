#!/usr/bin/env bash
# Smoke: task-governance-guards — 决策分档机械守卫 + 依赖单一写口（链 bf5088a3 棒5，任务 3fad28e0，决策 105a5868）
# 验证：
#   1. 守卫 1 纯逻辑：非 uuid goal_id 被拒（goal_id_not_key_result），不给 goal_id 直通
#   2. 守卫 2 纯逻辑：owner_decision 缺协议被拒并列全缺项；完整协议放行；machine 不进待办、human 进待办
#   3. 迁移 469：触发器 WHEN 只对 owner_decision、只拦新写入、抛 23514；回滚脚本在
#   4. 接线：建单入口 / createRoutedTask / blockTask / unblockTask / harness-dag / proposal 全部走守卫与单一写口
#   5. 单一写口：src 内仅 lib/task-dependencies.js（与 gap-dependencies 白名单）含边 INSERT
#   6. （可选）GOV_GUARD_SMOKE_DB_URL 指向已跑完迁移的库：触发器存在且 proven-to-fire（事务内违规插入被拒并回滚）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[task-governance-guards-smoke] 1-2. 守卫纯逻辑"
node --input-type=module -e "
import { assertGoalIsKeyResult, GoalGuardError } from './src/lib/goal-guard.js';
import { validateOwnerDecisionDetail, assertOwnerDecisionProtocol, openOwnerDecisionPendingAction } from './src/lib/owner-decision.js';
const r = await assertGoalIsKeyResult({ query: async () => { throw new Error('不该查库'); } }, null);
if (r.warning !== null) { console.error('FAIL 不给 goal_id 应直通'); process.exit(1); }
let e1 = await assertGoalIsKeyResult({ query: async () => ({ rows: [] }) }, 'not-a-uuid').catch((e) => e);
if (!(e1 instanceof GoalGuardError) || e1.code !== 'goal_id_not_key_result') { console.error('FAIL 非 uuid goal_id 未被拒'); process.exit(1); }
const bad = validateOwnerDecisionDetail({ question: 'q' });
if (bad.ok || bad.violations.length !== 5) { console.error('FAIL 缺协议未列全缺项: ' + JSON.stringify(bad)); process.exit(1); }
let threw = false; try { assertOwnerDecisionProtocol({ reason: 'owner_decision', detail: null }); } catch (e) { threw = e.code === 'owner_decision_protocol_violation'; }
if (!threw) { console.error('FAIL owner_decision 无协议未被拒'); process.exit(1); }
assertOwnerDecisionProtocol({ reason: 'billing_cap', detail: null });
const good = { question: 'q', options: ['A', 'B'], default: 'B', deadline: '2099-01-01T00:00:00Z', reversible: true, waiting_on: 'machine' };
if (!validateOwnerDecisionDetail(good).ok) { console.error('FAIL 完整协议被拒'); process.exit(1); }
const m = await openOwnerDecisionPendingAction({ query: async () => { throw new Error('machine 不该写库'); } }, { taskId: 't', title: 't', detail: good });
if (m.created !== false || m.skipped !== 'machine') { console.error('FAIL machine 进了主理人待办'); process.exit(1); }
console.log('守卫 1/2 纯逻辑：违规被拒、合法放行、machine 不进待办 ✓');
"

echo "[task-governance-guards-smoke] 3. 迁移 469 结构"
node -e "
const fs = require('fs');
const up = fs.readFileSync('migrations/469_tasks_owner_decision_guard.sql', 'utf8');
const must = [
  \"WHEN (NEW.blocked_reason = 'owner_decision')\",
  'BEFORE INSERT OR UPDATE ON tasks',
  'OLD.blocked_reason IS NOT DISTINCT FROM NEW.blocked_reason',
  'OLD.blocked_detail IS NOT DISTINCT FROM NEW.blocked_detail',
  \"ERRCODE = '23514'\",
];
const missing = must.filter((p) => !up.includes(p));
if (missing.length) { missing.forEach((p) => console.error('FAIL 469 缺少: ' + p)); process.exit(1); }
if (!fs.existsSync('migrations/rollback/469_tasks_owner_decision_guard.down.sql')) { console.error('FAIL 缺回滚脚本'); process.exit(1); }
console.log('469 触发器结构正确（只 owner_decision / 只拦新写入 / 23514 / 有回滚）✓');
"

echo "[task-governance-guards-smoke] 4. 入口与写口接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/routes/task-tasks.js', ['assertGoalIsKeyResult(pool, goal_id)', 'assertOwnerDecisionProtocol(', 'normalizeDependsOn(', 'registerTaskDependencyRoutes(']],
  ['src/work-routing-store.js', ['assertGoalIsKeyResult(client', 'assertOwnerDecisionProtocol(', 'openOwnerDecisionPendingAction(', 'addTaskDependencies(client']],
  ['src/task-updater.js', ['assertOwnerDecisionProtocol({ reason, detail })', 'closeOwnerDecisionPendingAction(']],
  ['src/routes/tasks.js', [\"result.code === 'owner_decision_protocol_violation'\"]],
  ['src/harness-dag.js', ['insertEdgeRow(client, from, to']],
  ['src/proposal.js', ['addTaskDependency(pool', 'removeTaskDependency(pool']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('建单入口 / createRoutedTask / blockTask / harness-dag / proposal 全部接线 ✓');
"

echo "[task-governance-guards-smoke] 5. 单一写口：边 INSERT 只在写口模块"
node -e "
const fs = require('fs'); const path = require('path');
const allow = new Set(['lib/task-dependencies.js', 'impact-contract/gap-dependencies.js']);
const bad = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (n === '__tests__' || n === 'node_modules') continue;
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.js') && /INSERT\s+INTO\s+task_dependencies/i.test(fs.readFileSync(p, 'utf8')) && !allow.has(path.relative('src', p))) bad.push(p);
  }
})('src');
if (bad.length) { console.error('FAIL 绕过写口直写边: ' + bad.join(', ')); process.exit(1); }
console.log('src 内无人绕过 lib/task-dependencies.js 直写 task_dependencies ✓');
"

if [ -n "${GOV_GUARD_SMOKE_DB_URL:-}" ]; then
  echo "[task-governance-guards-smoke] 6. 真库：触发器存在且 proven-to-fire"
  psql "$GOV_GUARD_SMOKE_DB_URL" -Atc "SELECT 1 FROM pg_trigger WHERE tgrelid='tasks'::regclass AND tgname='trg_tasks_owner_decision_protocol'" | grep -q 1 || { echo "FAIL 触发器不存在"; exit 1; }
  OUT=$(psql "$GOV_GUARD_SMOKE_DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason) VALUES ('gov-guard-smoke', 'research', 'blocked', 'P2', NOW(), 'owner_decision'); ROLLBACK;" 2>&1 || true)
  echo "$OUT" | grep -q "owner_decision_protocol_violation" || { echo "FAIL 违规插入未被触发器拒绝: $OUT"; exit 1; }
  echo "真库触发器违规插入被拒 ✓"
else
  echo "[task-governance-guards-smoke] 6. 跳过真库检查（未设 GOV_GUARD_SMOKE_DB_URL）"
fi

echo "[task-governance-guards-smoke] ALL PASS"
