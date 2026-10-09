#!/usr/bin/env bash
# Smoke: 价值流建模④——迁移 495（任务 ec643d60；决策 3e867cad 第 9-10 张表 / 词表 f425e3fd）
# 不连库、不发网络，验证：
#   1. 迁移/回滚结构：spans 表 + 三条 CHECK + 幂等唯一键 + task_runs.workflow_id + activity_flow_metrics 视图 + schema_version 495
#   2. 接线：POST/GET /api/brain/spans 路由文件存在且已挂到 server.js
#   3. 真库（可选）：DB_NAME 指向 *_test / *_scratch 且 PG 可达时，跑独立 schema 的集成测试
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[vs-model-spans-smoke] 1. 迁移 495 / 回滚 结构"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const up = readFileSync('migrations/495_vs_model_spans.sql', 'utf8');
const down = readFileSync('migrations/rollback/495_vs_model_spans.down.sql', 'utf8');
const must = [
  [/CREATE TABLE IF NOT EXISTS spans \(/, 'spans 表'],
  [/spans_target_check CHECK \(activity_id IS NOT NULL OR step_id IS NOT NULL OR enabler_id IS NOT NULL\)/, '至少一个目标 CHECK'],
  [/spans_executor_kind_check CHECK \(executor_kind IN \('code', ?'agent', ?'human'\)\)/, 'executor_kind CHECK'],
  [/spans_outcome_check CHECK \(outcome IN \('pass', ?'fail', ?'skipped', ?'unknown'\)\)/, 'outcome CHECK'],
  [/CREATE UNIQUE INDEX IF NOT EXISTS uq_spans_idem ON spans \(run_id, \(COALESCE\(step_id, activity_id, enabler_id\)\), started_at\)/, '幂等唯一键'],
  [/ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows\(id\)/, 'task_runs.workflow_id'],
  [/CREATE OR REPLACE VIEW activity_flow_metrics AS/, 'activity_flow_metrics 视图'],
  [/fallback_rate/, 'fallback_rate'],
  [/first_pass_yield/, 'first_pass_yield'],
  [/INSERT INTO schema_version[\s\S]*'495'/, 'schema_version 495'],
];
for (const [re, label] of must) if (!re.test(up)) { console.error('FAIL 迁移缺 ' + label); process.exit(1); }
for (const [re, label] of [
  [/DROP VIEW IF EXISTS activity_flow_metrics/, '删视图'],
  [/ALTER TABLE task_runs DROP COLUMN IF EXISTS workflow_id/, '删 task_runs.workflow_id'],
  [/DROP TABLE IF EXISTS spans/, '删 spans'],
  [/DELETE FROM schema_version WHERE version = '495'/, '删 schema_version'],
]) if (!re.test(down)) { console.error('FAIL 回滚缺 ' + label); process.exit(1); }
console.log('迁移结构 + 回滚 ✓');
"

echo "[vs-model-spans-smoke] 2. 接线：POST/GET /api/brain/spans"
node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('src/routes/spans.js')) { console.error('FAIL 缺 src/routes/spans.js'); process.exit(1); }
const r = readFileSync('src/routes/spans.js', 'utf8');
if (!/router\.post\('\/spans', internalAuthOrLoopback/.test(r)) { console.error('FAIL POST /spans 未走 internalAuthOrLoopback'); process.exit(1); }
if (!/router\.get\('\/spans'/.test(r)) { console.error('FAIL 缺 GET /spans'); process.exit(1); }
const s = readFileSync('server.js', 'utf8');
if (!/import spansRouter from '\.\/src\/routes\/spans\.js'/.test(s) || !/app\.use\('\/api\/brain', spansRouter\)/.test(s)) {
  console.error('FAIL server.js 未挂载 spansRouter'); process.exit(1);
}
console.log('路由已挂载 ✓');
"

echo "[vs-model-spans-smoke] 3. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  POSTGRES_INTEGRATION=1 npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-495-vs-model-spans.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[vs-model-spans-smoke] 全部检查通过 ✓"
