#!/usr/bin/env bash
# notion-projection-map-smoke — 三面模型 PR① 真库火：注册表存在、种子齐、面/方向合法、废表已停推。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

n="$(q "SELECT count(*) FROM notion_projection_map")"
[[ "$n" -ge 25 ]] || fail "种子不足: $n"
pass "注册表存在，登记 $n 个编制库"

bad="$(q "SELECT count(*) FROM notion_projection_map WHERE face NOT IN ('mirror','inlet','truth') OR direction NOT IN ('push','ingest','both','none')")"
[[ "$bad" == "0" ]] || fail "非法 face/direction: $bad 行"
pass "face 三面 / direction 四向全部合法"

for f in mirror inlet truth; do
  c="$(q "SELECT count(*) FROM notion_projection_map WHERE face='$f'")"
  [[ "$c" -gt 0 ]] || fail "面 $f 为空"
done
pass "三面各有登记（镜子/入口/真身）"

js="$(q "SELECT direction||'/'||status FROM notion_projection_map WHERE brain_table='journey_steps'")"
[[ "$js" == "none/archived" ]] || fail "journey_steps 应为 none/archived，得 $js"
grep -q "await pushJourneySteps" "$BRAIN_DIR/src/notion-push-sync.js" && fail "推送链仍含 pushJourneySteps（废表）" || true
pass "废表 journey_steps：注册 archived/none 且已从推送链摘除"

dup="$(q "SELECT count(*) FROM (SELECT lower(replace(notion_db_id,'-','')) k, count(*) c FROM notion_projection_map GROUP BY 1 HAVING count(*)>1) x")"
[[ "$dup" == "0" ]] || fail "同一 Notion 库重复登记 $dup 组"
pass "无重复登记（id 归一后唯一）"

echo "ALL PASS: notion-projection-map"
