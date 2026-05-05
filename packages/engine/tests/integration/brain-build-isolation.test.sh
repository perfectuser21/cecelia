#!/usr/bin/env bash
# brain-build-isolation.test.sh — v1.1.0 git archive 隔离验证
#
# 验证 scripts/brain-build.sh 使用 git archive HEAD 输出到临时 dir 构建，
# 而不是从 cwd 工作树构建（避免脏工作树污染 image）。

set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/brain-build.sh"

# Test 1: brain-build.sh 用 git archive HEAD
if grep -qE 'git -C .* archive --format=tar HEAD' "$SCRIPT"; then
    pass "brain-build.sh 用 git archive HEAD 作 docker build context"
else
    fail "brain-build.sh 没找到 git archive HEAD"
fi

# Test 2: 用 mktemp -d 隔离 build dir
if grep -qE 'TEMP_BUILD=\$\(mktemp -d' "$SCRIPT"; then
    pass "用 mktemp 临时 dir 隔离 build context"
else
    fail "没用 mktemp 隔离"
fi

# Test 3: trap EXIT 清理临时 dir
if grep -qE 'trap.*TEMP_BUILD.*EXIT' "$SCRIPT"; then
    pass "trap EXIT 清理临时 dir（防泄漏）"
else
    fail "缺 trap EXIT 清理"
fi

# Test 4: docker build context 是 TEMP_BUILD 不是 ROOT_DIR（仅看非注释行）
NON_COMMENT_DOCKER_BUILD_TEMP=$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -cE 'docker build|"\$TEMP_BUILD"')
NON_COMMENT_BAD=$(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -cE '"\$ROOT_DIR"\s*$' || true)
if [[ "$NON_COMMENT_DOCKER_BUILD_TEMP" -gt 0 ]] && [[ "$NON_COMMENT_BAD" -eq 0 ]]; then
    pass "docker build 用 \${TEMP_BUILD} 作 context（不再用 \${ROOT_DIR}）"
else
    fail "docker build 还在用 \${ROOT_DIR} 作 context（实际命中行: $(grep -v '^[[:space:]]*#' "$SCRIPT" | grep -E '"\$ROOT_DIR"\s*$' | head -1))"
fi

# Test 5: 真实行为 — git archive HEAD 真的能隔离脏工作树
TMP=$(mktemp -d)
( cd "$TMP" && git init -q -b main )
echo "CLEAN-FROM-COMMIT" > "$TMP/test.txt"
( cd "$TMP" && git add test.txt && git -c user.email=t@t -c user.name=t commit -q -m "init" )
# 故意污染工作树
echo "DIRTY-WORKTREE-CHANGE" > "$TMP/test.txt"

EXTRACT=$(mktemp -d)
git -C "$TMP" archive --format=tar HEAD | tar -x -C "$EXTRACT"

if [[ "$(cat "$EXTRACT/test.txt")" == "CLEAN-FROM-COMMIT" ]]; then
    pass "git archive HEAD 隔离脏工作树（输出 commit 内容，不是工作树脏内容）"
else
    fail "git archive 把脏工作树打进了：$(cat "$EXTRACT/test.txt")"
fi

# Test 6: untracked 文件也被隔离
TMP2=$(mktemp -d)
( cd "$TMP2" && git init -q -b main )
echo "tracked" > "$TMP2/tracked.txt"
( cd "$TMP2" && git add tracked.txt && git -c user.email=t@t -c user.name=t commit -q -m "init" )
echo "untracked" > "$TMP2/SECRET-NEVER-COMMIT.txt"

EXTRACT2=$(mktemp -d)
git -C "$TMP2" archive --format=tar HEAD | tar -x -C "$EXTRACT2"

if [[ ! -f "$EXTRACT2/SECRET-NEVER-COMMIT.txt" ]]; then
    pass "git archive 不包含 untracked 文件（隔离脏工作树未追踪文件）"
else
    fail "git archive 把 untracked 文件打进了"
fi

rm -rf "$TMP" "$TMP2" "$EXTRACT" "$EXTRACT2"

echo ""
echo "=== brain-build-isolation: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
