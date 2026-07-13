#!/usr/bin/env bash
# smoke: PATCH tasks result 补写三件套的代码面断言（CI 兼容，不起服务）
# issue a638f840 / 45dd6925 regression guards
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node -e "
const fs = require('fs');
const tasks = fs.readFileSync('packages/brain/src/routes/tasks.js','utf8');
if (!tasks.includes(\"result = COALESCE(result, '{}'::jsonb)\")) { console.error('FAIL: tasks.js 缺 result COALESCE 写入'); process.exit(1); }
if (!tasks.includes('isStatusNoop')) { console.error('FAIL: tasks.js 缺幂等 no-op 分支'); process.exit(1); }
const inits = fs.readFileSync('packages/brain/src/routes/initiatives.js','utf8');
if (!inits.includes('current_task_id = ')) { console.error('FAIL: initiatives.js 缺 task_id 过滤'); process.exit(1); }
const relay = fs.readFileSync('packages/brain/src/harness-skill-relay.js','utf8');
if ((relay.match(/jsonb_build_object\('sprint_dir'/g) || []).length < 2) { console.error('FAIL: skill-relay sprint_dir 持久化少于两处'); process.exit(1); }
console.log('OK: task-result-backfill smoke passed');
"
