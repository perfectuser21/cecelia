#!/usr/bin/env bash
# ops-skill-versions-smoke — 刀7 真库火：版本历史只追加不覆盖、真外键级联、成熟度字段。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="skv-smoke-$$"
cleanup() { q "DELETE FROM ops_skills WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# 1. 表与成熟度字段存在（迁移 441）
[[ "$(q "SELECT to_regclass('public.ops_skill_versions') IS NOT NULL")" == "t" ]] || fail "ops_skill_versions 不存在"
for c in generation eval_score disco_stage stage_reason stage_confident has_postcondition; do
  [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_skills' AND column_name='$c'")" == "1" ]] \
    || fail "ops_skills 缺列 $c"
done
pass "迁移 441：版本表 + ops_skills 成熟度 6 列"

# 2. 真外键：版本必须挂在存在的 skill 上
q "INSERT INTO ops_skills (source,name,used_by) VALUES ('openclaw','${TAG}-a','[]'::jsonb)" >/dev/null
sid="$(q "SELECT id FROM ops_skills WHERE source='openclaw' AND name='${TAG}-a'")"
[[ -n "$sid" ]] || fail "建 skill 失败"
q "INSERT INTO ops_skill_versions (skill_id,skill_name,generation,eval_score,disco_stage)
   VALUES ($sid,'${TAG}-a',1,38,'software3')" >/dev/null
if q "INSERT INTO ops_skill_versions (skill_id,skill_name,generation) VALUES (999999999,'ghost',1)" >/dev/null 2>&1; then
  fail "外键失效：挂到不存在的 skill 竟然成功了"
fi
pass "真外键生效（悬空 skill_id 被拒）"

# 3. 一代一行、只追加不覆盖（演进曲线 38 -> 76 -> 95）
q "INSERT INTO ops_skill_versions (skill_id,skill_name,generation,eval_score,disco_stage) VALUES
   ($sid,'${TAG}-a',2,76,'software3'),
   ($sid,'${TAG}-a',3,95,'disco')" >/dev/null
n="$(q "SELECT count(*) FROM ops_skill_versions WHERE skill_id=$sid")"
[[ "$n" == "3" ]] || fail "should keep 3 generations, got $n"
curve="$(q "SELECT string_agg(eval_score::text, '-' ORDER BY generation) FROM ops_skill_versions WHERE skill_id=$sid")"
[[ "$curve" == "38-76-95" ]] || fail "curve should be 38-76-95, got $curve"
pass "version history append-only (curve $curve, gen3 upgraded to disco)"

# 4. 同代重复写不产生第二行（幂等）
q "INSERT INTO ops_skill_versions (skill_id,skill_name,generation,eval_score) VALUES ($sid,'${TAG}-a',3,95)
   ON CONFLICT (skill_id,generation) DO NOTHING" >/dev/null
n2="$(q "SELECT count(*) FROM ops_skill_versions WHERE skill_id=$sid")"
[[ "$n2" == "3" ]] || fail "同代重复应幂等，实得 $n2"
pass "同代幂等（采集器每5分钟跑不会灌流水账）"

# 5. 级联删除：skill 删掉，历史跟着走（不留孤儿）
q "DELETE FROM ops_skills WHERE id=$sid" >/dev/null
orphan="$(q "SELECT count(*) FROM ops_skill_versions WHERE skill_id=$sid")"
[[ "$orphan" == "0" ]] || fail "skill 删除后应级联清理版本，残留 $orphan"
pass "级联删除无孤儿"

echo "✅ ops-skill-versions-smoke 全通过"
