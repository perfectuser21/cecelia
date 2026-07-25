#!/usr/bin/env bash
set -euo pipefail

CONFIRM=0
BACKUP_DIR=""
DB_NAME="${DB_NAME:-cecelia}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm)
      CONFIRM=1
      shift
      ;;
    --backup-dir)
      BACKUP_DIR="${2:-}"
      shift 2
      ;;
    --database)
      DB_NAME="${2:-}"
      shift 2
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$CONFIRM" != "1" ]]; then
  echo "拒绝执行：必须显式传入 --confirm" >&2
  exit 2
fi
if [[ -z "$BACKUP_DIR" || "$BACKUP_DIR" != /* ]]; then
  echo "拒绝执行：--backup-dir 必须是仓库外的绝对路径" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
case "$BACKUP_DIR/" in
  "$REPO_ROOT"/*)
    echo "拒绝执行：备份目录必须位于仓库外" >&2
    exit 2
    ;;
esac

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/conversation-captures-$STAMP.csv"

psql_scalar() {
  psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" -tAc "$1"
}

before="$(psql_scalar "SELECT COUNT(*) FROM captures WHERE source LIKE 'conversation%';")"

psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" -c \
  "\\copy (SELECT * FROM captures WHERE source LIKE 'conversation%' ORDER BY id) TO '$BACKUP_FILE' CSV HEADER" \
  >/dev/null

if [[ "$before" -gt 0 && ! -s "$BACKUP_FILE" ]]; then
  echo "备份失败：源数据非零但 CSV 为空，未执行 DELETE" >&2
  exit 1
fi

backed_up="$before"
deleted="$(psql_scalar "WITH deleted AS (DELETE FROM captures WHERE source LIKE 'conversation%' RETURNING 1) SELECT COUNT(*) FROM deleted;")"
after="$(psql_scalar "SELECT COUNT(*) FROM captures WHERE source LIKE 'conversation%';")"

echo "backup_path=$BACKUP_FILE"
echo "before=$before backed_up=$backed_up deleted=$deleted after=$after"
