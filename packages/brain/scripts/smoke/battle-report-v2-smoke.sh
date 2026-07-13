#!/usr/bin/env bash
# Smoke: battle-report 军师节 v2 — golden-path-mode GP6/T6
# 验证：
#   1. battle-report.js 含 v2 五段渲染与 ≤7 截断结构
#   2. v1 军师决策明细（notes 取数）已删干净
#   3. 渲染器空态真实跑通（B1：四段标题 + 暂无，无验货台）
set -euo pipefail

echo "[battle-report-v2-smoke] 1. battle-report.js 含 v2 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/battle-report.js', 'utf8');
const checks = [
  ['export function hasNovelJudgment', 'hasNovelJudgment 导出'],
  ['MAX_ALEX_ACTIONS = 7', '需动作条目 ≤7 硬上限'],
  ['gp_gap_panorama', 'OKR 缺口全景 working_memory key（T4 并行约定）'],
  [\"'[自动派工]%'\", '昨日自动派工台账查询（T5 口径）'],
  ['GROUP BY status', '水位段 GROUP BY status'],
  ['军师决策节 v2', 'v2 节标题'],
  ['方向圈选段', '①圈选段'],
  ['GP 批审段', '②批审段'],
  ['报备段', '③报备段'],
  ['GP 库存水位段', '⑤水位段'],
  ['顺延次日', '溢出顺延渲染'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: battle-report.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
if (src.includes('strategistDecisions') || src.includes(\"军师决策[\")) {
  console.error('FAIL: v1 军师决策明细（notes 取数）未删干净');
  process.exit(1);
}
if (src.includes('验货台')) {
  console.error('FAIL: 验货台段范围外，不应出现在代码里');
  process.exit(1);
}
console.log('battle-report.js v2 结构正确 ✓');
"

echo "[battle-report-v2-smoke] 2. 渲染器空态真实跑通（B1）"
node --input-type=module -e "
import { renderBattleReportMarkdown } from './packages/brain/src/battle-report.js';
const md = renderBattleReportMarkdown({
  mergedPrs: [], journeyRuns: [], userDecisions: [],
  sentinel: { jobs: [], expected: null, healthy: false },
  unconfirmedActions: [], goldenPathMode: null,
});
const must = ['## 军师决策节 v2', '### 方向圈选段', '### GP 批审段', '### 报备段', '### GP 库存水位段'];
const missing = must.filter((s) => !md.includes(s));
if (missing.length > 0) {
  console.error('FAIL: 空态渲染缺段: ' + missing.join(', '));
  process.exit(1);
}
if (md.includes('验货台')) { console.error('FAIL: 空态渲染出现验货台段'); process.exit(1); }
console.log('空态五段（四实现段）渲染 ✓');
"

echo "[battle-report-v2-smoke] 全部检查通过 ✓"
