#!/usr/bin/env bash
# packages/brain/scripts/smoke/goal-condition-smoke.sh
# 验证 goal_condition 字段存在 + executor buildGoalSettings 可用
set -euo pipefail

BRAIN_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../src" && pwd)"
echo "[smoke:goal-condition] starting..."

# 1. goal_condition 列存在（需要先跑 migration 281）
node -e "
const {Pool} = require('pg');
const pool = new Pool({database:'cecelia',host:'localhost',port:5432,user:'postgres'});
pool.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name='goal_condition'\")
  .then(r => {
    if (r.rows.length === 0) { console.error('[smoke] FAIL: goal_condition column missing'); process.exit(1); }
    console.log('[smoke] goal_condition column exists ✓');
    return pool.end();
  })
  .catch(e => { console.error('[smoke] FAIL:', e.message); process.exit(1); });
"

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
