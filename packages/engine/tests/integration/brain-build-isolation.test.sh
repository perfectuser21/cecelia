#!/usr/bin/env bash
# brain-build-isolation.test.sh — v1.2.0 origin/main 隔离验证
#
# v1.2.0：build 用 git fetch origin + git archive FETCH_HEAD（origin/main）
#   不再用 git archive HEAD（HEAD 可能是 cp-* 分支，缺最新合并修复）
# v1.1.0：用 git archive 输出到临时 dir 构建（脏工作树/untracked 文件隔离）

set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/brain-build.sh"

# Test 1: brain-build.sh 用 git archive FETCH_HEAD（v1.2.0），不再单纯 HEAD
if grep -qE 'git -C .* archive --format=tar FETCH_HEAD' "$SCRIPT"; then
    pass "brain-build.sh 用 git archive FETCH_HEAD 作 docker build context (v1.2.0)"
else
    fail "brain-build.sh 没找到 git archive FETCH_HEAD"
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

# Test 7 (v1.2.0): cwd 在 cp-* 分支时，git archive FETCH_HEAD 仍取 origin/main 而非 HEAD
TMP3=$(mktemp -d)
( cd "$TMP3" && git init -q -b main )
echo "main-content" > "$TMP3/file.txt"
( cd "$TMP3" && git add file.txt && git -c user.email=t@t -c user.name=t commit -q -m "main" )
# 模拟 origin remote
TMP3_REMOTE=$(mktemp -d)
( cd "$TMP3_REMOTE" && git init -q --bare )
( cd "$TMP3" && git remote add origin "$TMP3_REMOTE" && git push -q origin main )
# 切到 cp-* 分支，改文件 + commit（模拟另一个 session 在 cp-* 工作）
( cd "$TMP3" && git checkout -q -b cp-other-work )
echo "cp-branch-content" > "$TMP3/file.txt"
( cd "$TMP3" && git add file.txt && git -c user.email=t@t -c user.name=t commit -q -m "cp work" )

# 现在 HEAD 是 cp-other-work（含 cp-branch-content），origin/main 是 main-content
EXTRACT3=$(mktemp -d)
( cd "$TMP3" && git fetch -q origin main && git archive --format=tar FETCH_HEAD | tar -x -C "$EXTRACT3" )

if [[ "$(cat "$EXTRACT3/file.txt")" == "main-content" ]]; then
    pass "v1.2.0: cwd 在 cp-* 分支时 git archive FETCH_HEAD 拿到 origin/main 不是 HEAD"
else
    fail "v1.2.0: 拿到了 cp-* 分支版本（实际: $(cat "$EXTRACT3/file.txt")），应该拿 main"
fi

# Test 8 (v1.2.0): brain-build.sh 含 git fetch origin
if grep -qE 'git -C .* fetch origin' "$SCRIPT"; then
    pass "v1.2.0: brain-build.sh 含 git fetch origin 拉最新 main"
else
    fail "v1.2.0: 缺 git fetch origin"
fi

rm -rf "$TMP" "$TMP2" "$TMP3" "$TMP3_REMOTE" "$EXTRACT" "$EXTRACT2" "$EXTRACT3"

echo ""
echo "=== brain-build-isolation: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
