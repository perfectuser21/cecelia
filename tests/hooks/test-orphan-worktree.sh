#!/usr/bin/env bash
# 测试 claude-launch.sh 的孤儿 worktree 自检与重建逻辑
# 覆盖 _handle_orphaned_worktree 函数的四个分支
set -euo pipefail

LAUNCHER="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/claude-launch.sh"
PASS=0
FAIL=0

_assert() {
    local name="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        echo "✅ PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "❌ FAIL: $name (期望 exit=$expected, 实际 exit=$actual)"
        FAIL=$((FAIL + 1))
    fi
}

# 把 _handle_orphaned_worktree 从 launcher 里提取出来，在测试子进程中直接调用。
# 用 sed 截取函数体（第一行到 ^}$），再追加调用语句后 exec bash。
_extract_fn() {
    sed -n '/_handle_orphaned_worktree()/,/^}/p' "$LAUNCHER"
}

# ────────────────────────────────────────────────────────────────────────────
# 场景 1：非 worktree 路径 → 函数应 return 1（无操作）
# ────────────────────────────────────────────────────────────────────────────
_test_non_worktree_path() {
    local tmpdir; tmpdir=$(mktemp -d)
    local exit_code=0

    bash -c "
$(_extract_fn)
_handle_orphaned_worktree
" 2>/dev/null <<< "" && exit_code=0 || exit_code=$?

    rm -rf "$tmpdir"
    # return 1 in bash → exit 1 in subshell → but we called with || exit_code=$?
    # function returns 1 → bash -c exits 1
    _assert "非 worktree 路径：无操作 return 1" "1" "$exit_code"
}

# ────────────────────────────────────────────────────────────────────────────
# 场景 2：路径匹配但 cwd 已在合法 worktree list 里 → 健康，return 1（跳过）
# ────────────────────────────────────────────────────────────────────────────
_test_healthy_worktree() {
    local tmpdir; tmpdir=$(mktemp -d)
    local main_repo="$tmpdir/main"
    local wt_path="$tmpdir/worktrees/cecelia/session-abc12345"

    # 建主仓
    git init -q "$main_repo"
    git -C "$main_repo" config user.email "t@t.com"
    git -C "$main_repo" config user.name "T"
    touch "$main_repo/README.md"
    git -C "$main_repo" add .
    git -C "$main_repo" commit -qm "init"

    # 建合法 worktree
    mkdir -p "$(dirname "$wt_path")"
    git -C "$main_repo" worktree add "$wt_path" -b "session-abc12345" HEAD 1>/dev/null 2>&1

    local exit_code=0
    bash -c "
cd \"$wt_path\"
$(_extract_fn)
_handle_orphaned_worktree
" 2>/dev/null && exit_code=0 || exit_code=$?

    rm -rf "$tmpdir"
    # 健康路径 return 1 → exit 1
    _assert "合法 worktree：健康跳过 return 1" "1" "$exit_code"
}

# ────────────────────────────────────────────────────────────────────────────
# 场景 3：孤儿目录 + 有 .meta → 自动重建 worktree，return 0
# ────────────────────────────────────────────────────────────────────────────
_test_orphan_with_meta() {
    local tmpdir; tmpdir=$(mktemp -d)
    local main_repo="$tmpdir/main"
    local wt_path="$tmpdir/worktrees/cecelia/session-dead1234"

    # 建主仓
    git init -q "$main_repo"
    git -C "$main_repo" config user.email "t@t.com"
    git -C "$main_repo" config user.name "T"
    touch "$main_repo/README.md"
    git -C "$main_repo" add .
    git -C "$main_repo" commit -qm "init"
    git -C "$main_repo" branch "session-dead1234" HEAD

    # 建孤儿目录：有路径、有 .meta，但没有 git worktree 注册
    mkdir -p "$wt_path"
    echo "$main_repo" > "${wt_path}.meta"

    local exit_code=0
    bash -c "
cd \"$wt_path\"
$(_extract_fn)
_handle_orphaned_worktree
" 2>/dev/null && exit_code=0 || exit_code=$?

    # 验证 worktree 已被重建（git worktree list 能找到）
    local rebuilt=0
    git -C "$main_repo" worktree list --porcelain 2>/dev/null | grep -qF "worktree $wt_path" && rebuilt=1 || true

    rm -rf "$tmpdir"

    _assert "孤儿 + .meta：重建成功 exit 0" "0" "$exit_code"
    _assert "孤儿 + .meta：worktree 列表中存在重建路径" "1" "$rebuilt"
}

# ────────────────────────────────────────────────────────────────────────────
# 场景 4：孤儿目录 + 无 .meta → 显著告警并 exit 1
# ────────────────────────────────────────────────────────────────────────────
_test_orphan_no_meta() {
    local tmpdir; tmpdir=$(mktemp -d)
    local wt_path="$tmpdir/worktrees/cecelia/session-nometa1"

    mkdir -p "$wt_path"
    # 不写 .meta

    local exit_code=0
    bash -c "
cd \"$wt_path\"
$(_extract_fn)
_handle_orphaned_worktree
" 2>/dev/null && exit_code=0 || exit_code=$?

    rm -rf "$tmpdir"
    _assert "孤儿 + 无 .meta：拒绝并 exit 1" "1" "$exit_code"
}

# ────────────────────────────────────────────────────────────────────────────
# 场景 5：CECELIA_NO_AUTO_WORKTREE=1 → 跳过检查 return 1
# ────────────────────────────────────────────────────────────────────────────
_test_escape_valve() {
    local tmpdir; tmpdir=$(mktemp -d)
    local wt_path="$tmpdir/worktrees/cecelia/session-escape1"
    mkdir -p "$wt_path"

    local exit_code=0
    CECELIA_NO_AUTO_WORKTREE=1 bash -c "
cd \"$wt_path\"
export CECELIA_NO_AUTO_WORKTREE=1
$(_extract_fn)
_handle_orphaned_worktree
" 2>/dev/null && exit_code=0 || exit_code=$?

    rm -rf "$tmpdir"
    _assert "逃生阀 CECELIA_NO_AUTO_WORKTREE=1：跳过 return 1" "1" "$exit_code"
}

# ────────────────────────────────────────────────────────────────────────────
# 运行所有测试
# ────────────────────────────────────────────────────────────────────────────
_test_non_worktree_path
_test_healthy_worktree
_test_orphan_with_meta
_test_orphan_no_meta
_test_escape_valve

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
