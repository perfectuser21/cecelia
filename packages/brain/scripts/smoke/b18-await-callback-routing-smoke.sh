#!/usr/bin/env bash
# B18 smoke — 验证 brain 镜像内 routeAfterCallback 真在
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[B18 smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const checks = [
  { name: 'routeAfterCallback exported', regex: /export function routeAfterCallback/ },
  { name: 'awaitCallback exit≠0 转 ci_fail', regex: /ci_fail_type:\s*['\"]container_exit['\"]/ },
  { name: 'await_callback 条件 edge', regex: /addConditionalEdges\([\s\S]{0,80}['\"]await_callback['\"]\s*,\s*routeAfterCallback/ },
  { name: 'routeAfterFix 去 cap', regex: /^function routeAfterFix[\s\S]{0,200}return 'spawn'/m },
];
let fail=false;
for (const c of checks) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail=true; }
}
const mod = await import('./src/workflows/harness-task.graph.js');
if (typeof mod.routeAfterCallback !== 'function') { console.error('FAIL: routeAfterCallback 未 export'); fail=true; }
if (mod.routeAfterCallback({ ci_status:'fail', ci_fail_type:'container_exit' }) !== 'fix') { console.error('FAIL: container_exit 应返 fix'); fail=true; }
if (mod.routeAfterCallback({}) !== 'parse') { console.error('FAIL: normal 应返 parse'); fail=true; }
if (fail) process.exit(1);
console.log('[B18 smoke] PASS');
" || { echo "[B18 smoke] FAIL"; exit 1; }
