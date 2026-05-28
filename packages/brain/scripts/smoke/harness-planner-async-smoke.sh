#!/usr/bin/env bash
# WS2 smoke: runPlannerNode 异步化验证
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "[smoke] WS2 Planner 节点异步化..."

# 1. 含 spawnDockerDetached import
grep -q "spawnDockerDetached" packages/brain/src/workflows/harness-initiative.graph.js && \
  echo "✅ spawnDockerDetached import 存在"

# 2. runPlannerNode 不含阻塞 reconnectOrSpawn
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
const s = c.indexOf('export async function runPlannerNode');
const e = c.indexOf('\nexport ', s + 1);
const fn = c.slice(s, e > 0 ? e : s + 5000);
if (fn.includes('reconnectOrSpawn')) { console.error('FAIL: 仍含阻塞 reconnectOrSpawn'); process.exit(1); }
console.log('✅ runPlannerNode 无阻塞 reconnectOrSpawn');
"

# 3. 含 interrupt() 调用
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
const s = c.indexOf('export async function runPlannerNode');
const e = c.indexOf('\nexport ', s + 1);
const fn = c.slice(s, e > 0 ? e : s + 5000);
if (!fn.includes('interrupt')) { console.error('FAIL: 缺少 interrupt()'); process.exit(1); }
console.log('✅ runPlannerNode 含 interrupt()');
"

echo "[smoke] WS2 all checks passed ✅"
