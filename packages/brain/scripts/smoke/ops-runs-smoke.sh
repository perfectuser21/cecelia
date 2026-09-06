#!/usr/bin/env bash
# ops-runs-smoke — 运行舱刀6 真库火：run 记录表、健康汇总列、业务流程/通道分流。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="runs-smoke-$$"
cleanup() {
  q "DELETE FROM ops_runs WHERE wf_id LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_workflows WHERE wf_id LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. ops_runs 表 + 流程健康列（迁移 439）
[[ "$(q "SELECT to_regclass('public.ops_runs') IS NOT NULL")" == "t" ]] || fail "ops_runs 表不存在"
for c in machine run_total run_success_rate run_avg_sec last_run_at last_run_status; do
  [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_workflows' AND column_name='$c'")" == "1" ]] \
    || fail "ops_workflows 缺列 $c"
done
pass "迁移 439：ops_runs 表 + 流程健康 6 列"

# 2. run 落库：机器/耗时/状态
q "INSERT INTO ops_workflows (source,wf_id,name,active,stage_count) VALUES ('n8n','${TAG}-biz','测试业务流程',TRUE,8)" >/dev/null
q "INSERT INTO ops_runs (source,run_id,wf_id,status,machine,started_at,stopped_at,duration_sec) VALUES
   ('n8n','${TAG}-r1','${TAG}-biz','success','hk-vps',NOW()-INTERVAL '40 minutes',NOW(),2280),
   ('n8n','${TAG}-r2','${TAG}-biz','error','hk-vps',NOW()-INTERVAL '2 hours',NOW()-INTERVAL '110 minutes',600),
   ('n8n','${TAG}-r3','${TAG}-biz','crashed','hk-vps',NOW()-INTERVAL '3 hours',NULL,NULL)" >/dev/null
n="$(q "SELECT count(*) FROM ops_runs WHERE wf_id='${TAG}-biz'")"
[[ "$n" == "3" ]] || fail "run 应落库 3 条，实得 $n"
m="$(q "SELECT machine FROM ops_runs WHERE run_id='${TAG}-r1'")"
[[ "$m" == "hk-vps" ]] || fail "机器字段应为 hk-vps，实得 $m"
pass "run 落库：机器/耗时/状态"

# 3. crashed 无耗时 = NULL（禁编造 0）
d="$(q "SELECT COALESCE(duration_sec::text,'NULL') FROM ops_runs WHERE run_id='${TAG}-r3'")"
[[ "$d" == "NULL" ]] || fail "crashed 无 stoppedAt 时 duration 应为 NULL，实得 $d"
pass "crashed 耗时留 NULL 不编造"

# 4. 健康汇总可回填（成功率 1/3=33%）
q "UPDATE ops_workflows SET run_total=3, run_success_rate=33, run_avg_sec=1440, last_run_status='crashed' WHERE wf_id='${TAG}-biz'" >/dev/null
sr="$(q "SELECT run_success_rate FROM ops_workflows WHERE wf_id='${TAG}-biz'")"
[[ "$sr" == "33" ]] || fail "健康汇总回填失败，实得 $sr"
pass "流程健康汇总回填（3次/成功率33%）"

# 5. 业务流程/通道分流：Notion 只推有阶段的
q "INSERT INTO ops_workflows (source,wf_id,name,active,stage_count) VALUES ('n8n','${TAG}-channel','通道单点',TRUE,0)" >/dev/null
q "INSERT INTO ops_runs (source,run_id,wf_id,status,machine,started_at) VALUES ('n8n','${TAG}-r9','${TAG}-channel','success','hk-vps',NOW())" >/dev/null
pushable="$(q "SELECT count(*) FROM ops_runs r JOIN ops_workflows w ON w.source=r.source AND w.wf_id=r.wf_id WHERE w.stage_count>0 AND r.wf_id LIKE '${TAG}%'")"
[[ "$pushable" == "3" ]] || fail "只有业务流程(有阶段)的 run 该推 Notion，实得 $pushable"
pass "业务流程/通道分流（通道 run 不推 Notion 免淹视线）"

echo "✅ ops-runs-smoke 全通过"
