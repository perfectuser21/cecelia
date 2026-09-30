#!/usr/bin/env bash
# Smoke: 价值流建模⑤——迁移 496（任务 741cdf5a；决策 3e867cad 第 11/13 张表 / 词表 f425e3fd）
# 不连库、不发网络，验证：
#   1. 迁移/回滚结构：step_probes 挂点 target_type/target_id + 回填 + coll_rescan_rate 挂 step /
#      journey_step_links 三级格子 cell_level/step_id_ref/enabler_id + step:/enabler: 格生成 / golden_path* 只标注 + schema_version 496
#   2. 接线：spec 认 target、路由持久化 target_*、sync 解析 target、GET /api/brain/steps|/enablers 路由挂到 server.js
#   3. 真库（可选）：DB_NAME 指向 *_test / *_scratch 且 PG 可达时，跑独立 schema 的集成测试
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[probe-targets-cells-smoke] 1. 迁移 496 / 回滚 结构"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const up = readFileSync('migrations/496_probe_targets_cells_levels.sql', 'utf8');
const down = readFileSync('migrations/rollback/496_probe_targets_cells_levels.down.sql', 'utf8');
const must = [
  [/ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS target_type text/, 'step_probes.target_type'],
  [/ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS target_id uuid/, 'step_probes.target_id'],
  [/target_type IS NULL OR target_type IN \('activity', ?'step', ?'enabler'\)/, 'target_type CHECK'],
  [/UPDATE step_probes[\s\S]*target_type = 'activity'[\s\S]*journey_step_links/, '回填 activity'],
  [/probe_key = 'coll_rescan_rate'/, 'coll_rescan_rate 挂 step'],
  [/keyword_acquisition\.collection\.return_to_results/, 'return_to_results step'],
  [/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS cell_level text NOT NULL DEFAULT 'activity'/, 'jsl.cell_level'],
  [/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS step_id_ref uuid NULL REFERENCES steps\(id\)/, 'jsl.step_id_ref'],
  [/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS enabler_id uuid NULL REFERENCES enablers\(id\)/, 'jsl.enabler_id'],
  [/'step:' \|\| s\.key/, 'step 格生成'],
  [/'enabler:' \|\| e\.key/, 'enabler 格生成'],
  [/ON CONFLICT \(step_id, cell_kind, cell_key\) WHERE cell_kind IS NOT NULL DO NOTHING/, '幂等不覆盖颜色'],
  [/COMMENT ON TABLE %I IS %L/, 'golden_path* 退役注释'],
  [/INSERT INTO schema_version[\s\S]*'496'/, 'schema_version 496'],
];
for (const [re, label] of must) if (!re.test(up)) { console.error('FAIL 迁移缺 ' + label); process.exit(1); }
if (/DROP TABLE[^;]*golden_path/.test(up) || /RENAME TO golden_path\w*_legacy/.test(up)) { console.error('FAIL 迁移不得动 golden_path*'); process.exit(1); }
if (/DROP COLUMN[^;]*journey_step_link_id/.test(up)) { console.error('FAIL 迁移不得删 journey_step_link_id'); process.exit(1); }
for (const [re, label] of [
  [/DELETE FROM journey_step_links WHERE cell_level IN \('step', ?'enabler'\)/, '删生成的格子'],
  [/DROP COLUMN IF EXISTS step_id_ref/, '删 step_id_ref'],
  [/DROP COLUMN IF EXISTS enabler_id/, '删 enabler_id'],
  [/DROP COLUMN IF EXISTS cell_level/, '删 cell_level'],
  [/DROP COLUMN IF EXISTS target_id/, '删 target_id'],
  [/DROP COLUMN IF EXISTS target_type/, '删 target_type'],
  [/DELETE FROM schema_version WHERE version = '496'/, '删 schema_version'],
]) if (!re.test(down)) { console.error('FAIL 回滚缺 ' + label); process.exit(1); }
console.log('迁移结构 + 回滚 ✓');
"

echo "[probe-targets-cells-smoke] 2. 接线：spec/路由/sync/steps 路由"
node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('src/routes/steps.js')) { console.error('FAIL 缺 src/routes/steps.js'); process.exit(1); }
const s = readFileSync('server.js', 'utf8');
if (!/import stepsRouter from '\.\/src\/routes\/steps\.js'/.test(s) || !/app\.use\('\/api\/brain', stepsRouter\)/.test(s)) {
  console.error('FAIL server.js 未挂载 stepsRouter'); process.exit(1);
}
if (!/TARGET_TYPES/.test(readFileSync('src/lib/step-probe-spec.js', 'utf8'))) { console.error('FAIL spec 不认 target'); process.exit(1); }
if (!/target_type = COALESCE\(EXCLUDED\.target_type, step_probes\.target_type\)/.test(readFileSync('src/routes/step-probes.js', 'utf8'))) { console.error('FAIL 路由未持久化 target_type'); process.exit(1); }
if (!/target_type/.test(readFileSync('../../scripts/sync-step-probes.mjs', 'utf8'))) { console.error('FAIL sync 不带 target_type'); process.exit(1); }
console.log('接线 ✓');
"

echo "[probe-targets-cells-smoke] 3. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  npx vitest run src/__tests__/integration/migration-496-probe-targets-cells.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[probe-targets-cells-smoke] 全部检查通过 ✓"
