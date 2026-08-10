#!/usr/bin/env bash
# ============================================================
# Smoke: Cecelia 承诺地图归位 schema 快速验证
# Sprint: 08101234-cecelia-map-reorg
# Task: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
#
# 覆盖：Migration 397-400 核心结构断言（无孤儿/价值流/Capability计数）
# 用法: DATABASE_URL=postgres://... bash map-reorg-smoke.sh
# ============================================================

set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://cecelia@localhost:5432/cecelia}"
PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

psql_val() { psql "$DB_URL" -t -c "$1" | tr -d ' \n'; }

# 1. schema 字段存在
FIELDS=$(psql_val "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='journeys' AND column_name IN ('parent_journey_id','capability_code');")
[ "$FIELDS" -eq 2 ] && pass "journeys 新字段存在(2)" || fail "journeys 新字段缺失($FIELDS/2)"

# 2. 价值流顶层行 = 2
VS=$(psql_val "SELECT COUNT(*) FROM journeys WHERE parent_journey_id IS NULL AND status='active' AND biz_area='cecelia';")
[ "$VS" -eq 2 ] && pass "价值流顶层行=2" || fail "价值流顶层行=$VS(期望2)"

# 3. 工厂线 Capability = 6
FC=$(psql_val "SELECT COUNT(*) FROM journeys WHERE parent_journey_id=(SELECT id FROM journeys WHERE capability_code='VS_FACTORY') AND status='active';")
[ "$FC" -eq 6 ] && pass "工厂线Capability=6" || fail "工厂线Capability=$FC(期望6)"

# 4. 管家线 Capability = 5
SC=$(psql_val "SELECT COUNT(*) FROM journeys WHERE parent_journey_id=(SELECT id FROM journeys WHERE capability_code='VS_STEWARD') AND status='active';")
[ "$SC" -eq 5 ] && pass "管家线Capability=5" || fail "管家线Capability=$SC(期望5)"

# 5. 关键锚不断裂
AC=$(psql_val "SELECT COUNT(*) FROM journeys WHERE id IN ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29','8bb8252f-29b4-4c34-acb9-1accda7ddfcf');")
[ "$AC" -eq 2 ] && pass "关键锚行存在=2" || fail "关键锚断裂($AC/2)"

# 6. 孤儿归零
OC=$(psql_val "SELECT COUNT(*) FROM journey_features WHERE journey_id IS NULL AND status!='deprecated';")
[ "$OC" -eq 0 ] && pass "孤儿挂片=0" || fail "孤儿挂片=$OC(期望0)"

# 7. 横切件 >= 7
EC=$(psql_val "SELECT COUNT(*) FROM journey_features WHERE kind='enabler' AND status!='deprecated';")
[ "$EC" -ge 7 ] && pass "横切件>=$EC(>=7)" || fail "横切件=$EC(期望>=7)"

echo "---"
echo "PASS: $PASS / FAIL: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
