#!/usr/bin/env bash
# notion-projection-map-smoke — 三面模型 PR① 真库火：注册表存在、种子齐、面/方向合法、废表已停推。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
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

# 旧 AI Steps 推送链（2026-06-09 退役）不得复活；迁移 482（决策 0834e2fb / 92f6226b）起 journey_steps=backbone_activities
# 唯一推送血管 = Backbone Activities 契约只读镜子，走 activity-contract-sync，不走旧 notion-push-sync 链
ais="$(q "SELECT direction||'/'||status FROM notion_projection_map WHERE brain_table='activities' AND notion_db_id='369c40c2-ba63-812c-9f35-e7e43db25014'")"
[[ "$ais" == "none/archived" ]] || fail "旧 AI Steps 登记应为 none/archived，得 $ais"
jsp="$(q "SELECT string_agg(notion_db_id||'@'||vessel, ',') FROM notion_projection_map WHERE brain_table='activities' AND direction IN ('push','both') AND status='active'")"
[[ "$jsp" == "c213e387-b2ae-45a4-98c0-4a66fe3408be@activity-contract-sync.pushBackboneActivities" ]] || fail "activities（原 journey_steps）唯一推送血管应为 Backbone Activities 契约镜子，得 $jsp"
grep -q "await pushJourneySteps" "$BRAIN_DIR/src/notion-push-sync.js" && fail "推送链仍含 pushJourneySteps（旧 AI Steps 链）" || true
pass "activities（原 journey_steps）：旧 AI Steps 链不复活，唯一推送血管 = Backbone Activities 契约镜子"

# migration 453 起放开"一库多表"（AI Notes=decisions+initiative_contracts 等），唯一键=(库 id 归一, brain_table)
dup="$(q "SELECT count(*) FROM (SELECT lower(replace(notion_db_id,'-','')) k, coalesce(brain_table,'') t, count(*) c FROM notion_projection_map GROUP BY 1,2 HAVING count(*)>1) x")"
[[ "$dup" == "0" ]] || fail "同一 (Notion 库, brain_table) 重复登记 $dup 组"
pass "无重复登记（(库 id 归一, brain_table) 唯一；一库多表允许）"

echo "ALL PASS: notion-projection-map"
