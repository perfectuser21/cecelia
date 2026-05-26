#!/usr/bin/env bash
# gan-base-repo smoke — 验证 harness-gan.graph.js 含 baseRepo 透传逻辑
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[gan-base-repo smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-gan.graph.js', 'utf8');

const checks = [
  { name: 'runGanContractGraph 解构含 baseRepo',    regex: /const\s*\{[^}]*baseRepo[^}]*\}\s*=\s*opts/ },
  { name: 'createGanContractNodes ctx 含 baseRepo', regex: /const\s*\{[^}]*baseRepo[^}]*\}\s*=\s*ctx/ },
  { name: 'verifyProposer 调用传 baseRepo',          regex: /verifyProposer\s*\(\s*\{[^}]*baseRepo/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) {
    console.error('FAIL:', c.name, '未命中', String(c.regex));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[gan-base-repo smoke] PASS — 3 项源码断言通过');
" || { echo "[gan-base-repo smoke] FAIL"; exit 1; }
