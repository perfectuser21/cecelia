#!/usr/bin/env bash
# harness-task-spawn-base-repo smoke — 验证 spawnNode baseRepo 透传逻辑
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-task-spawn-base-repo smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync } from 'fs';
const taskSrc = readFileSync('./src/workflows/harness-task.graph.js', 'utf8');
const initSrc = readFileSync('./src/workflows/harness-initiative.graph.js', 'utf8');

const checks = [
  { name: 'TaskState 含 baseRepo channel',                file: 'harness-task.graph.js',       src: taskSrc,  regex: /baseRepo\s*:\s*Annotation/ },
  { name: 'spawnNode ensureWt 传 baseRepo',               file: 'harness-task.graph.js',       src: taskSrc,  regex: /ensureWt\s*\(\s*\{[^}]*baseRepo\s*:/ },
  { name: 'runSubTaskNode compiled.invoke 含 baseRepo',   file: 'harness-initiative.graph.js', src: initSrc,  regex: /compiled\.invoke\s*\(\s*\{[\s\S]{0,700}baseRepo/ },
];

let fail = false;
for (const c of checks) {
  if (!c.regex.test(c.src)) {
    console.error('FAIL:', c.name, '未命中', String(c.regex));
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('[harness-task-spawn-base-repo smoke] PASS — 3 项源码断言通过');
" || { echo "[harness-task-spawn-base-repo smoke] FAIL"; exit 1; }
