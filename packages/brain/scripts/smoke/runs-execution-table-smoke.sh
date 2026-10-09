#!/usr/bin/env bash
# runs-execution-table-smoke — 执行记录 runs 表（迁移 531，决策 ff2019e2，任务 1215b441）真库真代码火：
# 定时任务一轮真实运行经闹钟总账挂到流程并带真实时长；自 gate 跳过的不记；
# 只上报 span 的运行自动长出总记录（起止/结果/token 由 span 加总，重复上报不重复算）；
# 流程级汇总视图读得出次数与成功率。纯真 PG + 真函数，无 mock；CI real-env-smoke 在 cecelia_test 上跑。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"

q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TAG="runs-smoke-$$"
cleanup() {
  q "DELETE FROM runs WHERE run_id LIKE '${TAG}%' OR trigger_ref LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_schedule_entries WHERE label LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM activities WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM workflows WHERE key LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM capabilities WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM value_streams WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. 结构：runs 表、spans 新列与外键、两个汇总视图
[[ "$(q "SELECT to_regclass('public.runs') IS NOT NULL")" == "t" ]] || fail "runs 表不存在（迁移 531 未跑？）"
for c in parent_span_id span_level; do
  [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='spans' AND column_name='$c'")" == "1" ]] || fail "spans 缺列 $c"
done
[[ "$(q "SELECT count(*) FROM pg_constraint WHERE conname='spans_run_id_fkey'")" == "1" ]] || fail "spans.run_id 未指向 runs"
for v in v_workflow_run_stats v_activity_span_stats; do
  [[ "$(q "SELECT to_regclass('public.$v') IS NOT NULL")" == "t" ]] || fail "缺汇总视图 $v"
done
pass "迁移 531：runs 表、spans 上级记录/层级列与外键、两个汇总视图齐全"

# 2. 夹具：价值流 → 能力 → 流程 → Activity，闹钟总账挂流程
q "INSERT INTO value_streams (name) VALUES ('${TAG}-vs')" >/dev/null
q "INSERT INTO capabilities (name, parent_journey_id) SELECT '${TAG}-cap', id FROM value_streams WHERE name='${TAG}-vs'" >/dev/null
WF="$(q "INSERT INTO workflows (capability_id, key, name, channel) SELECT id, '${TAG}-wf', '${TAG} 流程', 'smoke' FROM capabilities WHERE name='${TAG}-cap' RETURNING id")"
ACT="$(q "INSERT INTO activities (name) VALUES ('${TAG}-act') RETURNING id")"
q "INSERT INTO ops_schedule_entries (source, host_alias, label, kind, workflow_id) VALUES ('brain', 'us-vps', '${TAG}-job', 'brain_job', '${WF}')" >/dev/null

# 3. 真函数：定时任务一轮真实运行 + 一轮自 gate 跳过
(cd "$BRAIN_DIR" && SMOKE_TAG="$TAG" "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { isSelfSkipped, schedulerOutcome, recordSchedulerRun } from './src/lib/workflow-runs.js';
const tag = process.env.SMOKE_TAG;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
try {
  if (!isSelfSkipped({ skipped: true }) || isSelfSkipped({ processed: 2 })) die('自 gate 判定不对');
  const startedAt = new Date();
  await new Promise(r => setTimeout(r, 30));
  await recordSchedulerRun(pool, { jobName: `${tag}-job`, startedAt, endedAt: new Date(),
    outcome: schedulerOutcome({ result: { processed: 2 } }), detail: { summary: '{"processed":2}' } });
  await recordSchedulerRun(pool, { jobName: `${tag}-job`, startedAt: new Date(), endedAt: new Date(),
    outcome: schedulerOutcome({ error: '炸了' }), error: '炸了' });
} finally { await pool.end(); }
NODE
)
ROW="$(q "SELECT workflow_id || '|' || (duration_ms >= 25)::text || '|' || outcome FROM runs WHERE trigger_ref='${TAG}-job' ORDER BY started_at LIMIT 1")"
[[ "$ROW" == "${WF}|true|pass" ]] || fail "定时任务运行未经总账挂到流程或未计时: $ROW"
pass "定时任务一轮真实运行经闹钟总账挂到流程，时长是真实计时"

# 4. 只上报 span 的运行：总记录自动长出，加总正确，重复上报不重复算
for i in 1 2 2; do
  q "INSERT INTO spans (run_id, workflow_id, activity_id, started_at, ended_at, executor_kind, outcome, tokens_in, cost_usd)
     VALUES ('${TAG}-run', '${WF}', '${ACT}', '2020-01-01T01:00:0${i}Z', '2020-01-01T01:00:1${i}Z', 'agent',
             CASE WHEN ${i}=2 THEN 'fail' ELSE 'pass' END, 100, 0.5) ON CONFLICT DO NOTHING" >/dev/null
done
HDR="$(q "SELECT header_source || '|' || outcome || '|' || tokens_in || '|' || cost_usd || '|' || duration_ms FROM runs WHERE run_id='${TAG}-run'")"
[[ "$HDR" == "spans|fail|200|1.000000|11000" ]] || fail "span 加总不对: $HDR"
[[ "$(q "SELECT span_level FROM spans WHERE run_id='${TAG}-run' LIMIT 1")" == "activity" ]] || fail "层级列没算出来"
pass "只上报 span 的运行自动建总记录，起止/结果/token/费用加总正确，重复上报不重复算"

# 5. 汇总视图
STAT="$(q "SELECT runs || '|' || passed || '|' || failed || '|' || success_rate FROM v_workflow_run_stats WHERE workflow_id='${WF}' AND time_window='24h'")"
[[ "$STAT" == "2|1|1|0.5000" ]] || fail "流程汇总不对: $STAT"
pass "流程级汇总视图：24h 内 2 次、成功 1、失败 1、成功率 0.5"

echo "runs-execution-table-smoke: all passed"
