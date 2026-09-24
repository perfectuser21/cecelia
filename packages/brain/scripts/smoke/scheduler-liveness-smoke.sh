#!/usr/bin/env bash
# Smoke: scheduler-liveness — Brain 调度 job 入运行舱 + notion-gtd-sync 整轮有界（task 50a2c256，决策 69cd802f）
# 起因：2026-09-24 notion-gtd-sync 内层循环卡死 8.4h，该 job 不在 ops_workflows，运行舱全绿无告警。
# 验证：
#   1. ops-scheduler-liveness.js 结构：只写机器列、(source, wf_id) upsert、dead 行 silent 刷新、Bark 合并
#   2. scheduler-jobs.js：scheduler-liveness 为 JOBS 末尾项、注入 self、哨兵透传 liveness_at、gtd 声明 30s 尺
#   3. notion-gtd-sync.js：整轮总超时 / 步边界放弃 / 循环启动时刻兜底
#   4. db-config.js：pg 客户端 query_timeout
#   5. 真库：ops_workflows 活性列齐全（migration 443），Brain 活着
set -euo pipefail

echo "[scheduler-liveness-smoke] 1. ops-scheduler-liveness.js 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/ops-scheduler-liveness.js', 'utf8');
const must = [
  ['export async function runSchedulerLiveness', 'runSchedulerLiveness 导出'],
  [\"SCHEDULER_SOURCE = 'scheduler'\", 'source 常量'],
  ['ON CONFLICT (source, wf_id) DO UPDATE', '按 (source, wf_id) upsert'],
  ['silent_sec - ops_workflows.silent_sec >= 600', 'dead 行静默秒数持续刷新'],
  ['prev_liveness', '翻转告警取旧 liveness'],
  ['classifyDeclaredLiveness', '声明间隔活性'],
  [\"liveness='cold'\", '下线 job 置 cold'],
];
const mustNot = [['owner_manual=', 'SET 混入人工列'], ['note_manual=', 'SET 混入人工列'], ['dispatch=', 'SET 混入人工列 dispatch']];
const missing = must.filter(([p]) => !src.includes(p));
const leaked = mustNot.filter(([p]) => src.includes(p));
if (missing.length || leaked.length) {
  missing.forEach(([, d]) => console.error('FAIL 缺少: ' + d));
  leaked.forEach(([, d]) => console.error('FAIL 违规: ' + d));
  process.exit(1);
}
if (/from\s+'\.\/scheduler-jobs\.js'/.test(src)) { console.error('FAIL: 反向 import scheduler-jobs.js 会成环'); process.exit(1); }
console.log('ops-scheduler-liveness.js 结构正确 ✓');
"

echo "[scheduler-liveness-smoke] 2. scheduler-jobs.js 注册与哨兵透传"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/scheduler-jobs.js', 'utf8');
const names = [...src.matchAll(/\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]);
if (names[names.length - 1] !== 'scheduler-liveness') { console.error('FAIL: scheduler-liveness 不是 JOBS 末尾项，末尾是 ' + names[names.length - 1]); process.exit(1); }
const must = [
  [\"self: 'scheduler-liveness'\", 'handler 注入 self'],
  ['jobs: JOBS', 'handler 注入 JOBS'],
  ['record.liveness_at = result.liveness_at', '哨兵透传 liveness_at'],
  ['livenessIntervalSec: 30', 'notion-gtd-sync 声明 30s 尺'],
];
const missing = must.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([, d]) => console.error('FAIL 缺少: ' + d)); process.exit(1); }
console.log('scheduler-jobs.js 注册正确（共 ' + names.length + ' 个 job）✓');
"

echo "[scheduler-liveness-smoke] 3. notion-gtd-sync.js 整轮有界"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/notion-gtd-sync.js', 'utf8');
const must = [
  ['export const DEFAULT_ROUND_TIMEOUT_MS', '整轮超时默认值导出'],
  [\"error: 'round_timeout'\", '超时记 round_timeout'],
  ['isAbandoned', '步边界放弃'],
  ['loopStartedAt', '循环启动时刻兜底'],
  ['liveness_at: lastCompletedAt ?? loopStartedAt', 'handler 自报 liveness_at'],
];
const missing = must.filter(([p]) => !src.includes(p));
if (missing.length) { missing.forEach(([, d]) => console.error('FAIL 缺少: ' + d)); process.exit(1); }
console.log('notion-gtd-sync.js 整轮有界 ✓');
"

echo "[scheduler-liveness-smoke] 4. db-config.js query_timeout"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/db-config.js', 'utf8');
if (!src.includes('query_timeout')) { console.error('FAIL: DB_DEFAULTS 无 query_timeout'); process.exit(1); }
console.log('db-config.js query_timeout ✓');
"

echo "[scheduler-liveness-smoke] 5. 真库列齐全 + Brain 活着"
DB_URL="${DATABASE_URL:-postgresql://${DB_USER:-cecelia}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-cecelia_test}}"
COLS=$(psql "$DB_URL" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_workflows' AND column_name IN ('liveness','silent_sec','warn_after_sec','dead_after_sec','liveness_at','last_run_at','last_run_status','baseline_interval_sec')")
if [ "$COLS" != "8" ]; then echo "FAIL: ops_workflows 活性列不齐（$COLS/8），migration 439/443 未落"; exit 1; fi
echo "ops_workflows 活性列 8/8 ✓"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
if ! curl -sf --max-time 10 "$BRAIN_URL/api/brain/health" | grep -q '"status"'; then echo "FAIL: Brain 健康端点不可达 $BRAIN_URL"; exit 1; fi
echo "Brain 健康 ✓"
# 首轮串行 job 跑到末尾的 scheduler-liveness 可能超过 smoke 窗口，行数只作信息不作断言
ROWS=$(psql "$DB_URL" -At -c "SELECT count(*) FROM ops_workflows WHERE source='scheduler'" 2>/dev/null || echo "?")
echo "ops_workflows source=scheduler 现有 ${ROWS} 行（首轮后应 = JOBS 数）"

echo "[scheduler-liveness-smoke] ✅ 全部通过"
