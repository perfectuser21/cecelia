#!/usr/bin/env bash
# Smoke: owner-decision-approval — 主理人「只选决策」应答通路 + 到期默认（链 bf5088a3 棒9，任务 8aa79219，决策 105a5868）
# 验证：
#   1. 选项解析纯逻辑：标签/全文匹配、default 缺省、未知 choice 400、歧义不猜、到期时刻取 deadline 与 blocked_until 较晚者
#   2. 接线：actionHandlers 注册 owner_decision；approve 路由透传 choice；二次批准 409；驳回事务化写 payload
#   3. 承诺不被旁路吞掉：unblockExpiredTasks 排除 waiting_on=human；expireStaleProposals 排除 owner_decision 待办
#   4. sweeper 注册进 JOBS（声明活性尺子、排在 scheduler-liveness 之前）且整轮有界（query_timeout/statement_timeout/预算）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[owner-decision-approval-smoke] 1. 选项解析纯逻辑"
node --input-type=module -e "
import { pickOption, resolveChoice, computeDueAt, OwnerDecisionResolveError } from './src/lib/owner-decision-resolve.js';
const d = { question: 'q', options: ['A: 甲', 'B: 乙'], default: 'A', deadline: '2026-09-28 03:19:45.357142+00', reversible: true, waiting_on: 'human' };
const fail = (m) => { console.error('FAIL ' + m); process.exit(1); };
if (resolveChoice(d, 'b').choice !== 'B') fail('标签匹配（大小写不敏感）');
if (resolveChoice(d, 'A: 甲').chosen_option !== 'A: 甲') fail('全文匹配');
if (resolveChoice(d, undefined).choice !== 'A' || resolveChoice(d, 'default').choice !== 'A') fail('缺省/default 取协议 default');
let e; try { resolveChoice(d, 'Z'); } catch (x) { e = x; }
if (!(e instanceof OwnerDecisionResolveError) || e.status !== 400 || e.code !== 'owner_decision_unknown_choice') fail('未知 choice 应 400');
if (pickOption(['A: x', 'A: y'], 'A') !== null) fail('同标签歧义不该猜');
const dl = Date.parse('2026-09-28T00:00:00Z');
if (computeDueAt({ deadline: '2026-09-28T00:00:00Z' }, '2026-09-27T00:00:00Z') !== dl) fail('blocked_until 早于 deadline 不该提前');
if (computeDueAt({ deadline: '2026-09-28T00:00:00Z' }, '2026-09-29T00:00:00Z') !== Date.parse('2026-09-29T00:00:00Z')) fail('顺延后取较晚者');
console.log('选项解析/到期时刻纯逻辑 ✓');
"

echo "[owner-decision-approval-smoke] 2-4. 接线与有界性"
node -e "
const fs = require('fs');
const checks = [
  ['src/decision-executor.js', [
    'async owner_decision(params, context',
    'applyOwnerDecisionResolution(db',
    \"status: 409\",
    'recordOwnerDecisionRejection(client',
    \"AND action_type <> 'owner_decision'\",
  ]],
  ['src/routes/actions.js', ['const { reviewer, choice } = req.body', 'approvePendingAction(id, reviewer || \'api-user\', { choice: choice ?? null })', 'res.status(result.status || 400)']],
  ['src/task-updater.js', ['export async function unblockTask(taskId, { db = pool } = {})', \"NOT (blocked_reason = 'owner_decision' AND blocked_detail->>'waiting_on' = 'human')\"]],
  ['src/lib/owner-decision-resolve.js', ['export async function applyOwnerDecisionResolution', 'unblockTask(taskId, { db })', \"INSERT INTO decisions (category\", \"'decision'\"]],
  ['src/owner-decision-deadline.js', ['query_timeout', 'SET LOCAL statement_timeout', 'SET LOCAL lock_timeout', 'ROUND_BUDGET_MS', 'FOR UPDATE', 'owner_decision_default_', 'RESOLUTION_VIA.DEFAULT_ON_DEADLINE']],
  ['src/scheduler-jobs.js', [\"name: 'owner-decision-deadline'\", 'livenessIntervalSec: 60', 'runOwnerDecisionDeadline(pool)']],
];
let bad = 0;
for (const [f, needles] of checks) {
  const s = fs.readFileSync(f, 'utf8');
  for (const n of needles) if (!s.includes(n)) { console.error('FAIL ' + f + ' 缺少: ' + n); bad++; }
}
const js = fs.readFileSync('src/scheduler-jobs.js', 'utf8');
if (js.indexOf(\"name: 'owner-decision-deadline'\") > js.indexOf(\"name: 'scheduler-liveness'\")) { console.error('FAIL owner-decision-deadline 必须排在 scheduler-liveness 之前'); bad++; }
if (bad) process.exit(1);
console.log('owner_decision 处理器/路由/放行排除/sweeper 注册与有界性接线 ✓');
"

echo "[owner-decision-approval-smoke] PASS"
