#!/usr/bin/env bash
# ops-registry-smoke — 运行舱投影（指挥舱 G1 S1 刀1）真库火：
# 迁移 433 三表存在、ops_agents 跨 host 同名不撞唯一键、upsert 幂等、
# ops_schedule_entries deactivation 用应用时钟 collectedAt（W1：刚写入行不被误标 offline）。
# 纯 psql，确定性，CI real-env-smoke 在 cecelia_test 上跑；端点逻辑由 vitest 覆盖。
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

q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="ops-smoke-$$"
cleanup() {
  q "DELETE FROM ops_agents WHERE host_alias LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_schedule_entries WHERE host_alias LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_source_heartbeats WHERE host_alias LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. 三表存在
for t in ops_agents ops_schedule_entries ops_source_heartbeats; do
  exists="$(q "SELECT to_regclass('public.$t') IS NOT NULL")"
  [[ "$exists" == "t" ]] || fail "表 $t 不存在（迁移 433 未跑）"
done
pass "迁移 433 三表存在"

# 2. ops_agents 跨 host 同名不撞（唯一键含 host_alias）
q "INSERT INTO ops_agents (source,host_alias,name,status,last_seen_at) VALUES
   ('openclaw','${TAG}-hk','main','active',NOW()),
   ('launchd','${TAG}-local','main','active',NOW())" >/dev/null
cnt="$(q "SELECT count(*) FROM ops_agents WHERE name='main' AND host_alias LIKE '${TAG}%'")"
[[ "$cnt" == "2" ]] || fail "跨 host 同名应共存 2 行，实得 $cnt（唯一键漏了 host_alias？）"
pass "ops_agents 跨机器同名不互撞"

# 3. upsert 幂等：同键再插 → 仍 1 行且 status 更新
q "INSERT INTO ops_agents (source,host_alias,name,status,last_seen_at) VALUES
   ('openclaw','${TAG}-hk','main','offline',NOW())
   ON CONFLICT (source,host_alias,name) DO UPDATE SET status=EXCLUDED.status" >/dev/null
cnt="$(q "SELECT count(*) FROM ops_agents WHERE source='openclaw' AND host_alias='${TAG}-hk' AND name='main'")"
st="$(q "SELECT status FROM ops_agents WHERE source='openclaw' AND host_alias='${TAG}-hk' AND name='main'")"
[[ "$cnt" == "1" && "$st" == "offline" ]] || fail "upsert 应幂等更新，实得 cnt=$cnt status=$st"
pass "ops_agents upsert 幂等"

# 3.5 编排关系（刀2）：meta.orchestrates 存取，供 role/workflow 现算
q "INSERT INTO ops_agents (source,host_alias,name,status,last_seen_at,meta) VALUES
   ('openclaw','${TAG}-hk','orch','active',NOW(),'{\"orchestrates\":[\"child-a\",\"child-b\"],\"delegation_mode\":\"prefer\"}'::jsonb)
   ON CONFLICT (source,host_alias,name) DO UPDATE SET meta=EXCLUDED.meta" >/dev/null
orch="$(q "SELECT jsonb_array_length(meta->'orchestrates') FROM ops_agents WHERE source='openclaw' AND host_alias='${TAG}-hk' AND name='orch'")"
[[ "$orch" == "2" ]] || fail "meta.orchestrates 应存 2 个下级，实得 $orch"
pass "编排关系 meta.orchestrates 存取（role/workflow 现算数据源）"

# 4. W1: deactivation 用应用时钟 collectedAt，刚写入行不被误标
T0="2026-09-05T00:00:00Z"; T1="2026-09-05T00:05:00Z"
# 旧行 updated_at=T0；本轮 collectedAt=T1 写入新行 updated_at=T1
q "INSERT INTO ops_schedule_entries (source,host_alias,label,kind,active,updated_at) VALUES
   ('launchd','${TAG}-local','old-job','launchd_interval',TRUE,'${T0}'),
   ('launchd','${TAG}-local','fresh-job','launchd_interval',TRUE,'${T1}')" >/dev/null
# deactivation：active=FALSE WHERE updated_at < collectedAt(T1)
q "UPDATE ops_schedule_entries SET active=FALSE, updated_at='${T1}'
   WHERE source='launchd' AND host_alias='${TAG}-local' AND active=TRUE AND updated_at < '${T1}'" >/dev/null
old_active="$(q "SELECT active FROM ops_schedule_entries WHERE host_alias='${TAG}-local' AND label='old-job'")"
fresh_active="$(q "SELECT active FROM ops_schedule_entries WHERE host_alias='${TAG}-local' AND label='fresh-job'")"
[[ "$old_active" == "f" ]] || fail "缺席旧排程应被 deactivate，实得 active=$old_active"
[[ "$fresh_active" == "t" ]] || fail "本轮刚写入排程被误标 offline（W1 时钟错配回归！）active=$fresh_active"
pass "W1 deactivation 应用时钟：刚写入行保 active，缺席行 deactivate"

# 5. 闹钟总账（迁移 517，任务 fe10d1a0）：排程台账加列、人工列/挂树列不被机器 upsert 冲掉、口径 CHECK 拦非法值
for c in interval_sec enabled last_run_at last_success_at last_status liveness silent_sec registered_via ledger_status \
         workflow_id journey_id ops_workflow_id owner_manual note_manual tree_bucket_manual; do
  has="$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_schedule_entries' AND column_name='$c'")"
  [[ "$has" == "1" ]] || fail "ops_schedule_entries 缺列 $c（迁移 517 未跑？）"
