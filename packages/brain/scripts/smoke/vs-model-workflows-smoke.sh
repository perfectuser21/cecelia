#!/usr/bin/env bash
# Smoke: 价值流建模③——迁移 494（任务 ce41cd59；决策 3e867cad 第 4-5 张表 / 752b7166 / 词表 f425e3fd）
# 不连库、不发网络，验证：
#   1. 迁移/回滚结构：workflows 表 + capability 守卫触发器 / journey_steps 三列 / backbone_activities 视图新列 /
#      ops_workflows.workflow_id / 智能获客回填 + schema_version 494
#   2. 接线：GET /api/brain/workflows 路由文件存在且已挂到 server.js
#   3. 真库（可选）：DB_NAME 指向 *_test / *_scratch 且 PG 可达时，跑独立 schema 的集成测试
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[vs-model-workflows-smoke] 1. 迁移 494 / 回滚 结构"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const up = readFileSync('migrations/494_vs_model_workflows.sql', 'utf8');
const down = readFileSync('migrations/rollback/494_vs_model_workflows.down.sql', 'utf8');
const must = [
  [/CREATE TABLE IF NOT EXISTS workflows \(/, 'workflows 表'],
  [/capability_id uuid NOT NULL REFERENCES journeys\(id\)/, 'capability_id → journeys'],
  [/CREATE OR REPLACE FUNCTION workflows_capability_guard\(\)/, 'capability 守卫函数'],
  [/CREATE TRIGGER trg_workflows_capability_guard/, 'capability 守卫触发器'],
  [/ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows\(id\)/, 'journey_steps.workflow_id'],
  [/executor_kind IS NULL OR executor_kind IN \('code', ?'agent', ?'human'\)/, 'executor_kind CHECK'],
  [/ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS enabler_id uuid NULL REFERENCES enablers\(id\)/, 'journey_steps.enabler_id'],
  [/CREATE VIEW backbone_activities AS SELECT[^;]*workflow_id, executor_kind, enabler_id FROM journey_steps/, 'backbone_activities 视图新列'],
  [/ALTER TABLE ops_workflows ADD COLUMN IF NOT EXISTS workflow_id uuid NULL REFERENCES workflows\(id\)/, 'ops_workflows.workflow_id'],
  [/'douyin_keyword_leadgen'/, '回填 抖音·关键词获客'],
  [/'douyin_benchmark_leadgen'/, '回填 抖音·对标获客'],
  [/INSERT INTO schema_version[\s\S]*'494'/, 'schema_version 494'],
];
for (const [re, label] of must) if (!re.test(up)) { console.error('FAIL 迁移缺 ' + label); process.exit(1); }
if (/DROP COLUMN[^;]*journey_id/.test(up)) { console.error('FAIL 迁移不得删 journey_id'); process.exit(1); }
for (const [re, label] of [
  [/DROP VIEW IF EXISTS backbone_activities/, '删新视图'],
  [/CREATE VIEW backbone_activities AS SELECT id, notion_id, journey_id, name, description, step_number, status, notion_synced_at, created_at, updated_at, promise, backbone_version FROM journey_steps/, '还原 12 列视图'],
  [/DROP TABLE IF EXISTS workflows/, '删 workflows'],
  [/DELETE FROM schema_version WHERE version = '494'/, '删 schema_version'],
]) if (!re.test(down)) { console.error('FAIL 回滚缺 ' + label); process.exit(1); }
console.log('迁移结构 + 回滚 ✓');
"

echo "[vs-model-workflows-smoke] 2. 接线：GET /api/brain/workflows"
node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('src/routes/workflows.js')) { console.error('FAIL 缺 src/routes/workflows.js'); process.exit(1); }
const s = readFileSync('server.js', 'utf8');
if (!/import workflowsRouter from '\.\/src\/routes\/workflows\.js'/.test(s) || !/app\.use\('\/api\/brain', workflowsRouter\)/.test(s)) {
  console.error('FAIL server.js 未挂载 workflowsRouter'); process.exit(1);
}
console.log('路由已挂载 ✓');
"

echo "[vs-model-workflows-smoke] 3. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  npx vitest run src/__tests__/integration/migration-494-vs-model-workflows.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[vs-model-workflows-smoke] 全部检查通过 ✓"
