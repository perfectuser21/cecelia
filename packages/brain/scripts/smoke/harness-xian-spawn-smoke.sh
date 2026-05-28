#!/usr/bin/env bash
# harness-xian-spawn-smoke — 验证 harness-task.graph.js 含 HARNESS_XIAN_ENABLED 分支逻辑
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-xian-spawn smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const checks = [
  { name: 'HARNESS_XIAN_ENABLED literal exists', regex: /HARNESS_XIAN_ENABLED/ },
  { name: 'strict === true check', regex: /=== ['\"']true['\"']/ },
  { name: 'HARNESS_XIAN_BRIDGE_URL env read', regex: /HARNESS_XIAN_BRIDGE_URL/ },
  { name: 'try/catch for Bridge fallback', regex: /try\s*\{[\s\S]{0,300}catch/ },
];
let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; }
  else { console.log('OK:', c.name); }
}
if (fail) process.exit(1);
console.log('[harness-xian-spawn smoke] PASS');
" || { echo "[harness-xian-spawn smoke] FAIL"; exit 1; }
