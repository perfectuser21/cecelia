#!/usr/bin/env bash
# Smoke: task-kind-column — tasks.kind 真列（agent | workflow）地基（task 94465721，决策 df67a9d6 / e073bdc2）
# 验证：
#   1. 注册表：每个 task_type 都声明 kind ∈ TASK_KINDS；WORKFLOW_KIND_TASK_TYPES 非空
#   2. 迁移 466：列 / CHECK NOT VALID / 回填只动 kind IS NULL；CASE 名单 == 注册表 workflow 名单；467 VALIDATE
#   3. 建单路径 work-routing-store：INSERT 列清单含 kind，非法值走 assertTaskKind
#   4. 入口 routes/task-tasks：INVALID_KIND 400
#   5. 消费方 notion-push-sync：PUSH_TASKS_QUERY 取 t.kind，Description 拼 kind
#   6. （可选）TASK_KIND_SMOKE_DB_URL 指向已跑完迁移的库：列存在、约束 validated、无 NULL kind
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[task-kind-column-smoke] 1. 注册表每类型声明 kind"
node --input-type=module -e "
import * as R from './src/lib/task-type-registry.js';
import { deriveTaskKind, assertTaskKind } from './src/lib/task-kind.js';
const bad = Object.entries(R.TASK_TYPE_REGISTRY).filter(([, e]) => !R.TASK_KINDS.includes(e.kind));
if (bad.length) { console.error('FAIL 无合法 kind: ' + bad.map(([k]) => k).join(',')); process.exit(1); }
if (!R.WORKFLOW_KIND_TASK_TYPES.length) { console.error('FAIL WORKFLOW_KIND_TASK_TYPES 为空'); process.exit(1); }
if (deriveTaskKind('workflow_run') !== 'workflow' || deriveTaskKind('dev') !== 'agent') { console.error('FAIL deriveTaskKind'); process.exit(1); }
let threw = false; try { assertTaskKind('script'); } catch (e) { threw = e.code === 'invalid_task_kind'; }
if (!threw) { console.error('FAIL assertTaskKind 未拒绝 script'); process.exit(1); }
console.log('注册表 ' + Object.keys(R.TASK_TYPE_REGISTRY).length + ' 个类型全部有 kind，workflow=' + R.WORKFLOW_KIND_TASK_TYPES.join(',') + ' ✓');
"

echo "[task-kind-column-smoke] 2. 迁移 466/467 结构 + 名单对齐"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import * as R from './src/lib/task-type-registry.js';
const up = readFileSync('migrations/466_tasks_kind_column.sql', 'utf8');
const must = [
  ['ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT;', '加列'],
  [\"CHECK (kind IS NULL OR kind IN ('agent', 'workflow'))\", 'CHECK 白名单'],
  ['NOT VALID', 'NOT VALID 登记'],
  ['WHERE kind IS NULL', '回填只动未分类行'],
  ['LIMIT 5000', '分批'],
];
const missing = must.filter(([p]) => !up.includes(p));
if (missing.length) { missing.forEach(([, d]) => console.error('FAIL 466 缺少: ' + d)); process.exit(1); }
const m = up.match(/WHEN task_type IN \(([^)]*)\) THEN 'workflow'/);
const listed = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : [];
const expected = [...R.WORKFLOW_KIND_TASK_TYPES].sort();
if (JSON.stringify(listed) !== JSON.stringify(expected)) { console.error('FAIL 466 名单 ' + listed + ' != 注册表 ' + expected); process.exit(1); }
const v = readFileSync('migrations/467_validate_tasks_kind_check.sql', 'utf8');
if (!v.includes('ALTER TABLE tasks VALIDATE CONSTRAINT tasks_kind_check;')) { console.error('FAIL 467 缺 VALIDATE'); process.exit(1); }
console.log('466/467 结构正确，回填名单与注册表一致 ✓');
"

echo "[task-kind-column-smoke] 3-5. 建单 / 入口 / 消费方接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/work-routing-store.js', ['parent_task_id, sequence_no, kind', 'assertTaskKind(task.kind)', 'deriveTaskKind(decision.canonical_task_type)']],
  ['src/routes/task-tasks.js', [\"code: 'INVALID_KIND'\", 'isTaskKind(kindInput)']],
  ['src/routing/qiumi-router.js', ['kind = \$3, dept = \$4', 'const KIND_NAMES = TASK_KINDS']],
  ['src/notion-push-sync.js', ['t.kind', '\${t.kind ? \` · \${t.kind}\` : \\'\\'}']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('建单写入 / 入口校验 / 路由落列 / 投影读列 全部接线 ✓');
"

if [ -n "${TASK_KIND_SMOKE_DB_URL:-}" ]; then
  echo "[task-kind-column-smoke] 6. 真库：列 / 约束 validated / 无 NULL"
  psql "$TASK_KIND_SMOKE_DB_URL" -Atc "SELECT 1 FROM information_schema.columns WHERE table_name='tasks' AND column_name='kind'" | grep -q 1 || { echo "FAIL tasks.kind 列不存在"; exit 1; }
  psql "$TASK_KIND_SMOKE_DB_URL" -Atc "SELECT convalidated FROM pg_constraint WHERE conrelid='tasks'::regclass AND conname='tasks_kind_check'" | grep -q t || { echo "FAIL tasks_kind_check 不存在或未 validated"; exit 1; }
  NULLS=$(psql "$TASK_KIND_SMOKE_DB_URL" -Atc "SELECT count(*) FROM tasks WHERE kind IS NULL")
  [ "$NULLS" = "0" ] || { echo "FAIL 仍有 $NULLS 行 kind IS NULL"; exit 1; }
  echo "真库列/约束/回填 ✓"
else
  echo "[task-kind-column-smoke] 6. 跳过真库检查（未设 TASK_KIND_SMOKE_DB_URL）"
fi

echo "[task-kind-column-smoke] ALL PASS"
