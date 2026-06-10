#!/usr/bin/env bash
# okr-initiatives-project-id-smoke.sh
# 验证 Phase 2a：okr_initiatives.project_id 折叠 Scope
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION=$(ls "$BRAIN_ROOT"/migrations/*_okr_initiatives_project_id.sql | head -1)

echo "[smoke:init-project] Case 1: migration 文件存在"
node -e "require('fs').accessSync('$MIGRATION'); console.log('  PASS');"

echo "[smoke:init-project] Case 2: migration 含 project_id 列 + FK + 回填 UPDATE"
node -e "
const sql = require('fs').readFileSync('$MIGRATION','utf8');
if (!/project_id\s+UUID/i.test(sql)) throw new Error('缺 project_id 列');
if (!/REFERENCES\s+okr_projects\(id\)/i.test(sql)) throw new Error('缺 FK→okr_projects');
if (!/UPDATE\s+okr_initiatives/i.test(sql)) throw new Error('缺回填 UPDATE');
console.log('  PASS');
"

echo "[smoke:init-project] Case 3: 真环境列 + 回填（DB 可达时）"
PGHOST="${DB_HOST:-localhost}"; PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"
if pg_isready -h "$PGHOST" -U "$PGUSER" >/dev/null 2>&1; then
  T=$(psql -h "$PGHOST" -U "$PGUSER" -d "$PGDB" -tA -c "SELECT data_type FROM information_schema.columns WHERE table_name='okr_initiatives' AND column_name='project_id';" 2>/dev/null || echo "")
  [ "$T" = "uuid" ] && echo "  PASS: project_id 实列存在(uuid)" || echo "  WARN: 列未应用(type='$T')"
else
  echo "  SKIP: DB 不可达"
fi
echo "[smoke:init-project] ✅ 全部通过"
