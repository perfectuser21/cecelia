#!/usr/bin/env bash
# packages/brain/scripts/smoke/goal-condition-smoke.sh
# 验证 goal_condition 字段存在 + executor buildGoalSettings 可用
set -euo pipefail

BRAIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../src" && pwd)"

# Build DATABASE_URL from CI env vars if available (same pattern as harness-executor-reliability-smoke.sh)
if [ -n "${DATABASE_URL:-}" ]; then
  DB_URL="$DATABASE_URL"
elif [ -n "${DB_NAME:-}" ] && [ -n "${DB_USER:-}" ]; then
  DB_URL="postgresql://${DB_USER}:${DB_PASSWORD:-}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME}"
else
  DB_URL="postgresql://cecelia@localhost:5432/cecelia"
fi

echo "[smoke:goal-condition] starting..."

# 1. goal_condition 列存在（需要先跑 migration 281）
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke:goal-condition] SKIP — DB 不可达 ($DB_URL)"
  exit 0
fi

COL=$(psql "$DB_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name='goal_condition'" 2>/dev/null || echo "")
if [ -z "$COL" ]; then
  echo "[smoke] FAIL: goal_condition column missing in tasks table (migration 281 not applied?)"
  exit 1
fi
echo "[smoke] goal_condition column exists ✓"

# 2. buildGoalSettings 导出 + 结构正确
node -e "
const {buildGoalSettings} = require('$BRAIN_SRC/executor.js');
if (buildGoalSettings(null) !== null) { console.error('[smoke] FAIL: null input should return null'); process.exit(1); }
const result = buildGoalSettings('PR has been merged');
if (!result) { console.error('[smoke] FAIL: buildGoalSettings returned null for non-empty condition'); process.exit(1); }
const parsed = JSON.parse(result);
const hook = parsed.hooks.Stop[0].hooks[0];
if (hook.type !== 'prompt') { console.error('[smoke] FAIL: expected type=prompt, got', hook.type); process.exit(1); }
if (hook.model !== 'claude-haiku-4-5-20251001') { console.error('[smoke] FAIL: wrong model:', hook.model); process.exit(1); }
if (!hook.prompt.includes('PR has been merged')) { console.error('[smoke] FAIL: prompt missing goal condition'); process.exit(1); }
console.log('[smoke] buildGoalSettings structure correct ✓');
"

echo "[smoke:goal-condition] PASS ✓"
