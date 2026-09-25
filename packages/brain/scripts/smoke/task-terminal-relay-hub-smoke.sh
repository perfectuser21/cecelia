#!/usr/bin/env bash
# Smoke: task-terminal-relay-hub — 任务终态写入收口到状态机层（任务 384de1e7，链 bf5088a3 棒 2，决策 105a5868 / ec7bf540）
# 起因：09-22 七层审计——接棒只挂 PATCH /tasks；executor / monitor-loop / crystallize / attempt-run 直写
#       UPDATE tasks SET status='completed' 绕过；openclaw 写 completed_no_pr 不被接棒 → 秋米任务 100% 不接棒。
# 验证：
#   1. lib/task-terminal.js 结构：finalizeTask / afterTerminalTransition / 登记表 / hub 常量
#   2. task-status-transitions.js：RELAY_TERMINAL_STATUSES 含 completed_no_pr；relay-baton 认它
#   3. 静态扫描：src 里 hub 之外零字面量终态写入（与守卫测试同口径，独立实现）
#   4. 关键路径接线：PATCH 路由 / 回调 / Kernel run 终态化 / openclaw 收割都经 hub
#   5. 真库：Brain 活着 + relay 用到的 work_routing_receipts / handoff_log 列存在
set -euo pipefail

echo "[task-terminal-relay-hub-smoke] 1. lib/task-terminal.js 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/lib/task-terminal.js', 'utf8');
const must = [
  ['export async function finalizeTask', 'finalizeTask 导出'],
  ['export async function afterTerminalTransition', 'afterTerminalTransition 导出'],
  ['export function buildTerminalUpdate', 'buildTerminalUpdate 导出'],
  ['export const TASK_STATUS_WRITER_REGISTRY', '参数化写入者登记表'],
  [\"TERMINAL_WRITE_HUB_MODULE = 'lib/task-terminal.js'\", 'hub 模块常量'],
  ['claimed_by = NULL', '终态统一清 claim'],
  ['completed_at = COALESCE(completed_at, NOW())', 'completed 类 completed_at 兜底'],
  [\"import('./relay-baton.js')\", '钩子动态接 relay-baton'],
];
const missing = must.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([, d]) => console.error('FAIL 缺少: ' + d)); process.exit(1); }
console.log('task-terminal.js 结构正确 ✓');
"

echo "[task-terminal-relay-hub-smoke] 2. completed_no_pr 可接棒"
node -e "
const fs = require('fs');
const t = fs.readFileSync('packages/brain/src/lib/task-status-transitions.js', 'utf8');
if (!/RELAY_TERMINAL_STATUSES = Object\.freeze\(\['completed', 'completed_no_pr'\]\)/.test(t)) { console.error('FAIL: RELAY_TERMINAL_STATUSES 不含 completed_no_pr'); process.exit(1); }
const r = fs.readFileSync('packages/brain/src/lib/relay-baton.js', 'utf8');
if (!r.includes('RELAY_TERMINAL_STATUSES.includes(task.status)')) { console.error('FAIL: relay-baton 仍只认 completed'); process.exit(1); }
console.log('completed_no_pr 可接棒 ✓');
"

echo "[task-terminal-relay-hub-smoke] 3. 静态扫描：hub 之外零字面量终态写入"
node -e "
const fs = require('fs'); const path = require('path');
const root = 'packages/brain/src';
const bad = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); continue; }
  if (!e.name.endsWith('.js') || /\.(test|spec)\.js$/.test(e.name)) continue;
  const rel = path.relative(root, p); if (rel === 'lib/task-terminal.js') continue;
  const s = fs.readFileSync(p, 'utf8');
  for (const m of s.matchAll(/UPDATE\s+(?:public\.)?tasks\b/g)) {
    const seg = s.slice(m.index, m.index + 1500); const w = seg.search(/\bWHERE\b/);
    const set = w === -1 ? seg : seg.slice(0, w);
    if (/\bstatus\s*=\s*'(?:completed|completed_no_pr|failed|archived)'/.test(set)) { bad.push(rel); break; }
  }
} };
walk(root);
if (bad.length) { console.error('FAIL 直写终态: ' + bad.join(', ')); process.exit(1); }
console.log('hub 之外零字面量终态写入 ✓');
"

echo "[task-terminal-relay-hub-smoke] 4. 关键路径接线"
node -e "
const fs = require('fs');
const checks = [
  ['packages/brain/src/routes/tasks.js', 'afterTerminalTransition(', 'PATCH /api/brain/tasks'],
  ['packages/brain/src/routes/task-task-patch.js', 'afterTerminalTransition(', 'PATCH /:id'],
  ['packages/brain/src/callback-processor.js', 'afterTerminalTransition(', '执行回调（队列）'],
  ['packages/brain/src/routes/execution.js', 'afterTerminalTransition(', '执行回调（HTTP）'],
  ['packages/brain/src/orchestrator/kernel-run-store.js', 'afterTerminalTransition(', 'Kernel run 终态化'],
  ['packages/brain/src/openclaw-agent-executor.js', \"finalizeTask(pool, r.id, 'completed_no_pr'\", 'openclaw 收割 completed_no_pr'],
  ['packages/brain/src/routing/device-delegation.js', \"'completed_no_pr'\", '设备任务对账 completed_no_pr'],
  ['packages/brain/src/monitor-loop.js', 'finalizeTask(', 'monitor-loop 调和'],
  ['packages/brain/src/crystallize-orchestrator.js', 'finalizeTask(', 'crystallize 收尾'],
  ['packages/brain/src/routes/harness-attempt-run.js', 'finalizeTask(', 'attempt-run 锚 task 闭合'],
  ['packages/brain/src/task-updater.js', 'finalizeTask(', 'task-updater 终态委托'],
];
const missing = checks.filter(([f, p]) => !fs.readFileSync(f, 'utf8').includes(p));
if (missing.length) { missing.forEach(([f, , d]) => console.error('FAIL 未接线: ' + d + ' (' + f + ')')); process.exit(1); }
console.log('关键路径 ' + checks.length + ' 处全部经 hub ✓');
"

echo "[task-terminal-relay-hub-smoke] 5. 真库列 + Brain 活着"
DB_URL="${DATABASE_URL:-postgresql://${DB_USER:-cecelia}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-cecelia_test}}"
COLS=$(psql "$DB_URL" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name='tasks' AND column_name IN ('parent_task_id','sequence_no','result','claimed_by','completed_at')")
if [ "$COLS" != "5" ]; then echo "FAIL: tasks 接棒相关列不齐（$COLS/5）"; exit 1; fi
RECEIPTS=$(psql "$DB_URL" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_name='work_routing_receipts'")
if [ "$RECEIPTS" != "1" ]; then echo "FAIL: work_routing_receipts 表不存在（接棒子任务幂等依赖它）"; exit 1; fi
echo "tasks 接棒列 5/5 + work_routing_receipts ✓"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if ! curl -sf --max-time 10 "$BRAIN_URL/api/brain/health" | grep -q '"status"'; then echo "FAIL: Brain 健康端点不可达 $BRAIN_URL"; exit 1; fi
echo "Brain 健康 ✓"

echo "[task-terminal-relay-hub-smoke] ✅ 全部通过"
