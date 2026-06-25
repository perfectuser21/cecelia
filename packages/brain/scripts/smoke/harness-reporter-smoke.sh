#!/bin/bash
set -e

# Smoke: harness_report payload 含 gan_rounds / gan_cost_usd
# Slice3 后：reportNode（FAIL 路径）经 spawnHarnessReport 传 ganRounds/ganCostUsd，
# buildHarnessReportInsert（staging-promote.js）把它们映射为 gan_rounds/gan_cost_usd payload 字段。
node -e "
const fs = require('fs');
const graph = fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
// reportNode 失败路径把 gan 数据传给 spawnHarnessReport
if (!/ganRounds: state\.ganResult\?\.rounds \|\| 0/.test(graph)) {
  console.error('FAIL: ganRounds not passed from reportNode to spawnHarnessReport'); process.exit(1);
}
if (!/ganCostUsd: state\.ganResult\?\.cost_usd \|\| 0/.test(graph)) {
  console.error('FAIL: ganCostUsd not passed from reportNode'); process.exit(1);
}
// buildHarnessReportInsert 把 ganRounds/ganCostUsd 映射成 gan_rounds/gan_cost_usd payload 字段
const sp = fs.readFileSync('packages/brain/src/staging-promote.js', 'utf8');
if (!/gan_rounds: args\.ganRounds/.test(sp) || !/gan_cost_usd: args\.ganCostUsd/.test(sp)) {
  console.error('FAIL: gan_rounds/gan_cost_usd not mapped in buildHarnessReportInsert payload'); process.exit(1);
}
console.log('✅ harness-reporter smoke: gan_rounds + gan_cost_usd 流经 spawnHarnessReport → buildHarnessReportInsert payload');
"
