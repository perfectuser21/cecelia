#!/usr/bin/env bash
# Smoke: learning-action-task-binding — Cortex Insight learning 强制绑定 action_task_id
# 背景：migration 271 闭合 Insight→Action 断裂（8 天/106 次可预防失败）
set -euo pipefail

echo "[lat-binding-smoke] 1. migration 271 存在且含 action_task_id 列"
node -e "
const fs = require('fs');
const f = 'packages/brain/migrations/271_learnings_action_task_id.sql';
if (!fs.existsSync(f)) { console.error('FAIL: migration 271 不存在'); process.exit(1); }
const sql = fs.readFileSync(f, 'utf8');
const required = ['action_task_id', 'REFERENCES tasks', 'ON DELETE SET NULL', 'idx_learnings_action_task_id'];
const missing = required.filter(s => !sql.includes(s));
if (missing.length) { console.error('FAIL: migration 缺少:', missing.join(', ')); process.exit(1); }
console.log('migration 271 完整 ✓');
"

echo "[lat-binding-smoke] 2. cortex.js: hasCodeFixSignal gate 不再静默放过 cortex_insight"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/cortex.js', 'utf8');
// 关键断言：maybeCreateInsightTask 函数体内不应再含 \`if (!hasCodeFixSignal(...)) return;\` 早返回
const fnMatch = src.match(/async function maybeCreateInsightTask[\s\S]*?^\}/m);
if (!fnMatch) { console.error('FAIL: maybeCreateInsightTask 函数未找到'); process.exit(1); }
if (/if\s*\(\s*!hasCodeFixSignal\([^)]+\)\s*\)\s*\{?\s*return\s*;[^\n]*无代码修复信号/.test(fnMatch[0])) {
  console.error('FAIL: hasCodeFixSignal 静默 gate 仍然存在'); process.exit(1);
}
if (!/return\s+taskId/.test(fnMatch[0])) {
  console.error('FAIL: maybeCreateInsightTask 应 return taskId'); process.exit(1);
}
if (!/bindActionTaskOrFlagUnbound/.test(src)) {
  console.error('FAIL: cortex.js 缺少 bindActionTaskOrFlagUnbound'); process.exit(1);
}
if (!/learning_unbound/.test(src)) {
  console.error('FAIL: cortex.js 缺少 learning_unbound 告警事件'); process.exit(1);
}
console.log('cortex.js 闭环正确 ✓');
"

echo "[lat-binding-smoke] 3. routes/tasks.js: /learnings-received INSERT 含 action_task_id"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/tasks.js', 'utf8');
const insertMatch = src.match(/INSERT INTO learnings\s*\(([\s\S]*?)\)\s*VALUES/);
if (!insertMatch) { console.error('FAIL: INSERT INTO learnings 未找到'); process.exit(1); }
if (!insertMatch[1].includes('action_task_id')) {
  console.error('FAIL: INSERT 列清单缺少 action_task_id'); process.exit(1);
}
if (!/task_id\s*\|\|\s*null/.test(src)) {
  console.error('FAIL: 参数数组应含 task_id || null'); process.exit(1);
}
console.log('learnings-received 持久化 task_id ✓');
"

echo "[lat-binding-smoke] 4. selfcheck.js EXPECTED_SCHEMA_VERSION = 271"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/selfcheck.js', 'utf8');
if (!/EXPECTED_SCHEMA_VERSION\s*=\s*'271'/.test(src)) {
  console.error('FAIL: EXPECTED_SCHEMA_VERSION 不是 271'); process.exit(1);
}
console.log('EXPECTED_SCHEMA_VERSION=271 ✓');
"

echo "[lat-binding-smoke] 全部检查通过 ✓"
