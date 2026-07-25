#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/packages/brain/scripts/cleanup-conversation-captures.sh"
DB_NAME="${DB_NAME:-cecelia_test}"
case "$DB_NAME" in
  *_test|*_scratch) ;;
  *) echo "FAIL: cleanup test 只允许测试库，当前 DB_NAME=$DB_NAME" >&2; exit 1 ;;
esac

TMP_ROOT="$(mktemp -d)"
SCHEMA="cleanup_contract_$$_${RANDOM}"
export PGOPTIONS="-c search_path=$SCHEMA"
trap 'PGOPTIONS= psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS \"$SCHEMA\" CASCADE" >/dev/null 2>&1 || true; rm -rf "$TMP_ROOT"' EXIT

PGOPTIONS= psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL >/dev/null
CREATE SCHEMA "$SCHEMA";
CREATE TABLE "$SCHEMA".captures (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  content TEXT
);
INSERT INTO "$SCHEMA".captures(source, content) VALUES
  ('conversation-claude', 'machine transcript'),
  ('conversation-codex', 'worker transcript'),
  ('handoff', 'must survive');
SQL

if bash "$SCRIPT" --backup-dir "$TMP_ROOT/backup" >/dev/null 2>&1; then
  echo "FAIL: 无 --confirm 时不应成功" >&2
  exit 1
fi

touch "$TMP_ROOT/not-a-directory"
if bash "$SCRIPT" --confirm --backup-dir "$TMP_ROOT/not-a-directory/backup" >/dev/null 2>&1; then
  echo "FAIL: 备份失败时不应成功" >&2
  exit 1
fi
[[ "$(psql -X -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM captures WHERE source LIKE 'conversation%';")" == "2" ]]

OUTPUT="$(bash "$SCRIPT" --confirm --backup-dir "$TMP_ROOT/backup")"
printf '%s\n' "$OUTPUT"
grep -Eq 'before=2 backed_up=2 deleted=2 after=0' <<<"$OUTPUT"
[[ "$(psql -X -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM captures WHERE source = 'handoff';")" == "1" ]]
BACKUP_FILE="$(sed -n 's/^backup_path=//p' <<<"$OUTPUT")"
[[ -s "$BACKUP_FILE" ]]

echo "OK: cleanup SOP backup/delete guard passed"
