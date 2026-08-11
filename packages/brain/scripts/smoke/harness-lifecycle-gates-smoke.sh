#!/usr/bin/env bash
# smoke: harness-lifecycle-gates 代码闸真实在位（刀B/C/收账权收归，决策 dc18d43d 无闸不成文）
# task f35db586 dogfooding 全链实证：behavior_tests=0 照样 PASS/judgments_written 虚报/callback 提前收账/judge_verdict 不落库
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node -e "
const fs = require('fs');
const judge = fs.readFileSync('packages/brain/src/harness-judge.js','utf8');
if (!/runMechanicalGate/.test(judge)) { console.error('FAIL: 机械闸缺失'); process.exit(1); }
const relay = fs.readFileSync('packages/brain/src/harness-skill-relay.js','utf8');
const inserts = relay.match(/INSERT INTO initiative_runs[\s\S]{0,400}?VALUES/g) || [];
if (inserts.length < 2 || !inserts.every((s) => /current_task_id/.test(s))) { console.error('FAIL: INSERT 缺 current_task_id'); process.exit(1); }
const fin = fs.readFileSync('packages/brain/src/lib/harness-finalize.js','utf8');
if (!/finalizeHarnessTask/.test(fin)) { console.error('FAIL: finalize 缺失'); process.exit(1); }
for (const f of ['packages/brain/src/callback-processor.js','packages/brain/src/routes/tasks.js','packages/brain/src/routes/harness.js']) {
  if (!/finalizeHarnessTask|harness-finalize/.test(fs.readFileSync(f,'utf8'))) { console.error('FAIL: ' + f + ' 未接 finalize'); process.exit(1); }
}
const taskTasks = fs.readFileSync('packages/brain/src/routes/task-tasks.js','utf8');
const taskPatch = fs.readFileSync('packages/brain/src/routes/task-task-patch.js','utf8');
if (!/registerTaskPatchRoute/.test(taskTasks) || !/finalizeHarnessTask|harness-finalize/.test(taskPatch)) {
  console.error('FAIL: task PATCH 委托链未接 finalize'); process.exit(1);
}
const wd = fs.readFileSync('packages/brain/src/harness-relay-watchdog.js','utf8');
if (!/GENERATOR_DONE_TIMEOUT_MS/.test(wd) || !/skill-relay-spawn/.test(wd)) { console.error('FAIL: watchdog 闸缺失'); process.exit(1); }
const mig = fs.readFileSync('packages/brain/migrations/342_decisions_source_ref.sql','utf8');
if (!/source_ref/.test(mig)) { console.error('FAIL: migration 342 缺失'); process.exit(1); }
console.log('OK: harness-lifecycle-gates smoke passed');
"
