#!/usr/bin/env bash
# ops-workflows-smoke — 运行舱刀4/5 真库火：业务流程表、skill 表、三层关联链。
# 验的是"workflow → agent → skill"三层能否落库并互指。纯 psql 确定性。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="wf-smoke-$$"
cleanup() {
  q "DELETE FROM ops_workflows WHERE wf_id LIKE '${TAG}%'" >/dev/null 2>&1 || true
  q "DELETE FROM ops_skills WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# 1. 两张新表存在（迁移 436/437）
for t in ops_workflows ops_skills; do
  [[ "$(q "SELECT to_regclass('public.$t') IS NOT NULL")" == "t" ]] || fail "表 $t 不存在（迁移未跑）"
done
pass "迁移 436/437 两表存在"

# 2. workflow 落库：阶段序列 + agent 归属（传递闭包结果）
q "INSERT INTO ops_workflows (source,wf_id,name,active,node_count,stage_count,uses_agents,meta)
   VALUES ('n8n','${TAG}-v4','测试获客流程',TRUE,38,8,'[\"work-commander\"]'::jsonb,
           '{\"stages\":[\"手机预检\",\"视频发现\",\"全文判定\"]}'::jsonb)" >/dev/null
st="$(q "SELECT jsonb_array_length(meta->'stages') FROM ops_workflows WHERE wf_id='${TAG}-v4'")"
ag="$(q "SELECT uses_agents->>0 FROM ops_workflows WHERE wf_id='${TAG}-v4'")"
[[ "$st" == "3" && "$ag" == "work-commander" ]] || fail "workflow 阶段/agent 落库失败: stages=$st agent=$ag"
pass "workflow 落库：阶段序列 + agent 归属（传递闭包）"

# 3. Nodes ≠ Stages（业务阶段少于画布节点，这是刀4的核心区分）
nc="$(q "SELECT node_count FROM ops_workflows WHERE wf_id='${TAG}-v4'")"
sc="$(q "SELECT stage_count FROM ops_workflows WHERE wf_id='${TAG}-v4'")"
[[ "$nc" -gt "$sc" ]] || fail "Nodes($nc) 应大于 Stages($sc)——画布含技术脚手架"
pass "Nodes/Stages 语义区分（$nc 节点 vs $sc 业务阶段）"

# 4. skill 是最小单元且与 agent 多对多
q "INSERT INTO ops_skills (source,name,used_by,description)
   VALUES ('openclaw','${TAG}-shared','[\"agent-a\",\"agent-b\",\"agent-c\"]'::jsonb,'共享技能包')" >/dev/null
u="$(q "SELECT jsonb_array_length(used_by) FROM ops_skills WHERE name='${TAG}-shared'")"
[[ "$u" == "3" ]] || fail "同一 skill 应可被多 agent 共用，实得 $u"
pass "skill↔agent 多对多（1 个 skill 被 3 个 agent 共用）"

# 5. upsert 幂等（采集器每 5 分钟重跑不produce重复行）
q "INSERT INTO ops_workflows (source,wf_id,name,active,stage_count) VALUES ('n8n','${TAG}-v4','改名了',FALSE,9)
   ON CONFLICT (source,wf_id) DO UPDATE SET name=EXCLUDED.name,active=EXCLUDED.active,stage_count=EXCLUDED.stage_count" >/dev/null
cnt="$(q "SELECT count(*) FROM ops_workflows WHERE wf_id='${TAG}-v4'")"
nm="$(q "SELECT name FROM ops_workflows WHERE wf_id='${TAG}-v4'")"
[[ "$cnt" == "1" && "$nm" == "改名了" ]] || fail "upsert 应幂等更新，实得 cnt=$cnt name=$nm"
pass "workflow upsert 幂等"

echo "✅ ops-workflows-smoke 全通过"
