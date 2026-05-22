#!/bin/bash
# dev-registry-smoke.sh — Dev Management Tables 真环境验证
set -e
DB="postgresql://localhost/cecelia"

echo "[smoke] 验证 7 张表存在..."
for TABLE in journeys journey_steps journey_features api_registry db_schema_registry test_registry issues; do
  COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='$TABLE'" | tr -d ' \n')
  [ "$COUNT" = "1" ] || { echo "FAIL: 表 $TABLE 不存在"; exit 1; }
done
echo "  ✓ 7 张表全部存在"

echo "[smoke] 验证扫描数据填充..."
API_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM api_registry" | tr -d ' \n')
[ "$API_COUNT" -gt 0 ] || { echo "FAIL: api_registry 为空"; exit 1; }

DB_TASKS=$(psql "$DB" -t -c "SELECT COUNT(*) FROM db_schema_registry WHERE table_name='tasks'" | tr -d ' \n')
[ "$DB_TASKS" -gt 0 ] || { echo "FAIL: db_schema_registry 缺 tasks 表"; exit 1; }

TEST_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM test_registry" | tr -d ' \n')
[ "$TEST_COUNT" -gt 0 ] || { echo "FAIL: test_registry 为空"; exit 1; }

echo "  ✓ 扫描数据已填充 api=$API_COUNT, tests=$TEST_COUNT"

echo "[smoke] 验证 Notion 同步数据..."
J_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM journeys WHERE notion_id IS NOT NULL" | tr -d ' \n')
[ "$J_COUNT" -gt 0 ] || { echo "FAIL: journeys 无 Notion 数据"; exit 1; }

I_COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM issues WHERE notion_id IS NOT NULL" | tr -d ' \n')
[ "$I_COUNT" -gt 0 ] || { echo "FAIL: issues 无 Notion 数据"; exit 1; }

echo "  ✓ Notion 同步数据就绪 journeys=$J_COUNT, issues=$I_COUNT"

echo "✅ dev-registry smoke 全部通过"
