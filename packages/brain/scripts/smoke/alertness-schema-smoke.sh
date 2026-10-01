#!/usr/bin/env bash
# 被动实例依赖显式迁移准备 schema，不准靠启动后台评估器建表。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL must target test or scratch}"
DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).pathname.slice(1)))' "$DATABASE_URL")"
[[ "$DATABASE_NAME" =~ (_test|_scratch)$ ]] || { echo '拒绝连接非测试库'; exit 1; }
MIGRATION="$ROOT_DIR/packages/brain/migrations/500_alertness_schema.sql"
[[ -f "$MIGRATION" ]] || { echo 'FAIL: alertness schema migration missing'; exit 1; }
SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT
SCHEMA="smoke_alertness_${$}"
{
  printf 'BEGIN;\nCREATE SCHEMA %s;\nSET LOCAL search_path TO %s;\n' "$SCHEMA" "$SCHEMA"
  cat "$MIGRATION"
  cat <<'SQL'
INSERT INTO alertness_metrics(id,timestamp,metric_type,metric_value)
VALUES ('00000000-0000-0000-0000-000000000001',now(),'fixture',1);
INSERT INTO alertness_escalations(id,timestamp,from_level,to_level)
VALUES ('00000000-0000-0000-0000-000000000002',now(),0,1);
INSERT INTO self_healing_log(id,timestamp,success)
VALUES ('00000000-0000-0000-0000-000000000003',now(),true);
SQL
  cat "$MIGRATION"
  cat <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM alertness_metrics) <> 1
     OR (SELECT count(*) FROM alertness_escalations) <> 1
     OR (SELECT count(*) FROM self_healing_log) <> 1 THEN
    RAISE EXCEPTION '重复迁移丢失已有数据';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema()
       AND indexname IN ('idx_alertness_metrics_timestamp',
                        'idx_alertness_escalations_timestamp',
                        'idx_self_healing_log_timestamp')) <> 3 THEN
    RAISE EXCEPTION '缺少时间戳索引';
  END IF;
END $$;
ROLLBACK;
SQL
} > "$SQL_FILE"
psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE" >/dev/null
echo 'PASS: 被动实例 schema 显式迁移、三表可写、重跑不丢数据；测试事务已回滚'
