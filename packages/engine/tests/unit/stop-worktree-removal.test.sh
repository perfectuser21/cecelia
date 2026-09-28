#!/usr/bin/env bash
# 手工验证 stop_hook_remove_merged_worktree：locked worktree 必须真正被删除，
# 且"已清理"日志只在真实删除成功时打印（回归修复：此前无条件打印导致假成功）
# 用法：bash packages/engine/tests/unit/stop-worktree-removal.test.sh
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../hooks" && pwd)"

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

echo "=== 搭建测试仓库 ==="
REPO="$TMPDIR_TEST/repo"
mkdir -p "$REPO"
cd "$REPO"
git init -q -b main
git config core.hooksPath /dev/null
git config user.email "test@test.com"
git config user.name "Test"
echo "init" > README.md
git add README.md
git commit -q -m "init"

echo "=== 场景 1：locked worktree（模拟 impact-contract-fix 复现案例）==="
git branch merged-locked
git worktree add -q "$TMPDIR_TEST/wt-locked" merged-locked
git worktree lock "$TMPDIR_TEST/wt-locked"

echo "=== source 共享判定/清理逻辑库 ==="
source "$LIB_DIR/lib/worktree-guard.sh"

echo "=== 断言场景 1：locked worktree 必须被真正删除，且打印成功日志 ==="
SCENARIO1_LOG="$TMPDIR_TEST/scenario1.log"
if stop_hook_remove_merged_worktree "$TMPDIR_TEST/wt-locked" "merged-locked" 2>"$SCENARIO1_LOG"; then
    SCENARIO1_RC=0
else
    SCENARIO1_RC=$?
fi

[[ "$SCENARIO1_RC" -eq 0 ]] || { echo "FAIL: locked worktree 应该删除成功（回归：--force --force 才能覆盖 lock）"; cat "$SCENARIO1_LOG"; exit 1; }
grep -q "已清理已合并 PR 孤儿 worktree: merged-locked" "$SCENARIO1_LOG" || { echo "FAIL: 应打印已清理成功日志"; cat "$SCENARIO1_LOG"; exit 1; }
grep -q "remove 失败" "$SCENARIO1_LOG" && { echo "FAIL: 成功场景不应出现失败日志"; cat "$SCENARIO1_LOG"; exit 1; }
git -C "$REPO" worktree list | grep -q "wt-locked" && { echo "FAIL: worktree 应已从 git worktree list 消失"; exit 1; }

echo "=== 场景 2：对不存在的 worktree 路径调用，必须真实报失败，不能假报成功 ==="
SCENARIO2_LOG="$TMPDIR_TEST/scenario2.log"
if stop_hook_remove_merged_worktree "$TMPDIR_TEST/never-existed" "ghost-branch" 2>"$SCENARIO2_LOG"; then
    SCENARIO2_RC=0
else
    SCENARIO2_RC=$?
fi

[[ "$SCENARIO2_RC" -ne 0 ]] || { echo "FAIL: 对不存在的路径应该返回失败"; exit 1; }
grep -q "remove 失败（已忽略）: $TMPDIR_TEST/never-existed" "$SCENARIO2_LOG" || { echo "FAIL: 应打印 remove 失败日志"; cat "$SCENARIO2_LOG"; exit 1; }
grep -q "已清理已合并 PR 孤儿 worktree" "$SCENARIO2_LOG" && { echo "FAIL: 失败场景绝不能打印已清理成功日志（这正是本次要修的 bug）"; cat "$SCENARIO2_LOG"; exit 1; }

echo "=== 全部场景通过 ==="
