#!/usr/bin/env bash
# stop-dev-session-id-routing.test.sh — v22.0.0 session_id 精确路由验证
#
# 覆盖 PRD 5 个 BEHAVIOR：
#   1. 单 session 单 task：hook session_id 命中自己 dev-active
#   2. 多 session 多 task 并行：A1 hook 只看 A1，B1 只看 B1（物理隔离）
#   3. session 漂主仓库：hook 仍能找到自己 dev-active（不依赖 cwd）
#   5. 普通对话不在 /dev：session_id 不匹配 → exit 0 放行
#
# Case 4（空启动 5min GC）留 followup PR。
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

build() {
    local TMP=$(mktemp -d)
    (cd "$TMP" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init)
    mkdir -p "$TMP/.cecelia"
    cat > "$TMP/.cecelia/dev-active-cp-aaa.json" <<EOF
{"branch":"cp-aaa","worktree":"$TMP/wt-aaa","session_id":"sess-A1"}
EOF
    cat > "$TMP/.cecelia/dev-active-cp-bbb.json" <<EOF
{"branch":"cp-bbb","worktree":"$TMP/wt-bbb","session_id":"sess-B1"}
EOF
    echo "$TMP"
}

# Case 1: hook session_id=sess-A1 → 路由到 cp-aaa（命中 session_id 字段）
TMP=$(build)
out=$(echo '{"session_id":"sess-A1","hook_event_name":"Stop"}' | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
if echo "$out" | grep -q 'cp-aaa'; then
    pass "Case 1: session_id=sess-A1 → 路由到 cp-aaa"
else
    fail "Case 1: 输出不含 cp-aaa: $out"
fi
if echo "$out" | grep -q 'cp-bbb'; then
    fail "Case 1: 误路由到 cp-bbb: $out"
else
    pass "Case 1: 隔离正确（未触动 cp-bbb）"
fi
rm -rf "$TMP"

# Case 2: hook session_id=sess-B1 → 路由到 cp-bbb（多 session 物理隔离核心）
TMP=$(build)
out=$(echo '{"session_id":"sess-B1","hook_event_name":"Stop"}' | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
if echo "$out" | grep -q 'cp-bbb'; then
    pass "Case 2: session_id=sess-B1 → 路由到 cp-bbb"
else
    fail "Case 2: 输出不含 cp-bbb: $out"
fi
if echo "$out" | grep -q 'cp-aaa'; then
    fail "Case 2: 误路由到 cp-aaa: $out"
else
    pass "Case 2: 隔离正确（未触动 cp-aaa）"
fi
rm -rf "$TMP"

# Case 3: hook session_id 不匹配任何 dev-active → exit 0
TMP=$(build)
out=$(echo '{"session_id":"sess-NEVER-CREATED","hook_event_name":"Stop"}' | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && ! echo "$out" | grep -q decision; then
    pass "Case 3: 不匹配 session_id → exit 0 放行"
else
    fail "Case 3: 异常 exit=$exit_code out=$out"
fi
rm -rf "$TMP"

# Case 4: 漂主仓库 + hook session_id=sess-A1 → 仍找到 cp-aaa（不依赖 cwd）
TMP=$(build)
out=$(echo '{"session_id":"sess-A1"}' | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
if echo "$out" | grep -q 'cp-aaa'; then
    pass "Case 4: 漂主仓库 cwd + session_id=sess-A1 → 仍找到 cp-aaa（不依赖 cwd）"
else
    fail "Case 4: 输出不含 cp-aaa: $out"
fi
rm -rf "$TMP"

# Case 5: 普通对话（无 hook session_id payload + cwd 主仓库）→ exit 0 放行
TMP=$(build)
out=$(echo '{}' | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && ! echo "$out" | grep -qE 'cp-aaa|cp-bbb'; then
    pass "Case 5: 普通对话主仓库 cwd → exit 0 放行（v22 不再误捕一个 dev-active）"
else
    fail "Case 5: 异常 exit=$exit_code out=$out"
fi
rm -rf "$TMP"

# Case 6: cwd 在 worktree wt-aaa + 无 hook session_id → cwd→branch fallback 找到 cp-aaa
TMP=$(build)
mkdir -p "$TMP/wt-aaa"
(cd "$TMP" && git branch cp-aaa 2>/dev/null || true)
(cd "$TMP" && git -c user.email=t@t -c user.name=t worktree add "$TMP/wt-aaa" cp-aaa 2>/dev/null || true)
out=$(echo '{}' | CLAUDE_HOOK_CWD="$TMP/wt-aaa" bash "$STOP_HOOK" 2>&1 || true)
if echo "$out" | grep -q 'cp-aaa'; then
    pass "Case 6: cwd=wt-aaa + 无 hook session_id → cwd→branch fallback 找到 cp-aaa"
else
    fail "Case 6: 输出不含 cp-aaa（fallback 失效）: $out"
fi
rm -rf "$TMP"

echo ""
echo "=== stop-dev-session-id-routing: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
