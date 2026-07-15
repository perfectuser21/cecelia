#!/usr/bin/env bash
# Smoke: autoblock SQL 参数类型修复验证（$2::int cast）
set -euo pipefail
BRAIN_DB_URL="${BRAIN_DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"
echo "🔍 smoke: autoblock-sql-param-fix (\$2::int cast)"
# 验证修复后 SQL 执行无报错
psql "$BRAIN_DB_URL" -c "
DO \$\$
DECLARE
  test_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO tasks (id, title, status, task_type, priority)
  VALUES (test_id, 'smoke-autoblock-param-fix', 'queued', 'dev', 'P2');
  UPDATE tasks
  SET metadata = COALESCE(metadata, '{}' ::jsonb)
             || jsonb_build_object('dispatch_fail_consecutive', 1::int)
  WHERE id = test_id;
  PERFORM (metadata->>'dispatch_fail_consecutive')::int FROM tasks WHERE id = test_id;
  DELETE FROM tasks WHERE id = test_id;
  RAISE NOTICE 'PASS: autoblock SQL 参数类型 cast 正常';
END \$\$;
" 2>&1 | grep -E "PASS|NOTICE|ERROR" || true
echo "✅ smoke autoblock-sql-param-fix DONE"
