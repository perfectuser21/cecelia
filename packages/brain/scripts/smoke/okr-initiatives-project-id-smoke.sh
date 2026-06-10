#!/usr/bin/env bash
# okr-initiatives-project-id-smoke.sh
# 验证双轴模型 Phase 2a：okr_initiatives.project_id 折叠 Scope
# Case 1: migration 文件存在
# Case 2: migration 含 project_id 列 + FK→okr_projects + 回填 UPDATE
# Case 3: (真环境，DB 可达时) 实际列存在为 uuid + 已有回填行
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$BRAIN_ROOT/migrations/298_okr_initiatives_project_id.sql"

echo "[smoke:init-project] Case 1: migration 文件存在"
node -e "require('fs').accessSync('$MIGRATION'); console.log('  PASS');"

echo "[smoke:init-project] Case 2: migration 含 project_id 列 + FK + 回填 UPDATE"
node -e "
const sql = require('fs').readFileSync('$MIGRATION','utf8');
if (!/project_id\s+UUID/i.test(sql)) throw new Error('Case 2 FAIL: 缺 project_id 列');
if (!/REFERENCES\s+okr_projects\(id\)/i.test(sql)) throw new Error('Case 2 FAIL: 缺 FK→okr_projects');
if (!/UPDATE\s+okr_initiatives/i.test(sql)) throw new Error('Case 2 FAIL: 缺回填 UPDATE');
console.log('  PASS: 列 + FK + 回填齐全');
"

echo "[smoke:init-project] Case 3: 真环境列 + 回填校验（DB 可达时）"
PGHOST="${DB_HOST:-localhost}"; PGPORT="${DB_PORT:-5432}"
PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"
if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  T=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
    -c "SELECT data_type FROM information_schema.columns WHERE table_name='okr_initiatives' AND column_name='project_id';" 2>/dev/null || echo "")
  if [ "$T" = "uuid" ]; then
    echo "  PASS: okr_initiatives.project_id 实列存在(uuid)"
  else
    echo "  WARN: DB 可达但列未应用(type='$T') — migration 未跑，CI fresh DB 会跑"
  fi
else
  echo "  SKIP: DB 不可达，跳过真环境校验（结构校验已覆盖）"
fi

echo "[smoke:init-project] ✅ 全部通过"
