#!/usr/bin/env bash
# migration-verify.sh — 验证 migration 354 + 355 执行结果
# task_id: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
# 用法: DATABASE_URL=<postgres_url> bash migration-verify.sh

set -euo pipefail
DB="${DATABASE_URL:-postgres://cecelia:cecelia@localhost:5432/cecelia}"

echo "=== 验证 migration 354: captures 字段扩展 ==="

# 检查 7 个新字段
FIELDS_354="nature repo lane ref_task_id ref_journey_id ref_pr_url dedupe_key"
MISSING_354=0
for field in $FIELDS_354; do
  COUNT=$(psql "$DB" -t -c "
    SELECT count(*) FROM information_schema.columns
    WHERE table_name='captures' AND column_name='$field'" | tr -d ' ')
  if [ "$COUNT" = "1" ]; then
    echo "  ✓ captures.$field 存在"
  else
    echo "  ✗ captures.$field 缺失"
    MISSING_354=$((MISSING_354+1))
  fi
done

# 检查 status 四态
echo ""
echo "=== 验证 captures.status 四态约束 ==="
STATUSES=$(psql "$DB" -t -c "SELECT DISTINCT status FROM captures ORDER BY status")
echo "  当前 status 值: $(echo $STATUSES | tr '\n' ' ')"

OLD_STATUS=$(psql "$DB" -t -c "
  SELECT count(*) FROM captures
  WHERE status IN ('inbox','processing','archived')" | tr -d ' ')
if [ "$OLD_STATUS" = "0" ]; then
  echo "  ✓ 无旧状态（inbox/processing/archived）残留"
else
  echo "  ✗ 仍有 $OLD_STATUS 条旧状态残留"
fi

echo ""
echo "=== 验证 migration 355: capture_atoms 字段扩展 ==="

FIELDS_355="nature repo lane retry_count"
MISSING_355=0
for field in $FIELDS_355; do
  COUNT=$(psql "$DB" -t -c "
    SELECT count(*) FROM information_schema.columns
    WHERE table_name='capture_atoms' AND column_name='$field'" | tr -d ' ')
  if [ "$COUNT" = "1" ]; then
    echo "  ✓ capture_atoms.$field 存在"
  else
    echo "  ✗ capture_atoms.$field 缺失"
    MISSING_355=$((MISSING_355+1))
  fi
done

# 验证 parked 状态存在
PARKED=$(psql "$DB" -t -c "
  SELECT count(*) FROM capture_atoms WHERE status='parked'" | tr -d ' ')
echo "  当前 parked 数: $PARKED"

echo ""
echo "=== 汇总 ==="
TOTAL_MISSING=$((MISSING_354 + MISSING_355))
if [ "$TOTAL_MISSING" = "0" ]; then
  echo "PASS: 所有字段验证通过"
  exit 0
else
  echo "FAIL: 缺失 $TOTAL_MISSING 个字段"
  exit 1
fi
