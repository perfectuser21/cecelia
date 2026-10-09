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

echo "[golden-path-proposal-smoke] 2. 路由注册表四表登记"
# PR1-B 起四张路由表已从 task-router.js 字面量搬进 lib/task-type-registry.js，
# 这里改成真 import 逐表求值（比原来数 grep 命中次数更准：4 次命中不保证落在四张表里）。
node --input-type=module -e "
import { VALID_TASK_TYPES, SKILL_WHITELIST, LOCATION_MAP, TASK_REQUIREMENTS } from './packages/brain/src/lib/task-type-registry.js';
const T = 'golden_path_proposal';
const missing = [];
if (!VALID_TASK_TYPES.includes(T)) missing.push('VALID_TASK_TYPES');
if (SKILL_WHITELIST[T] !== '/capability-controller') missing.push('SKILL_WHITELIST → /capability-controller');
if (!LOCATION_MAP[T]) missing.push('LOCATION_MAP');
if (!Array.isArray(TASK_REQUIREMENTS[T])) missing.push('TASK_REQUIREMENTS');
if (missing.length) { console.error('FAIL: ' + T + ' 未登记进: ' + missing.join(', ')); process.exit(1); }
console.log('注册表四表登记齐全 ✓');
"

echo "[golden-path-proposal-smoke] 3. executor 派发分支 + 打标"
node -e "
const fs = require('fs');
const ex = fs.readFileSync('packages/brain/src/executor.js', 'utf8');
const ct = fs.readFileSync('packages/brain/src/executor-contracts.js', 'utf8');
if (!/task\.task_type === 'harness_initiative' \|\| task\.task_type === 'golden_path_proposal'/.test(ex)) { console.error('FAIL: dispatch 分支未扩'); process.exit(1); }
if (!/task\.task_type !== 'harness_initiative' &&\s*task\.task_type !== 'golden_path_proposal'/.test(ex)) { console.error('FAIL: override 排除未加'); process.exit(1); }
if (!/task-type-registry\.js/.test(ct)) { console.error('FAIL: executor-contracts.js 未接入注册表'); process.exit(1); }
console.log('executor 派发接线正确 ✓');
"
# EXECUTOR_KIND_FOR 的打标已从 executor-contracts.js 字面量搬进注册表派生，改为真 import 求值
node --input-type=module -e "
import { EXECUTOR_KIND_FOR_TASK_TYPE } from './packages/brain/src/lib/task-type-registry.js';
if (EXECUTOR_KIND_FOR_TASK_TYPE['golden_path_proposal'] !== 'relay-container') {
  console.error('FAIL: EXECUTOR_KIND_FOR 打标缺失或不是 relay-container，实际 ' + EXECUTOR_KIND_FOR_TASK_TYPE['golden_path_proposal']);
  process.exit(1);
}
console.log('EXECUTOR_KIND_FOR 打标正确 ✓');
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
# PR1-B 起 cap 口径 / lock 名单 / retired 集合 / bridge 豁免都从 dispatcher.js 的字面量
# 搬进注册表派生（bridge 豁免现在就是 !HARNESS_INFLIGHT_TASK_TYPES.includes(...)），
# 三防线全部改为真 import 求值；额外断言 dispatcher.js 确实接上了注册表。
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { HARNESS_INFLIGHT_TASK_TYPES, INITIATIVE_LOCK_TASK_TYPES, RETIRED_HARNESS_TYPES_DISPATCH } from './packages/brain/src/lib/task-type-registry.js';
const T = 'golden_path_proposal';
// cap 计数口径与 bridge 豁免同源：都看 HARNESS_INFLIGHT_TASK_TYPES
if (!HARNESS_INFLIGHT_TASK_TYPES.includes(T)) { console.error('FAIL: cap 计数口径 / bridge 豁免（HARNESS_INFLIGHT_TASK_TYPES）未含 ' + T); process.exit(1); }
if (!INITIATIVE_LOCK_TASK_TYPES.includes(T)) { console.error('FAIL: INITIATIVE_LOCK 缺失'); process.exit(1); }
if (RETIRED_HARNESS_TYPES_DISPATCH.includes(T)) { console.error('FAIL: 误入 retired 集合'); process.exit(1); }
const src = readFileSync('packages/brain/src/dispatcher.js', 'utf8');
if (!/task-type-registry\.js/.test(src)) { console.error('FAIL: dispatcher.js 未接入注册表'); process.exit(1); }
if (!/needsBridgeCheck\s*=\s*!HARNESS_INFLIGHT_TASK_TYPES\.includes\(nextTask\.task_type\)/.test(src)) { console.error('FAIL: bridge 豁免未走 HARNESS_INFLIGHT_TASK_TYPES'); process.exit(1); }
console.log('dispatcher 三防线正确 ✓');
"

echo "[golden-path-proposal-smoke] ✅ 全部通过"
