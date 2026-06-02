#!/usr/bin/env bash
# worktree-checkout-guard.test.sh — 主仓库 checkout 任务分支拦截测试
set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"   # → packages/engine
GUARD="$REPO_ROOT/hooks/worktree-checkout-guard.sh"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d -t wt-guard-XXXXXX)
trap 'git worktree prune 2>/dev/null; rm -rf "$TMPROOT"' EXIT

make_repo() {
    local r="$1"; mkdir -p "$r"
    ( cd "$r" && git init -q -b main && git -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init )
}

# 用 python3 安全 JSON 转义 command
run_guard() {
    local cwd="$1" cmd="$2"
    local esc; esc=$(printf '%s' "$cmd" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')
    echo "{\"cwd\":\"$cwd\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":$esc}}" | bash "$GUARD" 2>&1
    echo "EXIT:$?"
}

ec_of() { echo "$1" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://'; }

assert_exit() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then echo "✅ $label: exit=$got"; PASS=$((PASS+1))
    else echo "❌ $label: exit=$got (期望 $expected)"; FAIL=$((FAIL+1)); fi
}
assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then echo "✅ $label"; PASS=$((PASS+1))
    else echo "❌ $label: 缺 [$needle]"; FAIL=$((FAIL+1)); fi
}

MAIN="$TMPROOT/main-repo"; make_repo "$MAIN"

echo "=== Case A: 主仓库 checkout -b cp-* → 拦 ==="
out=$(run_guard "$MAIN" "git checkout -b cp-06021234-foo")
assert_exit "A checkout -b cp-* 拦截" "2" "$(ec_of "$out")"
assert_contains "A 含引导" "worktree" "$out"

echo "=== Case A2: 主仓库 checkout 已存在 cp-* → 拦 ==="
out=$(run_guard "$MAIN" "git checkout cp-06021234-foo")
assert_exit "A2 checkout cp-* 拦截" "2" "$(ec_of "$out")"

echo "=== Case A3: 主仓库 switch -c feature/* → 拦 ==="
out=$(run_guard "$MAIN" "git switch -c feature/bar")
assert_exit "A3 switch -c feature/* 拦截" "2" "$(ec_of "$out")"

echo "=== Case B: 主仓库 checkout main → 放行 ==="
out=$(run_guard "$MAIN" "git checkout main")
assert_exit "B checkout main 放行" "0" "$(ec_of "$out")"

echo "=== Case C: worktree 内 checkout cp-* → 放行 ==="
( cd "$MAIN" && git worktree add -q "$TMPROOT/wt-foo" -b cp-06021234-bar >/dev/null 2>&1 )
out=$(run_guard "$TMPROOT/wt-foo" "git checkout cp-06021234-baz")
assert_exit "C worktree 内放行" "0" "$(ec_of "$out")"

echo "=== Case D: 非 checkout 命令 → 放行 ==="
out=$(run_guard "$MAIN" "ls -la")
assert_exit "D 非 checkout 放行" "0" "$(ec_of "$out")"

echo "=== Case E: 文件路径 checkout → 放行 ==="
out=$(run_guard "$MAIN" "git checkout -- somefile.js")
assert_exit "E 路径 checkout 放行" "0" "$(ec_of "$out")"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
