#!/usr/bin/env bash
# 测试 hooks/pre-commit 行为
set -euo pipefail

HOOK_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/hooks/pre-commit"
PASS=0
FAIL=0

run_test() {
    local name="$1"
    local expected_exit="$2"
    local branch="$3"
    local has_devmode="$4"

    local tmpdir
    tmpdir=$(mktemp -d)
    cd "$tmpdir"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git checkout -q -b "$branch" 2>/dev/null || true

    if [[ "$has_devmode" == "true" ]]; then
        touch ".dev-mode.${branch}"
        git add ".dev-mode.${branch}"
    fi

    echo "test" > test.txt
    git add test.txt

    local actual_exit=0
    GIT_DIR="$tmpdir/.git" bash "$HOOK_SRC" >/dev/null 2>&1 || actual_exit=$?

    cd /
    rm -rf "$tmpdir"

    if [[ "$actual_exit" == "$expected_exit" ]]; then
        echo "✅ PASS: $name"
        PASS=$((PASS+1))
    else
        echo "❌ FAIL: $name (expected exit=$expected_exit, got exit=$actual_exit)"
        FAIL=$((FAIL+1))
    fi
}

run_test "main 分支被拒绝" 1 "main" "false"
run_test "cp-* 分支无 .dev-mode 被拒绝" 1 "cp-0610134109-test-feature" "false"
run_test "cp-* 分支有 .dev-mode 放行" 0 "cp-0610134109-test-feature" "true"
run_test "feature/* 分支被拒绝" 1 "feature/my-feature" "false"

run_test_with_origin() {
    local name="$1"
    local expected_exit="$2"
    local branch="$3"
    local origin_url="$4"

    local tmpdir
    tmpdir=$(mktemp -d)
    cd "$tmpdir"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git checkout -q -b "$branch" 2>/dev/null || true
    git remote add origin "$origin_url"

    echo "test" > test.txt
    git add test.txt

    local actual_exit=0
    GIT_DIR="$tmpdir/.git" bash "$HOOK_SRC" >/dev/null 2>&1 || actual_exit=$?

    cd /
    rm -rf "$tmpdir"

    if [[ "$actual_exit" == "$expected_exit" ]]; then
        echo "✅ PASS: $name"
        PASS=$((PASS+1))
    else
        echo "❌ FAIL: $name (expected exit=$expected_exit, got exit=$actual_exit)"
        FAIL=$((FAIL+1))
    fi
}

run_test_with_origin "zenithjoy-skills 仓库 main 分支直接放行" 0 "main" "https://github.com/perfectuser21/zenithjoy-skills.git"
run_test_with_origin "非 zenithjoy-skills 仓库 main 分支仍被拒绝（对照组，防误伤）" 1 "main" "https://github.com/perfectuser21/cecelia.git"
run_test_with_origin "zenithjoy-skills-v2 仓库不应被误豁免（收紧匹配）" 1 "main" "https://github.com/perfectuser21/zenithjoy-skills-v2.git"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
