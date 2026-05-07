#!/usr/bin/env bash
# v22 legacy 测试 — PR-2 v23 心跳模型已不适用，stub 为 v23 sanity check
# 替代覆盖：packages/engine/tests/hooks/stop-hook-v23-{decision,routing}.test.ts
# PR-3 范围：彻底删除本文件
set -uo pipefail
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
STOP_DEV="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT

REPO="$TMPROOT/repo"
mkdir -p "$REPO"
( cd "$REPO" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init )

out=$(echo '{}' | CLAUDE_HOOK_CWD="$REPO" bash "$STOP_DEV" 2>&1; echo "EXIT:$?")
ec=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
if [[ "$ec" == "0" ]]; then
    echo "✅ v23 sanity：无 lights/ → exit 0（普通对话放行）"
    PASS=1
else
    echo "❌ v23 sanity：期望 exit 0，实际 $ec"
    FAIL=1
fi
echo ""
echo "=== Total: $((PASS+FAIL)) | PASS: $PASS | FAIL: $FAIL ==="
[[ "$FAIL" -eq 0 ]]
