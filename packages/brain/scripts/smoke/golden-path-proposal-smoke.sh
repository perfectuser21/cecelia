#!/usr/bin/env bash
# Smoke: golden_path_proposal task_type 全链接线 — GP2/T2（DoD F2）
# 验证：
#   1. migration 335 存在且含 golden_path_proposal + schema_version INSERT
#   2. task-router 四表登记齐全
#   3. executor 派发分支 + EXECUTOR_KIND_FOR 打标
#   4. harness-skill-relay controllerSkillFor 映射（headless/headed 两处调用）
#   5. dispatcher 三防线（cap/lock/bridge）且不在 retired 集合
set -euo pipefail

echo "[golden-path-proposal-smoke] 1. migration 335 存在且内容正确"
node -e "
const fs = require('fs');
const sql = fs.readFileSync('packages/brain/migrations/335_golden_path_proposal_task_type.sql', 'utf8');
const checks = [
  [\"'golden_path_proposal'\", 'CHECK 含 golden_path_proposal'],
  ['tasks_task_type_check', '重建 tasks_task_type_check'],
  [\"VALUES ('335'\", 'schema_version INSERT 335'],
];
const missing = checks.filter(([p]) => !sql.includes(p));
if (missing.length > 0) { missing.forEach(([,d]) => console.error('FAIL: ' + d)); process.exit(1); }
console.log('migration 335 结构正确 ✓');
"

echo "[golden-path-proposal-smoke] 2. task-router 四表登记"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
const n = (src.match(/golden_path_proposal/g) || []).length;
if (n < 4) { console.error('FAIL: task-router 登记数 ' + n + ' < 4（VALID/SKILL/LOCATION/CAPABILITY 四表）'); process.exit(1); }
if (!src.includes(\"'golden_path_proposal': '/capability-controller'\")) { console.error('FAIL: SKILL_WHITELIST 映射缺失'); process.exit(1); }
console.log('task-router 四表登记齐全 ✓');
"

echo "[golden-path-proposal-smoke] 3. executor 派发分支 + 打标"
node -e "
const fs = require('fs');
const ex = fs.readFileSync('packages/brain/src/executor.js', 'utf8');
const ct = fs.readFileSync('packages/brain/src/executor-contracts.js', 'utf8');
if (!/task\.task_type === 'harness_initiative' \|\| task\.task_type === 'golden_path_proposal'/.test(ex)) { console.error('FAIL: dispatch 分支未扩'); process.exit(1); }
if (!/task\.task_type !== 'harness_initiative' &&\s*task\.task_type !== 'golden_path_proposal'/.test(ex)) { console.error('FAIL: override 排除未加'); process.exit(1); }
if (!ct.includes(\"golden_path_proposal: 'relay-container'\")) { console.error('FAIL: EXECUTOR_KIND_FOR 打标缺失'); process.exit(1); }
console.log('executor 派发接线正确 ✓');
"

echo "[golden-path-proposal-smoke] 4. relay controllerSkillFor 映射"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/harness-skill-relay.js', 'utf8');
if (!src.includes('export function controllerSkillFor')) { console.error('FAIL: controllerSkillFor 未导出'); process.exit(1); }
if (!src.includes(\"'capability-controller'\")) { console.error('FAIL: capability-controller 映射缺失'); process.exit(1); }
if (src.includes(\"loadSkill('harness-controller')\")) { console.error('FAIL: 仍有硬编码 loadSkill(harness-controller)'); process.exit(1); }
const n = (src.match(/loadSkill\(controllerSkillFor\(task\.task_type\)\)/g) || []).length;
if (n !== 2) { console.error('FAIL: controllerSkillFor 调用处 ' + n + ' != 2（headless+headed）'); process.exit(1); }
console.log('relay loadSkill 映射正确 ✓');
"

echo "[golden-path-proposal-smoke] 5. dispatcher 三防线"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/dispatcher.js', 'utf8');
if (!src.includes(\"task_type IN ('harness_initiative', 'golden_path_proposal')\")) { console.error('FAIL: cap 计数 SQL 口径未扩'); process.exit(1); }
const lock = src.match(/INITIATIVE_LOCK_TASK_TYPES = \[[\s\S]*?\]/)[0];
if (!lock.includes(\"'golden_path_proposal'\")) { console.error('FAIL: INITIATIVE_LOCK 缺失'); process.exit(1); }
if (!/nextTask\.task_type !== 'harness_initiative'\s*&&\s*nextTask\.task_type !== 'golden_path_proposal'/.test(src)) { console.error('FAIL: bridge 豁免缺失'); process.exit(1); }
const retired = src.match(/_RETIRED_HARNESS_TYPES_DISPATCH = new Set\(\[[\s\S]*?\]\)/)[0];
if (retired.includes('golden_path_proposal')) { console.error('FAIL: 误入 retired 集合'); process.exit(1); }
console.log('dispatcher 三防线正确 ✓');
"

echo "[golden-path-proposal-smoke] ✅ 全部通过"
