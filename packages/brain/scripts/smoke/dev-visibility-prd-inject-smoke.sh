#!/usr/bin/env bash
# dev-visibility smoke — 验证 buildGeneratorPrompt 正确注入 prdContent 到 generator prompt
#
# 检查三处（静态源码分析，在 host runner 上直接跑）：
#   1. harness-utils.js 含 prdContent 参数 + § Sprint PRD 段
#   2. harness-task.graph.js TaskState 含 prdContent Annotation
#   3. harness-initiative.graph.js runSubTaskNode 传 prdContent
set -euo pipefail

node --input-type=module -e "
import { readFileSync } from 'fs';

const utils = readFileSync('packages/brain/src/harness-utils.js', 'utf8');
const taskGraph = readFileSync('packages/brain/src/workflows/harness-task.graph.js', 'utf8');
const initGraph = readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');

const checks = [
  ['harness-utils.js: prdContent param', utils.includes('prdContent = null')],
  ['harness-utils.js: Sprint PRD section', utils.includes('## Sprint PRD')],
  ['harness-task.graph.js: prdContent Annotation', taskGraph.includes('prdContent:')],
  ['harness-task.graph.js: passes prdContent to buildGeneratorPrompt', taskGraph.includes('prdContent: state.prdContent')],
  ['harness-initiative.graph.js: passes prdContent in invoke', initGraph.includes('prdContent: state.prdContent')],
];

let allPass = true;
for (const [name, ok] of checks) {
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if (!ok) allPass = false;
}
if (!allPass) process.exit(1);
console.log('[dev-visibility smoke] ALL PASS');
"
