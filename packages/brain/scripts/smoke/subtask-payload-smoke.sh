#!/usr/bin/env bash
# 验证：runSubTaskNode 注入 logical_task_id + 不共享 initiative worktree
set -uo pipefail
SRC="packages/brain/src/workflows/harness-initiative.graph.js"
[ -f "$SRC" ] || { echo "FAIL: $SRC 不存在"; exit 1; }

# logical_task_id 注入
if ! grep -q 'logical_task_id: subTask.id' "$SRC"; then
  echo "FAIL: 未含 logical_task_id 注入"; exit 1
fi

# worktreePath 共享被注释掉 — 只检查 runSubTaskNode 函数体内的非注释行
RUNSUB_BODY=$(awk '/^export async function runSubTaskNode/,/^\}/' "$SRC")
# 过滤注释行后再 grep
UNCOMMENTED=$(echo "$RUNSUB_BODY" | grep -v '^\s*//' | grep -E 'worktreePath:\s*state\.worktreePath' || true)
if [ -n "$UNCOMMENTED" ]; then
  echo "FAIL: runSubTaskNode 仍传 worktreePath: state.worktreePath（非注释行）"
  echo "$UNCOMMENTED"
  exit 1
fi

echo "✅ subtask-payload smoke PASS — logical_task_id 注入 + 不共享 worktree"
exit 0
