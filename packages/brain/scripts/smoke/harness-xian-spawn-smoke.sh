#!/usr/bin/env bash
# harness-xian-spawn-smoke — 验证 executor.js 不再把 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL
# 死开关透传给 initiative Docker 容器（旧 harness-task.graph.js 的 resolveExecutor 路由断言已删——
# 该图属死图，skill-relay 架构下不再被 invoke，不是本能力的真实生产者）。
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-xian-spawn smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

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
