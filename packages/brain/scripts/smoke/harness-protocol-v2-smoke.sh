#!/usr/bin/env bash
# Protocol v2 smoke — Brain 接管 git 操作，验证 harness-shared 导出 + 图节点使用约定路径
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[protocol-v2 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const shared = readFileSync('./src/harness-shared.js', 'utf8');
const taskGraph = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const initGraph = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');
const checks = [
  { name: 'harness-shared 导出 readPrFromGitState', src: shared, regex: /export\s+async\s+function\s+readPrFromGitState/ },
  { name: 'harness-shared 导出 readVerdictFile', src: shared, regex: /export\s+async\s+function\s+readVerdictFile/ },
  { name: 'harness-shared 读取 .cecelia/verdict.json', src: shared, regex: /\.cecelia.*verdict\.json|verdict\.json.*\.cecelia/ },
  { name: 'harness-task.graph 导入 readPrFromGitState', src: taskGraph, regex: /readPrFromGitState/ },
  { name: 'harness-task.graph 调用 readPrFromGitState', src: taskGraph, regex: /await\s+readPrFromGitState/ },
  { name: 'harness-task.graph 调用 readVerdictFile', src: taskGraph, regex: /await\s+readVerdictFile/ },
  { name: 'harness-initiative.graph 调用 readVerdictFile', src: initGraph, regex: /await\s+readVerdictFile/ },
];
let fail = false;
for (const c of checks) {
  if (!c.regex.test(c.src)) { console.error('FAIL:', c.name); fail = true; }
}
if (fail) process.exit(1);
console.log('[protocol-v2 smoke] PASS');
" || { echo '[protocol-v2 smoke] FAIL'; exit 1; }
