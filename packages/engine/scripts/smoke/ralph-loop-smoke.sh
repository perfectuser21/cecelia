#!/usr/bin/env bash
# ralph-loop-smoke.sh — v22 Ralph Loop 模式 smoke（PR-2 已 stub）
#
# 历史：12 case smoke 测 v22 cwd 路由 + dev-active-*.json + verify_dev_complete 决策
# 现状：v23 PR-2 hook 切到心跳模型（.cecelia/lights/ + mtime），原 case 不再适用
# 替代：v23 决策矩阵由 packages/engine/tests/hooks/stop-hook-v23-{decision,routing}.test.ts
# 后续：PR-3 范围会彻底删除本文件（含 integrity L6 引用 + ci.yml glob 自动包含）

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
STOP_DEV="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d -t ralph-smoke-XXXXXX)
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
echo "=== Ralph Loop Smoke (v22 stub): $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
