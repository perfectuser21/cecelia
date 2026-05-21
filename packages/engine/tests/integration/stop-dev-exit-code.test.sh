#!/usr/bin/env bash
# stop-dev-exit-code.test.sh — verify stop-dev.sh exit code for block/release paths
# Fix v24 regression: exit 0 hardcoded, block path should exit 2
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STOP_HOOK="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

build_main() {
    local TMP=$(mktemp -d)
    (cd "$TMP" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init)
    mkdir -p "$TMP/.cecelia/lights"
    echo "$TMP"
}

inject_classify_mock() {
    local repo="$1" status="$2"
    mkdir -p "$repo/packages/engine/lib"
    cat > "$repo/packages/engine/lib/devloop-check.sh" <<MOCK
#!/usr/bin/env bash
classify_session() { echo "{\"status\":\"${status}\",\"reason\":\"mock-${status}\",\"action\":\"mock action\"}"; return 0; }
log_hook_decision() { :; }
MOCK
}

SESSION="testsid1-full-uuid"
SID="${SESSION:0:8}"

# T-exit-block: block path must exit 2
TMP=$(build_main)
LIGHT="$TMP/.cecelia/lights/${SID}-cp-test.live"
echo "{\"session_id\":\"$SESSION\",\"branch\":\"cp-test\",\"guardian_pid\":99999}" > "$LIGHT"
inject_classify_mock "$TMP" "blocked"
exit_code=0
CLAUDE_HOOK_CWD="$TMP" CLAUDE_HOOK_SESSION_ID="$SESSION" bash "$STOP_HOOK" </dev/null >/dev/null 2>&1 || exit_code=$?
if [[ "$exit_code" == "2" ]]; then
    pass "T-exit-block: block path exit code = 2"
else
    fail "T-exit-block: block path exit code = $exit_code (expected 2)"
fi
rm -rf "$TMP"

# T-exit-release: release path must exit 0 (no lights -> all_dark -> release)
TMP=$(build_main)
exit_code=0
CLAUDE_HOOK_CWD="$TMP" CLAUDE_HOOK_SESSION_ID="$SESSION" bash "$STOP_HOOK" </dev/null >/dev/null 2>&1 || exit_code=$?
if [[ "$exit_code" == "0" ]]; then
    pass "T-exit-release: release path exit code = 0"
else
    fail "T-exit-release: release path exit code = $exit_code (expected 0)"
fi
rm -rf "$TMP"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
