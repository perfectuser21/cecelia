#!/usr/bin/env bash
# base-repo-support smoke — 验证 harness-initiative.graph.js 含 base_repo 透传逻辑
#
# 不需要真启 Brain；在 brain 容器内做源码断言。
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[base-repo-support smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');

const checks = [
  { name: 'prepInitiativeNode 读 base_repo',   regex: /state\\.task\??\\.payload\??\\.base_repo/ },
  { name: 'runGanLoopNode/runSubTaskNode 读 base_repo', regex: /state\\.task\??\\.payload\??\\.base_repo/ },
  { name: 'baseRepo 传入 ensureHarnessWorktree', regex: /ensureHarnessWorktree\(\s*\{[^}]*baseRepo/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) {
    console.error('FAIL:', c.name, '未命中', String(c.regex));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[base-repo-support smoke] PASS — 3 项源码断言通过');
" || { echo "[base-repo-support smoke] FAIL"; exit 1; }
