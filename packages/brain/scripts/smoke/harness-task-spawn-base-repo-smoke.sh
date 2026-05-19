#!/usr/bin/env bash
# harness-task-spawn-base-repo smoke — 验证 spawnNode baseRepo 透传逻辑
set -euo pipefail

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"

if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[harness-task-spawn-base-repo smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi

# TODO: 实现后改为真实断言
echo "[harness-task-spawn-base-repo smoke] STUB — not yet implemented"
exit 1
