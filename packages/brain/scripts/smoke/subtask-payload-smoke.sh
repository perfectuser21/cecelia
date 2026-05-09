#!/usr/bin/env bash
# 验证：runSubTaskNode 注入 logical_task_id + 不共享 initiative worktree
set -uo pipefail
SRC="packages/brain/src/workflows/harness-initiative.graph.js"
[ -f "$SRC" ] || { echo "FAIL: $SRC 不存在"; exit 1; }

# logical_task_id 注入
if ! grep -q 'logical_task_id: subTask.id' "$SRC"; then
  echo "FAIL: 未含 logical_task_id 注入"; exit 1
fi

# worktreePath 共享被注释掉
INVOKE_LINES=$(awk '/await compiled\.invoke\(/,/\),\s*config\s*\)/' "$SRC")
if echo "$INVOKE_LINES" | grep -qE '^\s*worktreePath:\s*state\.worktreePath'; then
  echo "FAIL: invoke 仍传 worktreePath"; exit 1
fi

echo "✅ subtask-payload smoke PASS — logical_task_id 注入 + 不共享 worktree"
exit 0
