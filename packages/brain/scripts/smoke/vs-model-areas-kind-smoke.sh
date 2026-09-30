#!/usr/bin/env bash
# Smoke: 价值流建模②——迁移 493（任务 ef3aeffa；决策 3e867cad 第 1-3 张表 / 词表 f425e3fd）
# 不连库、不发网络，验证：
#   1. 迁移/回滚文件四段结构：areas 自引用树 / journeys.kind 生成列 / 旧 capabilities 腾名守卫 / value_streams+capabilities 视图 + schema_version 493
#   2. 接线：brain 代码里对旧表的 SQL 全部改到 capabilities_legacy（视图 capabilities 没有 current_stage 列，漏一处生产启动就炸）
#   3. 真库（可选）：DB_NAME 指向 *_test / *_scratch 且 PG 可达时，跑独立 schema 的集成测试
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[vs-model-areas-kind-smoke] 1. 迁移 493 / 回滚 结构"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const up = readFileSync('migrations/493_vs_model_areas_kind.sql', 'utf8');
const down = readFileSync('migrations/rollback/493_vs_model_areas_kind.down.sql', 'utf8');
const must = [
  [/ALTER TABLE areas ADD COLUMN IF NOT EXISTS parent_area_id uuid[^;]*REFERENCES areas\(id\)/, 'areas.parent_area_id 自引用'],
  [/areas_parent_not_self CHECK \(parent_area_id IS NULL OR parent_area_id <> id\)/, 'areas 自父 CHECK'],
  [/kind text\s+GENERATED ALWAYS AS \(CASE WHEN parent_journey_id IS NULL THEN 'value_stream' ELSE 'capability' END\) STORED/, 'journeys.kind 生成列'],
  [/relname = 'capabilities' AND c\.relkind = 'r'/, '腾名守卫只认表'],
  [/ALTER TABLE capabilities RENAME TO capabilities_legacy/, '旧表腾名'],
  [/CREATE VIEW value_streams AS SELECT \* FROM journeys WHERE kind = 'value_stream'/, 'value_streams 视图'],
  [/CREATE VIEW capabilities AS SELECT \* FROM journeys WHERE kind = 'capability'/, 'capabilities 视图'],
  [/INSERT INTO schema_version[\s\S]*'493'/, 'schema_version 493'],
];
for (const [re, label] of must) if (!re.test(up)) { console.error('FAIL 迁移缺 ' + label); process.exit(1); }
if (/DROP TABLE[^;]*capabilities/.test(up)) { console.error('FAIL 迁移不得 DROP 旧表'); process.exit(1); }
for (const [re, label] of [
  [/ALTER TABLE capabilities_legacy RENAME TO capabilities/, '还原旧表名'],
  [/DROP COLUMN IF EXISTS kind/, '删 kind'],
  [/CREATE OR REPLACE VIEW value_streams AS SELECT \* FROM journeys;/, '视图还原全表'],
  [/DROP COLUMN IF EXISTS parent_area_id/, '删 parent_area_id'],
  [/DELETE FROM schema_version WHERE version = '493'/, '删 schema_version'],
]) if (!re.test(down)) { console.error('FAIL 回滚缺 ' + label); process.exit(1); }
console.log('迁移四段 + 回滚五段 ✓');
"

echo "[vs-model-areas-kind-smoke] 2. 接线：旧表 SQL 已全部改到 capabilities_legacy"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const files = ['src/capability-scanner.js', 'src/similarity.js', 'src/generate-capability-embeddings.mjs', 'src/routes/analytics.js'];
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const stale = text.match(/\b(FROM|INTO|UPDATE)\s+capabilities\b(?!_legacy)/g) || [];
  if (stale.length) { console.error('FAIL ' + f + ' 仍引用旧表名 capabilities: ' + stale.join(' | ')); bad++; }
  if (!/capabilities_legacy/.test(text)) { console.error('FAIL ' + f + ' 没有改到 capabilities_legacy'); bad++; }
}
if (bad) process.exit(1);
console.log(files.length + ' 个文件全部指向 capabilities_legacy ✓');
"

echo "[vs-model-areas-kind-smoke] 3. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  npx vitest run src/__tests__/integration/migration-493-vs-model.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[vs-model-areas-kind-smoke] 全部检查通过 ✓"
