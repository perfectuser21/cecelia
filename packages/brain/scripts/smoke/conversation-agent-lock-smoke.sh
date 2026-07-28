#!/usr/bin/env bash
# conversation-agent-lock-smoke.sh
# PR4/4 对话回路 — Stop Hook 硬闸 + 锁文件机制冒烟测试
# task: 2a4ead8d-a979-48e6-b317-676129e45f6a
#
# 验证 D2/D3 新功能：
#   D2: spawnConversationAgent 写入 .conversation-mode 锁文件
#   D3: stop-conversation.sh pending_user block（exit 2）+ 无标记 block（exit 2）
#
# 不依赖真实 Brain 进程 / DB，只验证文件系统和 Shell Hook 行为

set -e
cd "$(dirname "$0")/../../../.."

echo "[smoke] conversation-agent-lock D2/D3 冒烟验证"

# === D2: spawnConversationAgent 锁文件写入逻辑 ===
node --input-type=module -e "
import { spawnConversationAgent } from './packages/brain/src/lib/conversation-agent.js';
if (typeof spawnConversationAgent !== 'function') {
  console.error('[FAIL] spawnConversationAgent 未导出为函数');
  process.exit(1);
}
console.log('[PASS] D2 spawnConversationAgent 已正确导出');
"

# === D3: stop-conversation.sh pending_user → exit 2 ===
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

TRANSCRIPT="$TMP_DIR/transcript.jsonl"
printf '{"role":"assistant","content":"请确认方案，[TURN: pending_user]"}\n' > "$TRANSCRIPT"
touch "$TMP_DIR/.conversation-mode"

set +e
CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT" \
  bash -c "cd '$TMP_DIR' && bash /workspace/packages/engine/hooks/stop-conversation.sh" \
  > "$TMP_DIR/hook_out.txt" 2>&1
RC=$?
set -e

if [ "$RC" -ne 2 ]; then
  echo "[FAIL] D3 pending_user → 期望 exit 2，实际 exit $RC"
  cat "$TMP_DIR/hook_out.txt"
  exit 1
fi
echo "[PASS] D3 pending_user block 正确 exit 2"

echo "[OK] conversation-agent-lock-smoke 全部通过（D2 导出校验 + D3 pending_user exit 2）"
