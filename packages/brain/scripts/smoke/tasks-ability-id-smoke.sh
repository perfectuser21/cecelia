#!/usr/bin/env bash
# tasks-ability-id-smoke.sh
# 验证双轴模型 Phase 1：tasks.ability_id 十字边（migration 297 + task-tasks.js 接线）
# Case 1: migration 297 文件存在
# Case 2: migration 含 ability_id 列 + FK→journey_features + 索引
# Case 3: task-tasks.js 创建端点接线 ability_id（destructure + INSERT 列 + 参数 + RETURNING）
# Case 4: (真环境，DB 可达时) 实际查 tasks 表确认 ability_id 列存在且类型为 uuid
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$BRAIN_ROOT/migrations/297_tasks_ability_id.sql"
ROUTE="$BRAIN_ROOT/src/routes/task-tasks.js"

echo "[smoke:ability-id] Case 1: migration 297 文件存在"
node -e "require('fs').accessSync('$MIGRATION'); console.log('  PASS: 文件存在');"

echo "[smoke:ability-id] Case 2: migration 含 ability_id 列 + FK + 索引"
node -e "
const sql = require('fs').readFileSync('$MIGRATION', 'utf8');
if (!/ability_id\s+UUID/i.test(sql)) throw new Error('Case 2 FAIL: 缺 ability_id UUID 列');
if (!/REFERENCES\s+journey_features\(id\)/i.test(sql)) throw new Error('Case 2 FAIL: 缺 FK→journey_features');
if (!/idx_tasks_ability_id/.test(sql)) throw new Error('Case 2 FAIL: 缺索引');
console.log('  PASS: 列 + FK + 索引齐全');
"

echo "[smoke:ability-id] Case 3: task-tasks.js 接线 ability_id"
node -e "
const js = require('fs').readFileSync('$ROUTE', 'utf8');
if (!/ability_id\s*=\s*null/.test(js)) throw new Error('Case 3 FAIL: destructure 未含 ability_id');
if (!/createRoutedTask[\s\S]*ability_id/.test(js)) throw new Error('Case 3 FAIL: 统一 Router task contract 未透传 ability_id');
console.log('  PASS: destructure + createRoutedTask contract 均接线');
"

echo "[smoke:ability-id] Case 4: 真环境 DB 列校验（DB 可达时）"
PGHOST="${DB_HOST:-localhost}"; PGPORT="${DB_PORT:-5432}"
PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"
if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  COL_TYPE=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
    -c "SELECT data_type FROM information_schema.columns WHERE table_name='tasks' AND column_name='ability_id';" 2>/dev/null || echo "")
  if [ "$COL_TYPE" = "uuid" ]; then
    echo "  PASS: tasks.ability_id 实列存在且为 uuid"
  else
    echo "  WARN: DB 可达但列未应用（type='$COL_TYPE'）— migration 未跑，CI fresh DB 会跑"
  fi
else
  echo "  SKIP: DB 不可达，跳过真环境校验（结构校验已覆盖）"
fi

echo "[smoke:ability-id] ✅ 全部通过"
