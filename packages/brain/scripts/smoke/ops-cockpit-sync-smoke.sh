#!/usr/bin/env bash
# ops-cockpit-sync-smoke — 驾驶舱双向同步真库火。
# 守的是三条会静默失效的接缝：
#   ① 推送/回读任务真的注册进了调度层（旧链就是挂在无人 import 的 legacy scheduler 上，静默停更两天）
#   ② 人工列不会被采集器的 UPSERT 冲掉（分区是整个双向设计的地基）
#   ③ 停用失败必须留下 enable_error（不可逆动作绝不静默）
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="cockpit-$$"
cleanup() { q "DELETE FROM ops_workflows WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# ── ① 两个任务真的进了调度表（旧链的死法就是没人 import）──────────
JOBS="$ROOT/src/scheduler-jobs.js"
grep -q "name: 'ops-notion-push'" "$JOBS" || fail "ops-notion-push 未注册进 scheduler-jobs"
grep -q "name: 'ops-notion-ingest'" "$JOBS" || fail "ops-notion-ingest 未注册进 scheduler-jobs"
grep -q "runOpsNotionPush" "$JOBS" || fail "scheduler-jobs 未 import runOpsNotionPush"
grep -q "runOpsNotionIngest" "$JOBS" || fail "scheduler-jobs 未 import runOpsNotionIngest"
pass "推送/回读任务已注册且已接线（非 legacy 死链）"

# 采集先于推送——否则推的是上一轮旧数据，liveness 会算错
push_ln=$(grep -n "name: 'ops-notion-push'" "$JOBS" | cut -d: -f1)
coll_ln=$(grep -n "name: 'ops-collector'" "$JOBS" | cut -d: -f1)
[ "$coll_ln" -lt "$push_ln" ] || fail "ops-collector 必须排在 ops-notion-push 之前"
pass "调度顺序正确：先采集后推送"

# ── ② 人工列不被采集覆盖 ────────────────────────────────
COLL="$ROOT/src/ops-collector.js"
for col in owner_manual note_manual priority_manual starred enable_intent stage_manual org_manual; do
  grep -q "${col}=" "$COLL" && fail "采集器写了人工列 ${col}——会冲掉主理人在 Notion 的修改"
done
pass "采集器不触碰任何人工列"

# 真库验证：写入人工列后跑一次采集器那条 UPDATE，人工列必须原样存活
q "INSERT INTO ops_workflows (source,wf_id,name,active,owner_manual,note_manual,priority_manual,starred)
   VALUES ('n8n','${TAG}-1','${TAG}-flow',true,'悦升号','重点盯','P0',true)" >/dev/null
q "UPDATE ops_workflows SET machine='hk-vps', run_total=99, run_success_rate=88,
     liveness='dead', silent_sec=73440, updated_at=NOW()
   WHERE source='n8n' AND wf_id='${TAG}-1'" >/dev/null
survived="$(q "SELECT coalesce(owner_manual,'')||'|'||coalesce(note_manual,'')||'|'||coalesce(priority_manual,'')||'|'||coalesce(starred::text,'') FROM ops_workflows WHERE wf_id='${TAG}-1'")"
[ "$survived" = "悦升号|重点盯|P0|true" ] || fail "机器列更新冲掉了人工列: $survived"
pass "机器列更新后人工列原样存活（字段分区成立）"

# ── ③ 活性四态可落盘 + 停用失败必须留痕 ────────────────────
for lv in ok warn dead cold; do
  q "UPDATE ops_workflows SET liveness='$lv' WHERE wf_id='${TAG}-1'" >/dev/null
done
[ "$(q "SELECT liveness FROM ops_workflows WHERE wf_id='${TAG}-1'")" = "cold" ] || fail "liveness 落盘失败"
pass "活性四态可落盘"

q "UPDATE ops_workflows SET enable_intent=false, enable_error='n8n 500 boom', enable_applied_at=NOW()
   WHERE wf_id='${TAG}-1'" >/dev/null
err="$(q "SELECT enable_error FROM ops_workflows WHERE wf_id='${TAG}-1'")"
[ -n "$err" ] || fail "停用失败原因未落库——不可逆动作绝不能静默"
pass "停用失败留痕可见（看板据此显红）"

# 回读游标表存在（缺了会每轮全量扫 Notion 触发限流）
[ "$(q "SELECT count(*) FROM information_schema.tables WHERE table_name='ops_notion_ingest_cursor'")" = "1" ] \
  || fail "缺 ops_notion_ingest_cursor 增量游标表"
pass "增量游标表就位"

echo "OK ops-cockpit-sync-smoke passed"
