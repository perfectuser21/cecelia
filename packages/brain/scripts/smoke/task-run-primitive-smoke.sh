#!/usr/bin/env bash
# Smoke: task-run-primitive — run 原语「一次执行 = 一行 task_runs」（任务 66db3dfb，链 bf5088a3 棒1）
# 验证：
#   1. lib/task-run.js 导出全部入口，纯逻辑行为正确（状态归一 / source 必填 / 裸跑集合差）
#   2. 单一写口：src 与 scripts 里除 lib/task-run.js 外零 INSERT/UPDATE/DELETE task_runs
#   3. 五条执行路径接线：executor 漏斗 / dispatcher 兜底 / openclaw-agent / execution-callback / kernel 终态
#   3b. 出口接线：脚本步 run 起止 / pushTaskRuns 投影 / 日报+晨报裸跑 AMBER
#   4. 迁移 468 additive（Notion 记账列 + 投影注册表占位行）
#   5. （可选）TASK_RUN_SMOKE_DB_URL 指向已跑完迁移的库：startRun 幂等 / finishRun 补终态 / 已终态不覆盖 / 记账列存在
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[task-run-primitive-smoke] 1. 原语导出 + 纯逻辑"
node --input-type=module -e "
import * as T from './src/lib/task-run.js';
for (const n of ['startRun','finishRun','findBareRuns','recordRunFromCallback','startRunForExecResult','normalizeRunStatus','buildRunContext','buildRunResult','detectBareRuns']) {
  if (typeof T[n] !== 'function') { console.error('FAIL 缺少导出 ' + n); process.exit(1); }
}
if (T.normalizeRunStatus('completed') !== 'success' || T.normalizeRunStatus('quota_exhausted') !== 'failed') { console.error('FAIL 状态归一'); process.exit(1); }
let threw = false; try { T.buildRunContext({}); } catch { threw = true; }
if (!threw) { console.error('FAIL buildRunContext 缺 source 未抛'); process.exit(1); }
if (JSON.stringify(T.detectBareRuns(['a','b','a'], ['b'])) !== '[\"a\"]') { console.error('FAIL detectBareRuns'); process.exit(1); }
console.log('原语导出与纯逻辑 ✓');
"

echo "[task-run-primitive-smoke] 2. 单一写口（除 lib/task-run.js 外零直写 task_runs）"
BAD=$(grep -rlE "(INSERT[[:space:]]+INTO|UPDATE|DELETE[[:space:]]+FROM)[[:space:]]+task_runs([^A-Za-z0-9_]|$)" src scripts --include=*.js --include=*.cjs --include=*.mjs --include=*.sh 2>/dev/null \
  | grep -v "^src/lib/task-run.js$" | grep -v "task-run-primitive-smoke.sh" | grep -v "__tests__" || true)
[ -z "$BAD" ] || { echo "FAIL 绕过唯一写口: $BAD"; exit 1; }
echo "单一写口 ✓"

