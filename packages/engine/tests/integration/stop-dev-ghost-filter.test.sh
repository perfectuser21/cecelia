#!/usr/bin/env bash
# stop-dev-ghost-filter.test.sh — stop-dev.sh ghost 自动清理验证
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

# === Case 1: session_id="unknown" ghost 自动清理 ===
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && touch .gitkeep && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main)
mkdir -p "$TMP/.cecelia"
cat > "$TMP/.cecelia/dev-active-cp-ghost-1.json" <<EOF
{"branch":"cp-ghost-1","worktree":"/home/cecelia/worktrees/x","session_id":"unknown"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
exit_code=$?
if [[ ! -f "$TMP/.cecelia/dev-active-cp-ghost-1.json" ]]; then
    pass "Case 1: session_id=unknown 已自动 rm"
else
    fail "Case 1: ghost 仍在"
fi
[[ $exit_code -eq 0 ]] && pass "Case 1: stop-dev exit 0" || fail "Case 1: exit=$exit_code"
rm -rf "$TMP"

# === Case 2: worktree 不存在 + 0 commit ahead 自动清理 ===
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && touch .gitkeep && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main && git branch cp-ghost-2)
mkdir -p "$TMP/.cecelia"
cat > "$TMP/.cecelia/dev-active-cp-ghost-2.json" <<EOF
{"branch":"cp-ghost-2","worktree":"/nonexistent/wt","session_id":"realsess123"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ ! -f "$TMP/.cecelia/dev-active-cp-ghost-2.json" ]]; then
    pass "Case 2: worktree 不存在 + 0 commit 已 rm"
else
    fail "Case 2: ghost 仍在"
fi
rm -rf "$TMP"

# === Case 3: 真实 dev-active（worktree 存在）保留 ===
TMP=$(mktemp -d)
(cd "$TMP" && git init -q && touch .gitkeep && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git branch -M main)
mkdir -p "$TMP/.cecelia"
WT_REAL=$(mktemp -d)
cat > "$TMP/.cecelia/dev-active-cp-real-3.json" <<EOF
{"branch":"cp-real-3","worktree":"$WT_REAL","session_id":"realsess456"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ -f "$TMP/.cecelia/dev-active-cp-real-3.json" ]]; then
    pass "Case 3: 真实 dev-active 保留 (worktree 存在 → 触发 verify_dev_complete)"
else
    fail "Case 3: 真实 dev-active 被误 rm"
fi
rm -rf "$TMP" "$WT_REAL"

echo ""
echo "=== stop-dev-ghost-filter: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
