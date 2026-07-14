#!/usr/bin/env bash
# migrate-341-bare-tables.sh — 补做 migration 341
#
# 背景：schema_version 记录 341 已完成，但实际 5 张 Better Auth 裸表
# （user/session/account/verification/operator_sessions）仍在 cecelia 库
# public schema，独立 zenithjoy 库里没有这5张表。
# 决策依据：initiative 0935f962 + decision 92b45f80（用户拍板方案a）
#
# 用法：bash scripts/migrate-341-bare-tables.sh
# 前提：本机可直连 localhost postgres，cecelia 库和独立 zenithjoy 库均已存在

set -euo pipefail

PSQL="psql -q"
CECELIA_DB="cecelia"
ZJ_DB="zenithjoy"
TABLES=(operator_sessions verification account session "user")
BACKUP_DIR="/tmp/migrate-341-backup-$(date +%s)"
MIGRATION_SQL="packages/brain/migrations/341_zenithjoy_schema_move.sql"

mkdir -p "$BACKUP_DIR"
echo "=== Step 1: 备份 cecelia 库 5 张裸表到 $BACKUP_DIR ==="
for TABLE in "${TABLES[@]}"; do
  $PSQL -h localhost -U cecelia -d "$CECELIA_DB" \
    -c "\copy (SELECT * FROM public.\"$TABLE\") TO '$BACKUP_DIR/$TABLE.csv' WITH CSV HEADER"
  echo "  ✅ 备份 $TABLE"
done

echo ""
echo "=== Step 2: 执行 migration 341（幂等，SET SCHEMA） ==="
$PSQL -h localhost -U cecelia -d "$CECELIA_DB" -f "$MIGRATION_SQL"

echo ""
echo "=== Step 3: 校验 cecelia 库 5 张表已在 zenithjoy schema ==="
for TABLE in "${TABLES[@]}"; do
  SCHEMA=$($PSQL -h localhost -U cecelia -d "$CECELIA_DB" -tc \
    "SELECT table_schema FROM information_schema.tables WHERE table_name='$TABLE' AND table_schema IN ('public','zenithjoy');" \
    | tr -d ' ')
  if [ "$SCHEMA" != "zenithjoy" ]; then
    echo "  ❌ $TABLE 迁移后仍不在 zenithjoy schema（实际: $SCHEMA），中止"
    exit 1
  fi
  echo "  ✅ $TABLE 已在 zenithjoy schema"
done

echo ""
echo "=== Step 4: 导出 cecelia.zenithjoy 5 张表（schema+data） ==="
DUMP_FILE="$BACKUP_DIR/export.sql"
DUMP_ARGS=()
for TABLE in "${TABLES[@]}"; do
  DUMP_ARGS+=(-t "zenithjoy.\"$TABLE\"")
done
pg_dump -h localhost -U cecelia -d "$CECELIA_DB" -n zenithjoy \
  "${DUMP_ARGS[@]}" --no-owner --no-privileges \
  | grep -v '^CREATE SCHEMA' > "$DUMP_FILE"
echo "  ✅ 导出到 $DUMP_FILE"

echo ""
echo "=== Step 5: 导入独立 zenithjoy 库 ==="
$PSQL -h localhost -U cecelia -d "$ZJ_DB" -c "CREATE SCHEMA IF NOT EXISTS zenithjoy;"
$PSQL -h localhost -U cecelia -d "$ZJ_DB" -f "$DUMP_FILE"
echo "  ✅ 导入完成"

echo ""
echo "=== Step 6: 行数校验（cecelia.zenithjoy vs 独立zenithjoy库.zenithjoy） ==="
ALL_OK=true
for TABLE in "${TABLES[@]}"; do
  CECELIA_COUNT=$($PSQL -h localhost -U cecelia -d "$CECELIA_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" | tr -d ' ')
  ZJ_COUNT=$($PSQL -h localhost -U cecelia -d "$ZJ_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" | tr -d ' ')
  if [ "$CECELIA_COUNT" != "$ZJ_COUNT" ]; then
    echo "  ❌ $TABLE 行数不一致: cecelia=$CECELIA_COUNT zenithjoy=$ZJ_COUNT"
    ALL_OK=false
  else
    echo "  ✅ $TABLE 行数一致: $CECELIA_COUNT"
  fi
done

echo ""
if [ "$ALL_OK" = "true" ]; then
  echo "✅ 迁移完成，两库数据一致。备份保留在 $BACKUP_DIR"
  exit 0
else
  echo "❌ 行数校验失败，请人工排查（备份在 $BACKUP_DIR，未自动回滚）"
  exit 1
fi
