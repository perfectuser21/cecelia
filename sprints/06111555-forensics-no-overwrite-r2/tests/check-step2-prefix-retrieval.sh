#!/usr/bin/env bash
# Golden Path Step 2 oracle — ls | grep <taskId 前缀> 两组取证文件均可检索（批量清理习惯不破坏）。
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd); cd "$ROOT"

DIR="$(mktemp -d)"
export CECELIA_PROMPT_DIR="$DIR"
export HOST_PROMPT_DIR="$DIR"
TASK="cf9ce514-task-step2"

node --input-type=module -e "
const mod = await import('./packages/brain/src/docker-executor.js');
const w = mod.__test__ && mod.__test__.writePromptFile;
if (typeof w !== 'function') { console.error('FAIL: writePromptFile 未导出'); process.exit(1); }
w('$TASK', 'RUN-A');
w('$TASK', 'RUN-B');
"

COUNT=$(ls "$DIR" | grep -c "^$TASK" || true)
if [ "$COUNT" -lt 2 ]; then
  echo "FAIL: ls|grep <taskId 前缀> 只检索到 $COUNT 个，期望 >=2（两组取证未并存或前缀被破坏）"
  ls -la "$DIR" || true
  exit 1
fi
echo "OK step2: prefix retrieval found $COUNT files"
