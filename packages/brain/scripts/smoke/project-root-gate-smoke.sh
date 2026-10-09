#!/usr/bin/env bash
# Smoke: project-root-gate — 多刀必挂 project 根 + pushTasks 投影 Project / Blocked by（链 bf5088a3 棒5·PR B，任务 3fad28e0）
# 验证：
#   1. 登记闸纯逻辑：单刀直通；多刀无根被拒（project_root_required）；project 根自身豁免
#   2. 接线：POST /tasks 与依赖 API 都过登记闸；governance-errors 映射它
#   3. 投影一致性：pushTasks 用到的每个 Notion 列，要么是库既有列，要么在缺列即补清单（ops-notion-schema.buildTasksDbProps）
#   4. 投影接线：PUSH_TASKS_QUERY 带 Project/Blocked by 指纹与 hard 前置取数；Blocked by 报错不清 notion_id（防重复页）
#   5. （可选）NOTION_API_KEY：只读核对 Notion Tasks 库真有 Name/Status/Description/Project/Blocked by 五列（Notion 缺列 400 的血训）
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[project-root-gate-smoke] 1. 登记闸纯逻辑"
node --input-type=module -e "
import { assertProjectRootForMultiTask, isMultiTaskRegistration, ProjectRootGateError } from './src/lib/project-root-gate.js';
const noDb = { query: async () => { throw new Error('单刀/根自身不该查库'); } };
await assertProjectRootForMultiTask(noDb, { taskType: 'dev', parentTaskId: null, dependsOn: null, payload: {} });
await assertProjectRootForMultiTask(noDb, { taskType: 'project', parentTaskId: null, dependsOn: ['x'], payload: { multi_task: true } });
const emptyDb = { query: async () => ({ rows: [] }) };
const dep = '33333333-3333-4333-8333-333333333333';
const err = await assertProjectRootForMultiTask(emptyDb, { taskType: 'dev', parentTaskId: null, dependsOn: [dep], payload: {} }).catch((e) => e);
if (!(err instanceof ProjectRootGateError) || err.code !== 'project_root_required') { console.error('FAIL 多刀无根未被拒'); process.exit(1); }
if (!isMultiTaskRegistration({ dependsOn: null, payload: { multi_task: true } })) { console.error('FAIL multi_task 未算多刀'); process.exit(1); }
console.log('单刀直通 / 多刀无根被拒 / 根自身豁免 ✓');
"

echo "[project-root-gate-smoke] 2. 登记闸接线"
node -e "
const fs = require('fs');
const checks = [
  ['src/routes/task-tasks.js', ['assertProjectRootForMultiTask(pool', 'parentTaskId: parentTaskIdInput']],
  ['src/routes/task-dependencies.js', ['assertProjectRootForMultiTask(pool']],
  ['src/lib/governance-errors.js', ['ProjectRootGateError']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
if (fail) process.exit(1);
console.log('建单入口 / 依赖 API / 错误映射 全部接线 ✓');
"

echo "[project-root-gate-smoke] 3-4. 投影一致性 + 接线"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { buildTasksDbProps } from './src/ops-notion-schema.js';
const push = readFileSync('src/notion-push-sync.js', 'utf8');
const TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';
if (!push.includes(TASKS_DB)) { console.error('FAIL 推送用的 Tasks 库 id 常量变了，请同步核对补列清单'); process.exit(1); }
const ensured = Object.keys(buildTasksDbProps(TASKS_DB));
if (JSON.stringify(ensured) !== JSON.stringify(['Blocked by'])) { console.error('FAIL 补列清单应只含 Blocked by: ' + ensured); process.exit(1); }
const must = [
  ['pushed_project', '根后建页指纹'], ['pushed_blockers', '依赖指纹'], [\"d.edge_type = 'hard'\", '只取 hard 边'],
  [\"(b.notion_props->>'pushed_status') IS NOT NULL\", '前置必须带本系统指纹'],
  ['ensureTasksProjection(pool, token)', '缺列即补接线'],
  [\"/Blocked by/i.test(err.message)\", 'Blocked by 报错分流（不清 notion_id）'],
];
const missing = must.filter(([p]) => !push.includes(p));
if (missing.length) { missing.forEach(([, d]) => console.error('FAIL notion-push-sync 缺少: ' + d)); process.exit(1); }
console.log('补列清单/指纹/前置取数/Blocked by 报错分流 ✓');
"

if [ -n "${NOTION_API_KEY:-}" ]; then
  echo "[project-root-gate-smoke] 5. 只读核对 Notion Tasks 库真有投影用到的列"
  curl -sf "https://api.notion.com/v1/databases/d5bc40c2-ba63-82ef-965a-8153b7ad81a0" \
    -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2022-06-28" \
    | node -e "
      let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
        const p=(JSON.parse(s).properties)||{};
        const miss=['Name','Status','Description','Project','Blocked by'].filter(k=>!(k in p));
        if(miss.length){console.error('FAIL Notion Tasks 库缺列: '+miss.join(','));process.exit(1);}
        console.log('Notion Tasks 库五列齐全 ✓');
      });"
else
  echo "[project-root-gate-smoke] 5. 跳过 Notion 只读核对（未设 NOTION_API_KEY）"
fi

echo "[project-root-gate-smoke] ALL PASS"
