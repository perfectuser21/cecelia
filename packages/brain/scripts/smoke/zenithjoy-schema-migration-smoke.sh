#!/usr/bin/env bash
# Smoke: migration 341 不含 ALTER DATABASE 全局副作用（P0 事故修复验证）
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

MIGRATION_FILE="packages/brain/migrations/341_zenithjoy_schema_move.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "FAIL: $MIGRATION_FILE 不存在"
  exit 1
fi

if grep -qi "ALTER DATABASE" "$MIGRATION_FILE"; then
  echo "FAIL: $MIGRATION_FILE 含 ALTER DATABASE（P0 事故根因语句复发）"
  exit 1
fi
echo "OK: migration 341 不含 ALTER DATABASE"

for table in operator_sessions verification account session; do
  if ! grep -qi "ALTER TABLE public.$table SET SCHEMA zenithjoy" "$MIGRATION_FILE"; then
    echo "FAIL: 缺少 $table 的 SET SCHEMA zenithjoy 语句"
    exit 1
  fi
done
if ! grep -qi 'ALTER TABLE public."user" SET SCHEMA zenithjoy' "$MIGRATION_FILE"; then
  echo "FAIL: 缺少 user 的 SET SCHEMA zenithjoy 语句"
  exit 1
fi
echo "OK: 5 张裸表归位语句完整"

echo "✅ zenithjoy-schema-migration-smoke 全部通过"