done
pass "迁移 517：排程台账 15 个总账列齐全（未新建表）"

q "INSERT INTO ops_schedule_entries (source,host_alias,label,kind,schedule_desc,active,owner_manual,note_manual,tree_bucket_manual,registered_via,ledger_status)
   VALUES ('crontab','${TAG}-mmv','ledger-job @ 5 * * * *','crontab','cron(UTC): 5 * * * *',TRUE,'alex','人写备注','暂存归属','external-legacy','registered')" >/dev/null
# 采集腿同款 upsert：SET 里只有机器列
q "INSERT INTO ops_schedule_entries (source,host_alias,label,kind,schedule_desc,active,interval_sec,enabled,last_status)
   VALUES ('crontab','${TAG}-mmv','ledger-job @ 5 * * * *','crontab','cron(UTC): 6 * * * *',TRUE,3600,TRUE,'正常')
   ON CONFLICT (source,host_alias,label) DO UPDATE SET
     schedule_desc=EXCLUDED.schedule_desc, interval_sec=EXCLUDED.interval_sec, enabled=EXCLUDED.enabled, last_status=EXCLUDED.last_status" >/dev/null
kept="$(q "SELECT owner_manual||'|'||note_manual||'|'||tree_bucket_manual||'|'||registered_via||'|'||ledger_status FROM ops_schedule_entries WHERE host_alias='${TAG}-mmv'")"
[[ "$kept" == "alex|人写备注|暂存归属|external-legacy|registered" ]] || fail "机器 upsert 冲掉了人工列/登记列：$kept"
fresh="$(q "SELECT interval_sec||'|'||last_status FROM ops_schedule_entries WHERE host_alias='${TAG}-mmv'")"
[[ "$fresh" == "3600|正常" ]] || fail "机器列未更新：$fresh"
pass "机器 upsert 只动机器列，人工列/登记列原样保留"

for bad in "ledger_status='maybe'" "last_status='乱写'" "registered_via='cron-by-hand'"; do
  col="${bad%%=*}"; val="${bad#*=}"
  if q "INSERT INTO ops_schedule_entries (source,host_alias,label,kind,${col}) VALUES ('crontab','${TAG}-mmv','bad-${col}','crontab',${val})" >/dev/null 2>&1; then
    fail "CHECK 约束没拦住非法值 ${bad}（口径会漂移）"
  fi
done
pass "CHECK 约束拦住非法 ledger_status / last_status / registered_via"

echo "✅ ops-registry-smoke 全通过"
