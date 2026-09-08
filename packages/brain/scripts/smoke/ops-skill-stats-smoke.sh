#!/usr/bin/env bash
# ops-skill-stats-smoke — 刀8 真库火：skill 级运行统计字段 + 档位随数据自动升级。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="skstats-$$"
cleanup() { q "DELETE FROM ops_skills WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# 1. 迁移 442 五个统计列
for c in runs run_success run_success_rate run_avg_sec run_stats_at; do
  [[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_skills' AND column_name='$c'")" == "1" ]] \
    || fail "ops_skills missing column $c"
done
pass "migration 442: skill run stats 5 columns"

# 2. 统计可落库（阶段归因产物）
q "INSERT INTO ops_skills (source,name,used_by,runs,run_success,run_success_rate,run_avg_sec,has_postcondition)
   VALUES ('openclaw','${TAG}-a','[]'::jsonb,19,19,100,360,true)" >/dev/null
r="$(q "SELECT runs||'/'||run_success||'/'||run_success_rate FROM ops_skills WHERE name='${TAG}-a'")"
[[ "$r" == "19/19/100" ]] || fail "stats not stored, got $r"
pass "skill run stats stored (19 runs, 100%)"

# 3. 关键：有数据的 skill 才能升 disco——无探针的即使高频高成功率也不许升
q "INSERT INTO ops_skills (source,name,used_by,runs,run_success_rate,has_postcondition)
   VALUES ('openclaw','${TAG}-noprobe','[]'::jsonb,500,99,false)" >/dev/null
np="$(q "SELECT has_postcondition FROM ops_skills WHERE name='${TAG}-noprobe'")"
[[ "$np" == "f" ]] || fail "expected has_postcondition=false"
pass "no-probe skill recorded (must stay software3 by DisCo rule)"

# 4. 低频 skill 也记录（<20 次不该升档）
q "INSERT INTO ops_skills (source,name,used_by,runs,run_success_rate,has_postcondition)
   VALUES ('openclaw','${TAG}-lowfreq','[]'::jsonb,2,100,true)" >/dev/null
lf="$(q "SELECT runs FROM ops_skills WHERE name='${TAG}-lowfreq'")"
[[ "$lf" == "2" ]] || fail "low-freq skill not stored"
pass "low-freq skill recorded (2 runs, below fixation threshold)"

echo "OK ops-skill-stats-smoke passed"
