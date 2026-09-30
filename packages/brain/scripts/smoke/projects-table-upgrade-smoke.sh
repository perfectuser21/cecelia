#!/usr/bin/env bash
# Smoke: Projects 真身表升格（接力棒链 2afa6d69 棒1，任务 9e785997，决策 ee4842a6/3feeae3e）
# 不连库时只验结构+接线；DB_NAME 指向 *_test/*_scratch 且 PG 可达时额外跑真库集成测试。
# 编号勘误：本迁移先改过 495→496（撞 495_vs_model_spans.sql），又撞 496_probe_targets_cells_levels.sql，最终定号 497。
#   1. 迁移 497 / 回滚 497 结构完整（重建 projects 表 + tasks.project_id FK 重接 + okr_projects 搬家 + 历史根回填）
#   2. server.js 已挂载 /api/brain/projects（task-projects.js）与 /api/brain/okr（okr-hierarchy.js）
#   3. task-projects.js 含新增 POST / 路由（kr_id_not_key_result 校验）
#   4. 真库（可选）：迁移 497 集成测试
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[projects-table-upgrade-smoke] 1. 迁移 497 / 回滚 497 结构"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const up = readFileSync('migrations/497_projects_table_upgrade.sql', 'utf8');
const down = readFileSync('migrations/rollback/497_projects_table_upgrade.down.sql', 'utf8');
const must = [
  [/CREATE TABLE IF NOT EXISTS projects \(/, 'projects 表重建'],
  [/kr_id uuid REFERENCES key_results\(id\) ON DELETE SET NULL/, 'projects.kr_id'],
  [/brief jsonb NOT NULL DEFAULT '\{\}'/, 'projects.brief'],
  [/notion_props jsonb NOT NULL DEFAULT '\{\}'/, 'projects.notion_props'],
  [/ADD CONSTRAINT\s+tasks_project_id_fkey/, 'tasks.project_id 外键重接'],
  [/FOREIGN KEY \(project_id\) REFERENCES projects\(id\) ON DELETE SET NULL/, 'FK 目标 projects(id)'],
  [/mig497_fk_note/, 'FK 校验结果不静默吞（写进 session config→schema_version.description）'],
  [/FROM okr_projects/, 'okr_projects 搬家'],
  [/task_type = 'project'/, '历史 project 根回填循环'],
  [/migrated_to_project/, '根任务打标 migrated_to_project'],
  [/INSERT INTO schema_version[\s\S]*'497'/, 'schema_version 497'],
  [/FK 校验/, 'schema_version.description 含 FK 校验结果'],
];
for (const [re, label] of must) if (!re.test(up)) { console.error('FAIL 迁移缺 ' + label); process.exit(1); }
if (!/DROP TABLE IF EXISTS projects CASCADE/.test(down)) { console.error('FAIL 回滚缺 DROP TABLE projects CASCADE'); process.exit(1); }
if (!/DELETE FROM schema_version WHERE version = '497'/.test(down)) { console.error('FAIL 回滚缺删 schema_version'); process.exit(1); }
console.log('迁移结构 + 回滚 ✓');
"

echo "[projects-table-upgrade-smoke] 2. 接线：/api/brain/projects 与 /api/brain/okr"
node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('src/routes/task-projects.js')) { console.error('FAIL 缺 src/routes/task-projects.js'); process.exit(1); }
if (!existsSync('src/routes/okr-hierarchy.js')) { console.error('FAIL 缺 src/routes/okr-hierarchy.js'); process.exit(1); }
const s = readFileSync('server.js', 'utf8');
if (!/app\.use\('\/api\/brain\/projects', taskProjectsRoutes\)/.test(s)) {
  console.error('FAIL server.js 未挂载 taskProjectsRoutes 到 /api/brain/projects'); process.exit(1);
}
if (!/app\.use\('\/api\/brain\/okr', okrHierarchyRoutes\)/.test(s)) {
  console.error('FAIL server.js 未挂载 okrHierarchyRoutes 到 /api/brain/okr'); process.exit(1);
}
const routes = readFileSync('src/routes/task-projects.js', 'utf8');
if (!/FROM projects/.test(routes)) { console.error('FAIL task-projects.js 未读 projects 表'); process.exit(1); }
if (!/router\.post\('\/', async/.test(routes)) { console.error('FAIL task-projects.js 缺 POST /'); process.exit(1); }
if (!/kr_id_not_key_result/.test(routes)) { console.error('FAIL task-projects.js 缺 kr_id_not_key_result 校验'); process.exit(1); }
console.log('路由已挂载且 /api/brain/projects 指向 projects 表 ✓（/api/brain/okr/projects 仍是 okr_projects，见 okr-hierarchy.js 注释）');
"

echo "[projects-table-upgrade-smoke] 3. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  npx vitest run --config vitest.integration.config.js src/__tests__/integration/migration-497-projects-table.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[projects-table-upgrade-smoke] 全部检查通过 ✓"