echo "[task-run-primitive-smoke] 3. 执行路径接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/executor.js', ['_triggerCeceliaRunInner', 'startRunForExecResult({ task, execResult, source })']],
  ['src/dispatcher.js', [\"startRunForExecResult({ task: nextTask, execResult, source: 'dispatcher' })\", 'recordDispatchResult(pool, true, null, undefined, nextTask.id)']],
  ['src/openclaw-agent-executor.js', [\"source: 'openclaw-agent'\", 'await finishRun(']],
  ['src/routes/execution.js', ['await recordRunFromCallback(']],
  ['src/orchestrator/kernel-run-store.js', ['await finishRun({']],
  ['scripts/cecelia-run.sh', ['run_id: \$run_id', 'exit_code: \$exit_code_val']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('五条执行路径接线 ✓');
"

echo "[task-run-primitive-smoke] 3b. 出口接线：脚本步 run / Notion 投影 / 日报与晨报裸跑 AMBER"
node -e "
const fs = require('fs');
const checks = [
  ['src/notion-push-sync.js', [\"source: 'ssh-workflow'\", \"source: 'openclaw-webhook'\", 'async function pushTaskRuns(pool, token)', 'await pushTaskRunsSafe(pool, token)', 'export function buildTaskRunNotionProperties']],
  ['src/daily-report-generator.js', ['export function renderBareRunSection', 'findBareRuns(dbPool', \"from './lib/task-run.js'\"]],
  ['src/morning-cockpit-bark.js', ['findBareRuns(pool', '🟡 AMBER 裸跑执行']],
  ['src/ops-notion-schema.js', ['task_runs: {']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('出口接线 ✓');
"

echo "[task-run-primitive-smoke] 4. 迁移 468 additive"
grep -q "ADD COLUMN IF NOT EXISTS notion_id" migrations/468_task_runs_notion_projection.sql \
  && grep -q "ADD COLUMN IF NOT EXISTS notion_synced_at" migrations/468_task_runs_notion_projection.sql \
  && grep -q "ADD COLUMN IF NOT EXISTS notion_digest" migrations/468_task_runs_notion_projection.sql \
  || { echo "FAIL 468 缺记账列"; exit 1; }
! grep -qiE "DROP COLUMN|ALTER COLUMN|DROP TABLE" migrations/468_task_runs_notion_projection.sql || { echo "FAIL 468 非 additive"; exit 1; }
echo "468 ✓"

if [ -n "${TASK_RUN_SMOKE_DB_URL:-}" ]; then
  echo "[task-run-primitive-smoke] 5. 真库：幂等 / 终态 / 已终态不覆盖"
  N=$(psql "$TASK_RUN_SMOKE_DB_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name='task_runs' AND column_name IN ('notion_id','notion_synced_at','notion_digest')")
  [ "$N" = "3" ] || { echo "FAIL 记账列缺失 count=$N"; exit 1; }
  TASK_RUN_SMOKE_DB_URL="$TASK_RUN_SMOKE_DB_URL" node --input-type=module -e "
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { startRun, finishRun } from './src/lib/task-run.js';
const pool = new pg.Pool({ connectionString: process.env.TASK_RUN_SMOKE_DB_URL });
const tid = randomUUID(); const rid = 'smoke-' + randomUUID();
try {
  await pool.query(\"INSERT INTO tasks (id, title, task_type, status, payload) VALUES (\$1, \$2, 'harness_initiative', 'in_progress', '{}'::jsonb)\", [tid, 'task-run smoke ' + tid]);
  await startRun({ taskId: tid, runId: rid, source: 'smoke' }, { pool });
  await startRun({ taskId: tid, runId: rid, source: 'smoke' }, { pool });
  let r = await pool.query('SELECT count(*)::int c FROM task_runs WHERE run_id=\$1', [rid]);
  if (r.rows[0].c !== 1) throw new Error('幂等破坏 count=' + r.rows[0].c);
  await finishRun({ runId: rid, status: 'failed', exitCode: 1 }, { pool });
  await finishRun({ runId: rid, status: 'completed', exitCode: 0 }, { pool });
  r = await pool.query('SELECT status, ended_at FROM task_runs WHERE run_id=\$1', [rid]);
  if (r.rows[0].status !== 'failed' || !r.rows[0].ended_at) throw new Error('终态被覆盖 status=' + r.rows[0].status);
  console.log('真库 startRun 幂等 / finishRun 终态 / 已终态不覆盖 ✓');
} finally {
  // task_runs 随 tasks 行 ON DELETE CASCADE 清掉——smoke 自己也不直写 task_runs。
  await pool.query('DELETE FROM tasks WHERE id=\$1', [tid]).catch(() => {});
  await pool.end();
}
"
else
  echo "[task-run-primitive-smoke] 5. 跳过真库检查（未设 TASK_RUN_SMOKE_DB_URL）"
fi

echo "[task-run-primitive-smoke] ALL PASS"
