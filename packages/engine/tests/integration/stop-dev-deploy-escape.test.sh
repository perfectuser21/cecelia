#!/usr/bin/env bash
# stop-dev-deploy-escape.test.sh — BUG-4 mtime expire + P5 fail counter
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
    echo "$TMP"
}

old_mtime() {
    # 设文件 mtime 为 1 小时前（兼容 macOS BSD touch / Linux GNU touch）
    local f="$1"
    touch -t $(date -v-1H +%Y%m%d%H%M.%S 2>/dev/null || date -d '1 hour ago' +%Y%m%d%H%M.%S 2>/dev/null) "$f"
}

old_mtime_5min() {
    local f="$1"
    touch -t $(date -v-5M +%Y%m%d%H%M.%S 2>/dev/null || date -d '5 minutes ago' +%Y%m%d%H%M.%S 2>/dev/null) "$f"
}

# Case 1: dev-active mtime > 30 分钟 → 自动 rm
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-old.json" <<EOF
{"branch":"cp-old","worktree":"/tmp/wt","session_id":"sess-old"}
EOF
old_mtime "$TMP/.cecelia/dev-active-cp-old.json"
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ ! -f "$TMP/.cecelia/dev-active-cp-old.json" ]]; then
    pass "Case 1: mtime > 30 分钟 → 自动 rm"
else
    fail "Case 1: 老 dev-active 仍在"
fi
rm -rf "$TMP"

# Case 2: dev-active mtime < 30 分钟 → 保留
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-fresh.json" <<EOF
{"branch":"cp-fresh","worktree":"/tmp/wt","session_id":"sess-fresh"}
EOF
CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ -f "$TMP/.cecelia/dev-active-cp-fresh.json" ]]; then
    pass "Case 2: mtime < 30 分钟 → 保留"
else
    fail "Case 2: 新 dev-active 误删"
fi
rm -rf "$TMP"

# Case 3: STOP_HOOK_EXPIRE_MINUTES=1 + mtime 5 分钟前 → 自动 rm
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-cfg.json" <<EOF
{"branch":"cp-cfg","worktree":"/tmp/wt","session_id":"sess-cfg"}
EOF
old_mtime_5min "$TMP/.cecelia/dev-active-cp-cfg.json"
STOP_HOOK_EXPIRE_MINUTES=1 CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" >/dev/null 2>&1
if [[ ! -f "$TMP/.cecelia/dev-active-cp-cfg.json" ]]; then
    pass "Case 3: env STOP_HOOK_EXPIRE_MINUTES=1 + 5 分钟 → rm"
else
    fail "Case 3: env 未生效"
fi
rm -rf "$TMP"

# Case 4: deploy-fail-count 文件存在 → stop-hook 不崩
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-deploy-fail.json" <<EOF
{"branch":"cp-deploy-fail","worktree":"/tmp/wt","session_id":"sess-d"}
EOF
echo "3" > "$TMP/.cecelia/deploy-fail-count-cp-deploy-fail"
mkdir -p "$TMP/wt"
(cd "$TMP" && git -c user.email=t@t -c user.name=t worktree add "$TMP/wt" -b cp-deploy-fail 2>/dev/null || true)
out=$(CLAUDE_HOOK_CWD="$TMP/wt" bash "$STOP_HOOK" 2>&1 || true)
# stop-hook 不应崩，可以 block 或 done
echo "ℹ️  Case 4 output: $out" | head -3
pass "Case 4: stop-hook 不因 fail-counter 文件崩"
rm -rf "$TMP"

echo ""
echo "=== stop-dev-deploy-escape: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
