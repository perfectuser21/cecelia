#!/usr/bin/env bash
# Smoke: coding workflow 执行记录接入 runs/spans（迁移 541，决策 b34e346a，任务 eb831e90）
# 不发网络写，验证：
#   1. 迁移 541 / 回滚结构：F1 能力下 coding_workflow 流程 + 12 个 Activity + 引用，固定 id 与 runner 上报一致
#   2. 接线：runner 执行器跑完、QA/裁判/合并/CI 修复都调用 postSpans；Brain 客户端 POST /api/brain/spans
#   3. Notion 最近执行：coding-workflow 运行 7 天全量进窗口，来源 Coding Workflow
#   4. 真库（可选）：DB_NAME 指向 *_test / *_scratch 且 PG 可达时，跑迁移 541 集成测试
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[coding-workflow-spans-smoke] 1. 迁移 541 / 回滚 结构 + id 一致"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { CODING_WORKFLOW_ID, ACTIVITY_IDS } from './scripts/coding-workflow/runner/lib/spans.mjs';
const up = readFileSync('migrations/541_coding_workflow_activities.sql', 'utf8');
const down = readFileSync('migrations/rollback/541_coding_workflow_activities.down.sql', 'utf8');
if (!up.includes(\"'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'\")) { console.error('FAIL 未挂 F1 开发闭环能力'); process.exit(1); }
if (!up.includes(\"'\" + CODING_WORKFLOW_ID + \"'\")) { console.error('FAIL 流程 id 与 runner 不一致'); process.exit(1); }
for (const [key, id] of Object.entries(ACTIVITY_IDS)) {
  if (!new RegExp(\"\\\\('\" + key + \"',\\\\s+'\" + id + \"'\").test(up)) { console.error('FAIL 引用缺 ' + key); process.exit(1); }
}
if (Object.keys(ACTIVITY_IDS).length !== 12) { console.error('FAIL Activity 数不是 12'); process.exit(1); }
if (!/ON CONFLICT \(id\) DO NOTHING/.test(up)) { console.error('FAIL 迁移不幂等'); process.exit(1); }
for (const re of [/DELETE FROM spans/, /DELETE FROM workflow_activity_refs/, /DELETE FROM activities/, /DELETE FROM workflows/]) {
  if (!re.test(down)) { console.error('FAIL 回滚缺 ' + re); process.exit(1); }
}
console.log('迁移结构 + 回滚 + id 一致 ✓');
"

echo "[coding-workflow-spans-smoke] 2. 接线：runner 上报 spans"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync('scripts/coding-workflow/runner/' + f, 'utf8');
const checks = [
  ['run-once.mjs', /postSpans\(ctx, chainSpans\(receipt/],
  ['lib/qa-gate.mjs', /key: 'qa'/],
  ['lib/qa-gate.mjs', /key: 'judge'/],
  ['lib/merge-gate.mjs', /key: 'merge'/],
  ['lib/cifix.mjs', /key: 'ci_fix'/],
  ['lib/brain.mjs', /api\/brain\/spans/],
];
for (const [f, re] of checks) if (!re.test(read(f))) { console.error('FAIL ' + f + ' 未接 ' + re); process.exit(1); }
console.log('runner 接线 ✓');
"

echo "[coding-workflow-spans-smoke] 3. Notion 最近执行窗口"
node --input-type=module -e "
import { IN_WINDOW_SQL, buildRunProps } from './src/runs-notion-projection.js';
if (!/run_id LIKE 'coding-workflow:%' AND \(started_at >= now\(\) - interval '7 days'/.test(IN_WINDOW_SQL)) { console.error('FAIL 窗口未含 coding-workflow 7 天'); process.exit(1); }
const p = buildRunProps({ run_id: 'coding-workflow:smoke', started_at: new Date().toISOString(), outcome: 'pass', duration_ms: 1000 });
if (p['来源'].select.name !== 'Coding Workflow') { console.error('FAIL 来源不是 Coding Workflow'); process.exit(1); }
console.log('Notion 窗口 + 来源 ✓');
"

echo "[coding-workflow-spans-smoke] 4. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-541-coding-workflow-activities.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[coding-workflow-spans-smoke] 全部检查通过 ✓"
