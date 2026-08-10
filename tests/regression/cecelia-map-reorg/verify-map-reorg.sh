#!/usr/bin/env bash
# ============================================================
# 验收脚本：Cecelia 承诺地图归位
# Sprint: 08101234-cecelia-map-reorg
# Task ID: f491a8dd-b0e3-4352-a5e0-6cb85df73d80
#
# 用法:
#   DATABASE_URL=postgres://localhost/cecelia bash verify-map-reorg.sh
#   DATABASE_URL=postgres://user:pass@host/cecelia bash verify-map-reorg.sh
#
# 说明：所有断言通过退出码 0，任一失败退出码 1
# ============================================================

set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://localhost/cecelia}"
PASS_COUNT=0
FAIL_COUNT=0

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}FAIL${NC}: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo -e "${YELLOW}INFO${NC}: $1"; }

echo "============================================================"
echo "验收脚本：Cecelia 承诺地图归位"
echo "DB: $DB_URL"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# 确认 psql 可用
if ! command -v psql &>/dev/null; then
  echo "ERROR: psql 命令不可用，请安装 postgresql-client"
  exit 1
fi

# 确认 DB 可连接
if ! psql "$DB_URL" -c "SELECT 1" &>/dev/null; then
  echo "ERROR: 无法连接到数据库 $DB_URL"
  exit 1
fi

psql_scalar() {
  psql "$DB_URL" -t -c "$1" | tr -d ' \n'
}

# ============================================================
# B-1 / AC-1：2 条 active 价值流
# ============================================================
echo "--- B-1：active 价值流计数 ---"
RESULT=$(psql_scalar "SELECT COUNT(*) FROM journeys WHERE parent_journey_id IS NULL AND status = 'active' AND biz_area = 'cecelia';")
if [ "$RESULT" -eq 2 ]; then
  pass "价值流数量 = $RESULT (期望 2)"
else
  fail "价值流数量 = $RESULT (期望 2)"
fi
echo ""

# ============================================================
# B-2 / AC-2：工厂线 6 个 Capability
# ============================================================
echo "--- B-2a：工厂线 Capability 计数 ---"
FACTORY_COUNT=$(psql_scalar "SELECT COUNT(*) FROM journeys WHERE parent_journey_id = (SELECT id FROM journeys WHERE capability_code = 'VS_FACTORY') AND status = 'active';")
if [ "$FACTORY_COUNT" -eq 6 ]; then
  pass "工厂线 Capability = $FACTORY_COUNT (期望 6)"
else
  fail "工厂线 Capability = $FACTORY_COUNT (期望 6)"
fi

# ============================================================
# B-2 / AC-3：管家线 5 个 Capability
# ============================================================
echo "--- B-2b：管家线 Capability 计数 ---"
STEWARD_COUNT=$(psql_scalar "SELECT COUNT(*) FROM journeys WHERE parent_journey_id = (SELECT id FROM journeys WHERE capability_code = 'VS_STEWARD') AND status = 'active';")
if [ "$STEWARD_COUNT" -eq 5 ]; then
  pass "管家线 Capability = $STEWARD_COUNT (期望 5)"
else
  fail "管家线 Capability = $STEWARD_COUNT (期望 5)"
fi
echo ""

# ============================================================
# B-3 / AC-4：关键锚 journey 行存在
# ============================================================
echo "--- B-3：关键锚 journey 行存在 ---"
ANCHOR_COUNT=$(psql_scalar "SELECT COUNT(*) FROM journeys WHERE id IN ('e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29', '8bb8252f-29b4-4c34-acb9-1accda7ddfcf');")
if [ "$ANCHOR_COUNT" -eq 2 ]; then
  pass "关键锚 journey 行数 = $ANCHOR_COUNT (期望 2)"
else
  fail "关键锚 journey 行数 = $ANCHOR_COUNT (期望 2) — anchor 断裂！"
fi
echo ""

