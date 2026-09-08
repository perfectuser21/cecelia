#!/usr/bin/env bash
# ops-probe-detect-smoke — 探针检测真库火：has_postcondition 落盘 + 档位判据齐备。
# 判据来源：决策「无 postcondition 不许固化」——碎了能当场发现是固化前提。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }

TAG="probe-$$"
cleanup() { q "DELETE FROM ops_skills WHERE name LIKE '${TAG}%'" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# 1. has_postcondition 列存在且可落盘
[[ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='ops_skills' AND column_name='has_postcondition'")" == "1" ]] \
  || fail "ops_skills missing column has_postcondition"
pass "has_postcondition column exists"

# 2. 三态可区分：有探针 / 无探针 / 未知(NULL)
q "INSERT INTO ops_skills (source,name,used_by,has_postcondition,runs,run_success_rate) VALUES
   ('openclaw','${TAG}-yes','[]'::jsonb,true,100,99),
   ('openclaw','${TAG}-no','[]'::jsonb,false,100,99),
   ('openclaw','${TAG}-unknown','[]'::jsonb,NULL,100,99)" >/dev/null
y="$(q "SELECT has_postcondition FROM ops_skills WHERE name='${TAG}-yes'")"
n="$(q "SELECT has_postcondition FROM ops_skills WHERE name='${TAG}-no'")"
u="$(q "SELECT COALESCE(has_postcondition::text,'NULL') FROM ops_skills WHERE name='${TAG}-unknown'")"
[[ "$y" == "t" && "$n" == "f" && "$u" == "NULL" ]] || fail "tri-state broken: $y/$n/$u"
pass "probe tri-state stored (true / false / unknown=NULL)"

# 3. 关键判据：同为高频高成功率，有无探针决定能否升档
#    （代码判定在 inferDiscoStage 单测覆盖；此处验数据层能承载这个区分）
same="$(q "SELECT count(DISTINCT has_postcondition) FROM ops_skills WHERE name LIKE '${TAG}-%' AND runs=100 AND run_success_rate=99")"
[[ "$same" == "2" ]] || fail "expected 2 distinct non-null probe values among same-stats skills, got $same"
pass "same freq+rate skills differ only by probe (the fixation gate)"

echo "OK ops-probe-detect-smoke passed"
