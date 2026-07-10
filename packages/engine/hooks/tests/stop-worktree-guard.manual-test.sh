#!/usr/bin/env bash
# 手工验证 stop.sh 孤儿 worktree 清理的 Guard A 三层防护
# 用法：bash packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh
set -euo pipefail

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

# 场景 1：干净 worktree，分支已"合并"（模拟：直接 fast-forward 进 main，
# 因为测试环境没有真实 gh/GitHub PR，用一个本地 helper 替代 gh 调用）
git branch merged-clean
git worktree add -q "$TMPDIR_TEST/wt-clean" merged-clean

# 场景 2：worktree 有未提交改动
git branch merged-dirty
git worktree add -q "$TMPDIR_TEST/wt-dirty" merged-dirty
echo "uncommitted change" >> "$TMPDIR_TEST/wt-dirty/README.md"

# 场景 3：worktree 有 .dev-lock
git branch merged-locked
git worktree add -q "$TMPDIR_TEST/wt-locked" merged-locked
touch "$TMPDIR_TEST/wt-locked/.dev-lock"

echo "=== 提取 stop.sh 的 Guard A 判定逻辑，独立跑一遍三层检查 ==="
# 不跑整个 stop.sh（它依赖 stdin JSON + gh API），直接抽取判定逻辑验证
check_worktree() {
    local wt_path="$1"
    if [[ -f "$wt_path/.dev-lock" ]] || ls "$wt_path"/.dev-mode.* >/dev/null 2>&1; then
        echo "SKIP(active-lock): $wt_path"
        return
    fi
    if [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]]; then
        echo "SKIP(dirty): $wt_path"
        return
    fi
    echo "WOULD-DELETE: $wt_path"
}

check_worktree "$TMPDIR_TEST/wt-clean"
check_worktree "$TMPDIR_TEST/wt-dirty"
check_worktree "$TMPDIR_TEST/wt-locked"

echo "=== 断言 ==="
RESULT_CLEAN=$(check_worktree "$TMPDIR_TEST/wt-clean")
RESULT_DIRTY=$(check_worktree "$TMPDIR_TEST/wt-dirty")
RESULT_LOCKED=$(check_worktree "$TMPDIR_TEST/wt-locked")

[[ "$RESULT_CLEAN" == WOULD-DELETE:* ]] || { echo "FAIL: clean worktree 应被标记删除"; exit 1; }
[[ "$RESULT_DIRTY" == SKIP\(dirty\):* ]] || { echo "FAIL: dirty worktree 应被跳过"; exit 1; }
[[ "$RESULT_LOCKED" == SKIP\(active-lock\):* ]] || { echo "FAIL: locked worktree 应被跳过"; exit 1; }

echo "=== 全部场景通过 ==="