# ============================================================
# B-4 / AC-6：孤儿挂片归零
# ============================================================
echo "--- B-4a：孤儿挂片归零 ---"
ORPHAN_COUNT=$(psql_scalar "SELECT COUNT(*) FROM journey_features WHERE journey_id IS NULL AND status != 'deprecated';")
if [ "$ORPHAN_COUNT" -eq 0 ]; then
  pass "孤儿挂片 = $ORPHAN_COUNT (期望 0)"
else
  fail "孤儿挂片 = $ORPHAN_COUNT (期望 0)"
fi

# ============================================================
# B-4 / AC-7：横切件池 >= 7
# ============================================================
echo "--- B-4b：横切件池计数 ---"
ENABLER_COUNT=$(psql_scalar "SELECT COUNT(*) FROM journey_features WHERE kind = 'enabler' AND status != 'deprecated';")
if [ "$ENABLER_COUNT" -ge 7 ]; then
  pass "横切件池 = $ENABLER_COUNT (期望 >= 7)"
else
  fail "横切件池 = $ENABLER_COUNT (期望 >= 7)"
fi
echo ""

# ============================================================
# B-5 / AC-8：Migration 幂等性
# ============================================================
echo "--- B-5：Migration 幂等性检查 ---"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

MIGRATIONS=(
  "packages/brain/migrations/397_journeys_capability_self_ref.sql"
  "packages/brain/migrations/398_seed_two_value_streams_11_capabilities.sql"
  "packages/brain/migrations/399_journey_features_orphan_retire.sql"
  "packages/brain/migrations/401_cross_cutting_concerns_pool.sql"
)

for migration in "${MIGRATIONS[@]}"; do
  MIGRATION_PATH="$WORKSPACE_ROOT/$migration"
  if [ ! -f "$MIGRATION_PATH" ]; then
    info "$migration 文件尚未创建（等待 Planner 产出，跳过幂等性检查）"
    continue
  fi
  OUTPUT=$(psql "$DB_URL" -f "$MIGRATION_PATH" 2>&1)
  if echo "$OUTPUT" | grep -qi "ERROR"; then
    fail "$migration 重复执行报错"
    echo "  错误详情: $(echo "$OUTPUT" | grep -i 'ERROR' | head -3)"
  else
    pass "$migration 幂等执行无报错"
  fi
done
echo ""

# ============================================================
# B-6 / AC-Schema：schema 字段存在
# ============================================================
echo "--- B-6：schema 字段验证 ---"
FIELD_COUNT=$(psql_scalar "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'journeys' AND column_name IN ('parent_journey_id', 'capability_code');")
if [ "$FIELD_COUNT" -eq 2 ]; then
  pass "journeys 表新增字段数 = $FIELD_COUNT (期望 2)"
else
  fail "journeys 表新增字段数 = $FIELD_COUNT (期望 2) — Migration 397 可能未执行"
fi

INDEX_EXISTS=$(psql_scalar "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'journeys' AND indexname = 'idx_journeys_capability_code';")
if [ "$INDEX_EXISTS" -eq 1 ]; then
  pass "capability_code 唯一索引存在"
else
  fail "idx_journeys_capability_code 索引不存在"
fi
echo ""

# ============================================================
# 补充信息：当前价值流 + Capability 树形视图
# ============================================================
echo "--- 当前承诺地图树形视图 ---"
psql "$DB_URL" -c "
SELECT
  vs.capability_code AS value_stream,
  cap.capability_code,
  cap.name AS cap_name,
  cap.status
FROM journeys vs
LEFT JOIN journeys cap ON cap.parent_journey_id = vs.id
WHERE vs.parent_journey_id IS NULL
  AND vs.biz_area = 'cecelia'
  AND vs.status = 'active'
ORDER BY vs.capability_code, cap.capability_code;
" 2>/dev/null || info "树形视图查询失败（可能 Migration 397 未执行）"
echo ""

# ============================================================
# 汇总
# ============================================================
echo "============================================================"
echo "验收汇总："
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
echo "============================================================"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}所有验收条件通过！${NC}"
  exit 0
else
  echo -e "${RED}有 $FAIL_COUNT 个条件失败，禁止 merge${NC}"
  exit 1
fi
