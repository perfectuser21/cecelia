#!/usr/bin/env bash
# B32 smoke: verify brain 代为 push fallback 逻辑在 graph.js 内
# 检查 harness-initiative.graph.js 包含 ls-remote 检查 + git push origin 代执行
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[B32 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');
const checks = [
  { name: 'git push origin 代为 push', regex: /git['\"]?\s*,\s*\[['\"]push['\"]\s*,\s*['\"]origin['\"]/ },
  { name: 'ls-remote 检查 propose branch', regex: /ls-remote.*origin/i },
];
let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; }
}
if (fail) process.exit(1);
console.log('[B32 smoke] PASS');
" || { echo '[B32 smoke] FAIL'; exit 1; }
