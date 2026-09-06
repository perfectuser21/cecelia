#!/usr/bin/env bash
# ops-graph-smoke — 运行舱刀2「Ops 运行图谱」真库火：
# 编排关系(meta.orchestrates)存取、role 双向判定所需的父子反查、agent 与 schedule 按
# name==label 合并去重、孤儿排程独立成行。纯 psql 确定性，CI real-env-smoke 在 cecelia_test 跑。
set -euo pipefail

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"

q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="ops-graph-smoke-$$"
cleanup() {
  q "DELETE FROM ops_agents WHERE host_alias LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_schedule_entries WHERE host_alias LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. 编排关系写入与父子反查（role 双向判定的数据基础）
q "INSERT INTO ops_agents (source,host_alias,name,status,last_seen_at,meta) VALUES
   ('openclaw','${TAG}-hk','main','active',NOW(),'{\"orchestrates\":[\"dev\",\"wc\"]}'::jsonb),
   ('openclaw','${TAG}-hk','wc','active',NOW(),'{\"orchestrates\":[\"dev\"]}'::jsonb),
   ('openclaw','${TAG}-hk','dev','active',NOW(),'{\"orchestrates\":[]}'::jsonb),
   ('openclaw','${TAG}-hk','solo1','active',NOW(),'{\"orchestrates\":[]}'::jsonb)" >/dev/null

orch_cnt="$(q "SELECT count(*) FROM ops_agents WHERE host_alias='${TAG}-hk' AND jsonb_array_length(meta->'orchestrates') > 0")"
[[ "$orch_cnt" == "2" ]] || fail "应有 2 个编排者(main/wc)，实得 $orch_cnt"

# dev 被两个父编排（图结构，多父）
parents="$(q "SELECT count(*) FROM ops_agents WHERE host_alias='${TAG}-hk' AND meta->'orchestrates' @> '[\"dev\"]'::jsonb")"
[[ "$parents" == "2" ]] || fail "dev 应被 2 个父编排(main+wc)，实得 $parents"

# solo 既不编排也不被编排
solo_parents="$(q "SELECT count(*) FROM ops_agents WHERE host_alias='${TAG}-hk' AND meta->'orchestrates' @> '[\"solo1\"]'::jsonb")"
[[ "$solo_parents" == "0" ]] || fail "solo1 不该被任何 agent 编排，实得 $solo_parents"
pass "编排关系存取 + 多父反查（main/wc→dev，solo1 无父）"

# 2. agent 与 schedule 按 name==label 合并去重（同一 launchd job 不出两行）
q "INSERT INTO ops_agents (source,host_alias,name,status,last_seen_at,meta) VALUES
   ('launchd','${TAG}-local','com.cecelia.backup-db','active',NOW(),'{}'::jsonb)" >/dev/null
q "INSERT INTO ops_schedule_entries (source,host_alias,label,kind,schedule_desc,active,updated_at) VALUES
   ('launchd','${TAG}-local','com.cecelia.backup-db','launchd_calendar','calendar 3:30',TRUE,NOW()),
   ('gha','${TAG}-gh','cecelia/nightly.yml','gha_cron','cron 0 19 * * *',TRUE,NOW())" >/dev/null

merged="$(q "SELECT count(*) FROM ops_schedule_entries s
             JOIN ops_agents a ON a.source=s.source AND a.host_alias=s.host_alias AND a.name=s.label
             WHERE s.host_alias='${TAG}-local'")"
[[ "$merged" == "1" ]] || fail "launchd agent 与 schedule 应按 name==label 匹配到 1 行，实得 $merged"

orphan="$(q "SELECT count(*) FROM ops_schedule_entries s
             WHERE s.host_alias='${TAG}-gh' AND NOT EXISTS (
               SELECT 1 FROM ops_agents a WHERE a.source=s.source AND a.host_alias=s.host_alias AND a.name=s.label)")"
[[ "$orphan" == "1" ]] || fail "gha 排程应判为孤儿(无对应 agent)独立成行，实得 $orphan"
pass "合并去重：launchd 一行 + gha 孤儿排程独立行"

echo "✅ ops-graph-smoke 全通过"
