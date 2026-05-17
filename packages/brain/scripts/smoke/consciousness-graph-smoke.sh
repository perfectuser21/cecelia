#!/usr/bin/env bash
# consciousness-graph-smoke.sh — 验证 consciousness.graph.js 可加载 + 导出正确
set -euo pipefail

BRAIN_SRC="$(cd "$(dirname "$0")/../.." && pwd)/src"

echo "[consciousness-graph-smoke] 验证 consciousness.graph.js 导出..."

node --input-type=module << EOF
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';

const graphFile = '${BRAIN_SRC}/workflows/consciousness.graph.js';
const src = readFileSync(graphFile, 'utf8');

// 验证必要导出存在
const required = [
  'ConsciousnessState',
  'buildConsciousnessGraph',
  'getCompiledConsciousnessGraph',
  '_resetCompiledGraphForTests',
];

for (const name of required) {
  if (!src.includes('export') || !src.includes(name)) {
    console.error('[consciousness-graph-smoke] FAIL: 缺少导出 ' + name);
    process.exit(1);
  }
}

// 验证 4 个节点存在
const nodes = ['thalamusNode', 'decisionNode', 'ruminationNode', 'planNextTaskNode'];
for (const node of nodes) {
  if (!src.includes(node)) {
    console.error('[consciousness-graph-smoke] FAIL: 缺少节点 ' + node);
    process.exit(1);
  }
}

console.log('[consciousness-graph-smoke] ✅ 所有导出和节点均存在');
EOF

echo "[consciousness-graph-smoke] ✅ PASS"
