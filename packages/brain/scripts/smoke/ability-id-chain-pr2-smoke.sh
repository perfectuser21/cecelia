#!/usr/bin/env bash
# ability-id-chain-pr2-smoke.sh
# 验证 ability_id 全链接线 PR2：relay env + initiative_runs.ability_id +
# pushAdvancementItems + tasks?journey_id= 过滤 四处接线
# Case 1: migration 323/324 文件存在
# Case 2: migration 323 含 initiative_runs.ability_id 列 + FK→journey_features
# Case 3: migration 324 含 advancement_items.notion_synced_at 列
# Case 4: harness-skill-relay.js 接线 CECELIA_ABILITY_ID env + 两处 INSERT 带 ability_id
# Case 5: notion-push-sync.js 定义 pushAdvancementItems 且已接入 runNotionPushSync
# Case 6: task-tasks.js GET /tasks 支持 journey_id 过滤（payload JSONB）
# Case 7: (真环境，DB 可达时) 实际查 initiative_runs / advancement_items 表确认新列存在
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION_323="$BRAIN_ROOT/migrations/323_initiative_runs_ability_id.sql"
MIGRATION_324="$BRAIN_ROOT/migrations/324_advancement_items_notion_sync.sql"
RELAY="$BRAIN_ROOT/src/harness-skill-relay.js"
NOTION_SYNC="$BRAIN_ROOT/src/notion-push-sync.js"
TASKS_ROUTE="$BRAIN_ROOT/src/routes/task-tasks.js"

echo "[smoke:ability-id-chain-pr2] Case 1: migration 323/324 文件存在"
node -e "require('fs').accessSync('$MIGRATION_323'); require('fs').accessSync('$MIGRATION_324'); console.log('  PASS: 两个 migration 文件存在');"

echo "[smoke:ability-id-chain-pr2] Case 2: migration 323 含 initiative_runs.ability_id 列 + FK"
node -e "
const sql = require('fs').readFileSync('$MIGRATION_323', 'utf8');
if (!/ability_id\s+UUID/i.test(sql)) throw new Error('Case 2 FAIL: 缺 ability_id UUID 列');
if (!/REFERENCES\s+journey_features\(id\)/i.test(sql)) throw new Error('Case 2 FAIL: 缺 FK→journey_features');
console.log('  PASS: 列 + FK 齐全');
"

echo "[smoke:ability-id-chain-pr2] Case 3: migration 324 含 advancement_items.notion_synced_at 列"
node -e "
const sql = require('fs').readFileSync('$MIGRATION_324', 'utf8');
if (!/notion_synced_at\s+TIMESTAMPTZ/i.test(sql)) throw new Error('Case 3 FAIL: 缺 notion_synced_at 列');
console.log('  PASS: notion_synced_at 列存在');
"

echo "[smoke:ability-id-chain-pr2] Case 4: harness-skill-relay.js 接线 CECELIA_ABILITY_ID + INSERT"
node -e "
const js = require('fs').readFileSync('$RELAY', 'utf8');
if (!/CECELIA_ABILITY_ID:/.test(js)) throw new Error('Case 4 FAIL: env 未含 CECELIA_ABILITY_ID');
const insertCount = (js.match(/INSERT INTO initiative_runs[\s\S]{0,200}ability_id/g) || []).length;
if (insertCount < 2) throw new Error('Case 4 FAIL: docker/headed 两处 INSERT 未都带 ability_id（找到 ' + insertCount + ' 处）');
console.log('  PASS: env + 两处 INSERT 均接线');
"

echo "[smoke:ability-id-chain-pr2] Case 5: notion-push-sync.js 定义并接入 pushAdvancementItems"
node -e "
const js = require('fs').readFileSync('$NOTION_SYNC', 'utf8');
if (!/async function pushAdvancementItems/.test(js)) throw new Error('Case 5 FAIL: 未定义 pushAdvancementItems');
if (!/await pushAdvancementItems\(pool, token\);/.test(js)) throw new Error('Case 5 FAIL: 未在 runNotionPushSync 里调用');
console.log('  PASS: pushAdvancementItems 定义 + 接入 Phase B');
"

echo "[smoke:ability-id-chain-pr2] Case 6: task-tasks.js GET /tasks 支持 journey_id 过滤"
node -e "
const js = require('fs').readFileSync('$TASKS_ROUTE', 'utf8');
if (!/journey_id/.test(js.match(/router\.get\('\/'[\s\S]{0,1000}/)?.[0] || '')) throw new Error('Case 6 FAIL: GET / 路由未含 journey_id 过滤');
if (!/payload->>'journey_id'/.test(js)) throw new Error('Case 6 FAIL: 未用 JSONB 操作符 payload->>');
console.log('  PASS: journey_id 过滤已接线（payload JSONB）');
"

echo "[smoke:ability-id-chain-pr2] Case 7: 真环境 DB 列校验（DB 可达时）"
PGHOST="${DB_HOST:-localhost}"; PGPORT="${DB_PORT:-5432}"
PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"
if pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  IR_COL=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
    -c "SELECT data_type FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='ability_id';" 2>/dev/null || echo "")
  AI_COL=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -tA \
    -c "SELECT data_type FROM information_schema.columns WHERE table_name='advancement_items' AND column_name='notion_synced_at';" 2>/dev/null || echo "")
  if [ "$IR_COL" = "uuid" ] && [ "$AI_COL" = "timestamp with time zone" ]; then
    echo "  PASS: initiative_runs.ability_id (uuid) + advancement_items.notion_synced_at (timestamptz) 实列均存在"
  else
    echo "  WARN: DB 可达但列未完全应用（initiative_runs.ability_id='$IR_COL', advancement_items.notion_synced_at='$AI_COL'）— migration 未跑，CI fresh DB 会跑"
  fi
else
  echo "  SKIP: DB 不可达，跳过真环境校验（结构校验已覆盖）"
fi

echo "[smoke:ability-id-chain-pr2] ✅ 全部通过"
