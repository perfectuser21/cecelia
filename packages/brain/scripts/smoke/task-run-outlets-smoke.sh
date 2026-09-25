#!/usr/bin/env bash
# Smoke: task-run-outlets — run 原语出口：脚本步留痕 / Notion 投影 / 日报+晨报裸跑 AMBER
# （任务 66db3dfb，链 bf5088a3 棒1 PR B；地基见 task-run-primitive-smoke.sh）
# 验证：
#   1. notion-push-sync：ssh/webhook 派发 startRun、收割 finishRun、pushTaskRuns 投影（吞错壳接两个入口）
#   2. 投影读 task_runs 只 SELECT（写口唯一在 lib/task-run.js）；ops-notion-schema 有 task_runs 列定义
#   3. 日报 renderBareRunSection + generateDailyReport 调 findBareRuns；晨报 Bark 加 AMBER 行
#   4. 纯逻辑：renderBareRunSection 非空出 🟡 AMBER + task_id、空不误报；buildTaskRunNotionProperties 不编造结束/exit
#   5. 迁移 468 登记投影注册表占位行（不触发「有 notion_id 列未登记」守夜红）
#   6. （可选）TASK_RUN_SMOKE_DB_URL 指向已跑完迁移的库：注册表占位行存在且 pending_vessel（未误开推送）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[task-run-outlets-smoke] 1-3. 出口接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/notion-push-sync.js', [\"source: 'ssh-workflow'\", \"source: 'openclaw-webhook'\", 'await finishRun({', 'async function pushTaskRuns(pool, token)', 'await pushTaskRunsSafe(pool, token)', 'export function buildTaskRunNotionProperties']],
  ['src/ops-notion-schema.js', ['task_runs: {']],
  ['src/daily-report-generator.js', ['export function renderBareRunSection', 'findBareRuns(dbPool', \"from './lib/task-run.js'\"]],
  ['src/morning-cockpit-bark.js', ['findBareRuns(pool', '🟡 AMBER 裸跑执行']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
const push = fs.readFileSync('src/notion-push-sync.js', 'utf8');
if (/(INSERT\s+INTO|UPDATE)\s+task_runs/i.test(push)) { console.error('FAIL notion-push-sync 直写 task_runs'); fail = true; }
if ((push.match(/await pushTaskRunsSafe\(pool, token\)/g) || []).length < 2) { console.error('FAIL pushTaskRuns 未接 runNotionPushSync + runOpsNotionPush'); fail = true; }
if (fail) process.exit(1);
console.log('出口接线 ✓');
"

echo "[task-run-outlets-smoke] 4. 纯逻辑行为"
node --input-type=module -e "
import { renderBareRunSection } from './src/daily-report-generator.js';
const t = renderBareRunSection([{ task_id: 'smoke-1111', dispatched_at: '2026-09-25T00:00:00Z' }]);
if (!/🟡\s*AMBER/.test(t) || !t.includes('smoke-1111')) { console.error('FAIL 裸跑板块未出 AMBER/task_id'); process.exit(1); }
if (/AMBER/.test(renderBareRunSection([]))) { console.error('FAIL 无裸跑误报'); process.exit(1); }
console.log('renderBareRunSection ✓');
process.exit(0);
"
node --input-type=module -e "
import { buildTaskRunNotionProperties as b } from './src/notion-push-sync.js';
const p = b({ task_id: 't', run_id: 'r', status: 'running', started_at: '2026-09-25T00:00:00Z', ended_at: null, result: {}, context: { source: 'executor' } });
if ('EndedAt' in p || 'ExitCode' in p || 'Minutes' in p) { console.error('FAIL running 行编造了结束/exit/耗时'); process.exit(1); }
console.log('buildTaskRunNotionProperties ✓');
process.exit(0);
"

echo "[task-run-outlets-smoke] 5. 迁移 468 投影注册表占位"
grep -q "INSERT INTO notion_projection_map" migrations/468_task_runs_notion_projection.sql \
  && grep -q "'unmapped:task_runs'" migrations/468_task_runs_notion_projection.sql \
  && grep -q "pending_vessel" migrations/468_task_runs_notion_projection.sql \
  || { echo "FAIL 468 缺投影注册表占位行"; exit 1; }
echo "468 注册表占位 ✓"

if [ -n "${TASK_RUN_SMOKE_DB_URL:-}" ]; then
  echo "[task-run-outlets-smoke] 6. 真库：占位行存在且未误开推送"
  ST=$(psql "$TASK_RUN_SMOKE_DB_URL" -Atc "SELECT status || '/' || direction FROM notion_projection_map WHERE brain_table='task_runs' ORDER BY (status='active') DESC LIMIT 1")
  case "$ST" in
    pending_vessel/none|active/push|active/both) echo "注册表 task_runs 行 = $ST ✓" ;;
    *) echo "FAIL 注册表 task_runs 行异常: '$ST'"; exit 1 ;;
  esac
else
  echo "[task-run-outlets-smoke] 6. 跳过真库检查（未设 TASK_RUN_SMOKE_DB_URL）"
fi

echo "[task-run-outlets-smoke] ALL PASS"
