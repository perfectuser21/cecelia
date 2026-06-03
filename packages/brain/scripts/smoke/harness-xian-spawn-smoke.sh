#!/usr/bin/env bash
# harness-xian-spawn-smoke — 验证 harness 已收编进 DB 驱动的 resolveExecutor 路由，
# 旧的 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL 全局开关已彻底移除（死代码）。
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-xian-spawn smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

# harness-task.graph.js：用 resolveExecutor 路由，不再引用 HARNESS_XIAN 全局开关。
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const must = [
  { name: 'graph 引用 resolveExecutor 路由', regex: /resolveExecutor/ },
];
const mustNot = [
  { name: 'graph 不再含 HARNESS_XIAN_ENABLED 全局开关', regex: /HARNESS_XIAN_ENABLED/ },
  { name: 'graph 不再含 HARNESS_XIAN_BRIDGE_URL 全局开关', regex: /HARNESS_XIAN_BRIDGE_URL/ },
];
let fail = false;
for (const c of must) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; } else { console.log('OK:', c.name); }
}
for (const c of mustNot) {
  if (c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; } else { console.log('OK:', c.name); }
}
if (fail) process.exit(1);
console.log('[harness-xian-spawn smoke] PASS (harness-task.graph.js)');
" || { echo "[harness-xian-spawn smoke] FAIL"; exit 1; }

# executor.js：不再把 HARNESS_XIAN 死开关透传给 initiative Docker 容器。
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/executor.js', 'utf8');
const mustNot = [
  { name: 'executor.js 不再透传 HARNESS_XIAN_ENABLED', regex: /dockerEnv\.HARNESS_XIAN_ENABLED/ },
  { name: 'executor.js 不再透传 HARNESS_XIAN_BRIDGE_URL', regex: /dockerEnv\.HARNESS_XIAN_BRIDGE_URL/ },
];
let fail = false;
for (const c of mustNot) {
  if (c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; } else { console.log('OK:', c.name); }
}
if (fail) process.exit(1);
console.log('[harness-xian-spawn smoke] PASS (executor.js no passthrough)');
" || { echo "[harness-xian-spawn smoke] FAIL (executor passthrough)"; exit 1; }
