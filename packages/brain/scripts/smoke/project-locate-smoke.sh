#!/usr/bin/env bash
# Smoke: Project 归位器（接力棒链 2afa6d69 棒3，任务 8a40825a）
# 不连库时只验结构+接线；DB_NAME 指向 *_test/*_scratch 且 PG 可达时额外跑真库集成测试。
#   1. project-locate.js 打分引擎：bigram 分词 / 关键词 Jaccard / embedding + 800ms 超时回退 / 阈值解析
#   2. project-locate-routes.js：POST /locate、POST /:id/tasks 两条路由存在且走建单闸
#   3. task-projects.js 已把新路由挂在 /:id 之前（否则 "locate" 会被当 UUID 拦截）
#   4. 真库（可选）：project-locate-tasks.pg.integration.test.js
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[project-locate-smoke] 1. project-locate.js 打分引擎结构"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const src = readFileSync('src/project-locate.js', 'utf8');
const must = [
  [/export function tokenizeBigram/, '中文 bigram 分词'],
  [/export function keywordOverlapScore/, '关键词 Jaccard 打分'],
  [/export async function scoreProjectCandidates/, '打分编排'],
  [/export function resolveProjectLocateThreshold/, '阈值解析'],
  [/DEFAULT_PROJECT_LOCATE_THRESHOLD = 0.55/, '默认阈值 0.55'],
  [/PROJECT_LOCATE_THRESHOLD/, 'env 阈值覆盖'],
  [/withTimeout/, '800ms 超时封装'],
  [/整体回退关键词打分/, '超时/失败整体回退（不部分混排）'],
];
for (const [re, label] of must) if (!re.test(src)) { console.error('FAIL project-locate.js 缺 ' + label); process.exit(1); }
console.log('打分引擎结构 ✓');
"

echo "[project-locate-smoke] 2. project-locate-routes.js 路由 + 建单闸接线"
node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
if (!existsSync('src/routes/project-locate-routes.js')) { console.error('FAIL 缺 src/routes/project-locate-routes.js'); process.exit(1); }
const routes = readFileSync('src/routes/project-locate-routes.js', 'utf8');
const must = [
  [/router\.post\('\/locate', async/, 'POST /locate'],
  [/router\.post\('\/:id\/tasks', async/, 'POST /:id/tasks'],
  [/createRoutedTask/, '走 createRoutedTask 同一条建单路径'],
  [/assertProjectRootForMultiTask/, '建单闸'],
  [/assertDependsOnExist/, '依赖单一写口校验'],
  [/normalizeDependsOn/, 'depends_on 归一化'],
  [/sequence_no.*MAX\(sequence_no\)|MAX\(sequence_no\).*sequence_no/s, 'sequence_no = max+1'],
  [/multi_task: true/, 'payload.multi_task=true'],
];
for (const [re, label] of must) if (!re.test(routes)) { console.error('FAIL project-locate-routes.js 缺 ' + label); process.exit(1); }
console.log('路由 + 建单闸接线 ✓');
"

echo "[project-locate-smoke] 3. task-projects.js 挂载顺序（locate 必须在 /:id 之前）"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const tp = readFileSync('src/routes/task-projects.js', 'utf8');
if (!/import projectLocateRoutes from '\.\/project-locate-routes\.js'/.test(tp)) {
  console.error('FAIL task-projects.js 未 import project-locate-routes.js'); process.exit(1);
}
const mountIdx = tp.indexOf(\"router.use('/', projectLocateRoutes)\");
const idIdx = tp.indexOf(\"router.get('/:id'\");
if (mountIdx === -1) { console.error('FAIL 未挂载 projectLocateRoutes'); process.exit(1); }
if (idIdx !== -1 && mountIdx > idIdx) { console.error('FAIL projectLocateRoutes 挂载顺序在 GET /:id 之后（locate 会被当 UUID 拦截）'); process.exit(1); }
console.log('挂载顺序 ✓（在 /:id 之前）');
"

echo "[project-locate-smoke] 4. 单测（bigram/关键词/embedding 回退/阈值）"
npx vitest run src/project-locate.test.js src/routes/__tests__/project-locate-routes.test.js src/routes/__tests__/task-projects.test.js

echo "[project-locate-smoke] 5. 真库集成（可选）"
if [[ "${DB_NAME:-}" =~ _(test|scratch)$ ]] && command -v pg_isready >/dev/null 2>&1 && pg_isready -q 2>/dev/null; then
  npx vitest run --config vitest.integration.config.js src/__tests__/integration/project-locate-tasks.pg.integration.test.js
else
  echo "skip 真库（DB_NAME 非 *_test/*_scratch 或 PG 不可达）"
fi

echo "[project-locate-smoke] 全部检查通过 ✓"
