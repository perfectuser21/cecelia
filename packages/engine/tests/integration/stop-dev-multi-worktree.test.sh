#!/usr/bin/env bash
# stop-dev-multi-worktree.test.sh — BUG-1 cwd 路由验证
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

build_main() {
    local TMP=$(mktemp -d)
    (cd "$TMP" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init)
    mkdir -p "$TMP/.cecelia"
    for b in cp-aaa cp-bbb cp-ccc; do
        cat > "$TMP/.cecelia/dev-active-${b}.json" <<EOF
{"branch":"${b}","worktree":"/tmp/wt-${b}","session_id":"sess-${b}"}
EOF
        (cd "$TMP" && git branch "$b" 2>/dev/null || true)
    done
    echo "$TMP"
}

# Case 1: cwd=主仓库 main → exit 0 不 verify 任何
TMP=$(build_main)
out=$(CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && ! echo "$out" | grep -qE 'decision'; then
    pass "Case 1: 主仓库 cwd → exit 0 不 verify"
else
    fail "Case 1: 异常 exit=$exit_code out=$out"
fi
[[ -f "$TMP/.cecelia/dev-active-cp-aaa.json" ]] && pass "Case 1: dev-active-aaa 保留" || fail "Case 1: aaa 误删"
rm -rf "$TMP"

# Case 2: cwd=cp-bbb worktree → 仅 verify cp-bbb，不见 cp-aaa/ccc
TMP=$(build_main)
mkdir -p "$TMP/wt-bbb"
(cd "$TMP" && git -c user.email=t@t -c user.name=t worktree add "$TMP/wt-bbb" cp-bbb 2>/dev/null || true)
out=$(CLAUDE_HOOK_CWD="$TMP/wt-bbb" bash "$STOP_HOOK" 2>&1 || true)
if echo "$out" | grep -q 'cp-bbb'; then
    pass "Case 2: cwd=wt-bbb verify 含 cp-bbb"
else
    fail "Case 2: 输出不含 cp-bbb: $out"
fi
if echo "$out" | grep -qE 'cp-aaa|cp-ccc'; then
    fail "Case 2: 误 verify cp-aaa/ccc: $out"
else
    pass "Case 2: 隔离正确（不 verify cp-aaa/ccc）"
fi
rm -rf "$TMP"

# Case 3: cwd=cp-bbb worktree 但 dev-active-cp-bbb 不存在 → exit 0
TMP=$(build_main)
rm "$TMP/.cecelia/dev-active-cp-bbb.json"
mkdir -p "$TMP/wt-bbb"
(cd "$TMP" && git -c user.email=t@t -c user.name=t worktree add "$TMP/wt-bbb" cp-bbb 2>/dev/null || true)
out=$(CLAUDE_HOOK_CWD="$TMP/wt-bbb" bash "$STOP_HOOK" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && ! echo "$out" | grep -q decision; then
    pass "Case 3: cp-bbb dev-active 不存在 → exit 0"
else
    fail "Case 3: 异常 exit=$exit_code"
fi
rm -rf "$TMP"

echo ""
echo "=== stop-dev-multi-worktree: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
