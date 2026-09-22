#!/usr/bin/env bash
# Smoke: task-type-registry — 秋米任务路由 PR1-A（task_type 单一事实源）
#
# 真环境验证四件事：
#   1. 注册表模块能被 node 真实 import，派生导出非空且冻结（不是空壳）
#   2. 真库 tasks 表可读，库里出现过的 task_type 逐条拿注册表比对，孤儿列出来
#   3. SSH_BASE_ARGS 已从 notion-push-sync.js 抽到 lib/ssh-args.js，生产文件真 import
#      （孤岛闸要求的那条入边，同时防"抽完没人用"的假重构）
#   4. 「注册表 vs 基线源码」审计脚本真跑一遍（基线 commit 在浅克隆里取不到才跳过）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

echo "[task-type-registry-smoke] 1. 注册表模块真 import + 派生导出非空冻结"
node --input-type=module -e "
import * as R from './packages/brain/src/lib/task-type-registry.js';
const mustBeNonEmptyFrozen = [
  'VALID_TASK_TYPES', 'SYSTEM_TASK_TYPES', 'CODING_TASK_TYPES',
  'TICK_DISPATCH_EXCLUDED', 'HARNESS_INFLIGHT_TASK_TYPES',
];
const bad = [];
for (const name of mustBeNonEmptyFrozen) {
  const v = R[name];
  if (!Array.isArray(v) || v.length === 0) { bad.push(name + ' 非数组或为空'); continue; }
  if (!Object.isFrozen(v)) bad.push(name + ' 未冻结（可被运行时篡改）');
}
if (typeof R.getTaskType !== 'function') bad.push('getTaskType 不是函数');
if (!Object.isFrozen(R.TASK_TYPE_REGISTRY)) bad.push('TASK_TYPE_REGISTRY 未冻结');
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('注册表 ' + Object.keys(R.TASK_TYPE_REGISTRY).length + ' 个 task_type，派生导出全部非空且冻结 ✓');
"

echo "[task-type-registry-smoke] 2. 真库 tasks 表 task_type 与注册表比对"
DB_TYPES=$(psql -At -c "SELECT DISTINCT task_type FROM tasks WHERE task_type IS NOT NULL ORDER BY 1" 2>&1) || {
  echo "FAIL: tasks 表读不到（真库连接或表缺失）：$DB_TYPES"
  exit 1
}
echo "$DB_TYPES" > /tmp/ttr-db-types.txt
echo "  库里出现过 $(grep -c . /tmp/ttr-db-types.txt || echo 0) 种 task_type"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { TASK_TYPE_REGISTRY } from './packages/brain/src/lib/task-type-registry.js';
const dbTypes = readFileSync('/tmp/ttr-db-types.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const orphans = dbTypes.filter((t) => !(t in TASK_TYPE_REGISTRY));
if (orphans.length) {
  console.log('  ⚠️ 库里有注册表未收录的 task_type（孤儿，需人工判定是历史残留还是漏收）:');
  orphans.forEach((t) => console.log('    - ' + t));
} else {
  console.log('  库里所有 task_type 均已收录进注册表 ✓');
}
"

echo "[task-type-registry-smoke] 3. SSH_BASE_ARGS 抽模块后生产文件真 import"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const consumer = readFileSync('packages/brain/src/notion-push-sync.js', 'utf8');
const bad = [];
if (!/import\s*\{[^}]*SSH_BASE_ARGS[^}]*\}\s*from\s*'\.\/lib\/ssh-args\.js'/.test(consumer)) {
  bad.push('notion-push-sync.js 未从 ./lib/ssh-args.js import SSH_BASE_ARGS');
}
if (/const\s+SSH_BASE_ARGS\s*=/.test(consumer)) {
  bad.push('notion-push-sync.js 仍在本地重新定义 SSH_BASE_ARGS（抽模块没抽干净）');
}
if (bad.length) { console.error('FAIL: ' + bad.join('; ')); process.exit(1); }
console.log('notion-push-sync.js 已改为 import lib/ssh-args.js，无重复定义 ✓');
"
node --input-type=module -e "
import { SSH_BASE_ARGS } from './packages/brain/src/lib/ssh-args.js';
const expected = ['-o','ControlMaster=no','-o','ControlPath=none','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=no'];
if (JSON.stringify([...SSH_BASE_ARGS]) !== JSON.stringify(expected)) {
  console.error('FAIL: SSH_BASE_ARGS 值在抽模块过程中被改了'); process.exit(1);
}
console.log('SSH_BASE_ARGS 值零变化 ✓');
"

echo "[task-type-registry-smoke] 4. 注册表 vs 基线源码 审计脚本"
BASE_COMMIT=5c232c9da
if git cat-file -e "${BASE_COMMIT}^{commit}" 2>/dev/null; then
  node packages/brain/scripts/audit/registry-vs-base.mjs
  echo "  审计脚本通过 ✓"
else
  echo "  ⏭️ 基线 commit ${BASE_COMMIT} 在本次 checkout 中不可得（浅克隆），跳过审计"
fi

echo "[task-type-registry-smoke] 全部检查通过 ✓"
