#!/usr/bin/env bash
# dev-mode-tool-guard.test.sh — PreToolUse 拦截器 5 case 测试

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
GUARD="$REPO_ROOT/hooks/dev-mode-tool-guard.sh"

PASS=0
FAIL=0
TMPROOT=$(mktemp -d -t guard-test-XXXXXX)
trap 'rm -rf "$TMPROOT"' EXIT

make_repo() {
    local repo="$1"
    mkdir -p "$repo"
    ( cd "$repo" && git init -q -b main && git -c user.email=t@t.com -c user.name=t commit -q --allow-empty -m init )
}

activate_dev() {
    local repo="$1" branch="$2"
    mkdir -p "$repo/.cecelia/lights"
    local sid_short="testsess"
    cat > "$repo/.cecelia/lights/${sid_short}-${branch}.live" <<EOF
{"branch":"$branch","worktree_path":"$repo","started_at":"2026-05-04T00:00:00Z","session_id":"test"}
EOF
}

run_guard() {
    local cwd="$1" tool_name="$2" extra_input="${3:-}"
    local stdin_json="{\"session_id\":\"test\",\"cwd\":\"$cwd\",\"tool_name\":\"$tool_name\""
    [[ -n "$extra_input" ]] && stdin_json="${stdin_json},${extra_input}"
    stdin_json="${stdin_json}}"
    echo "$stdin_json" | bash "$GUARD" 2>&1
    echo "EXIT:$?"
}

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

# Case A: 无 live light → ScheduleWakeup 放行
echo "=== Case A: 无 live light → ScheduleWakeup 放行 ==="
A_REPO="$TMPROOT/case-a"
make_repo "$A_REPO"
out=$(run_guard "$A_REPO" "ScheduleWakeup")
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit "Case A 放行" "0" "$exit_code"

# Case B: live light 存在 → ScheduleWakeup 被拦
echo ""
echo "=== Case B: live light → ScheduleWakeup 拦截 ==="
B_REPO="$TMPROOT/case-b"
make_repo "$B_REPO"
activate_dev "$B_REPO" "cp-test-b"
out=$(run_guard "$B_REPO" "ScheduleWakeup")
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit "Case B 拦截" "2" "$exit_code"
assert_contains "Case B reason 含 ScheduleWakeup" "ScheduleWakeup" "$out"
assert_contains "Case B reason 含 foreground" "foreground" "$out"

# Case C: live light + Bash run_in_background:true → 被拦
echo ""
echo "=== Case C: live light + Bash bg=true → 拦 ==="
C_REPO="$TMPROOT/case-c"
make_repo "$C_REPO"
activate_dev "$C_REPO" "cp-test-c"
out=$(run_guard "$C_REPO" "Bash" '"tool_input":{"command":"echo hi","run_in_background":true}')
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit "Case C 拦截" "2" "$exit_code"
assert_contains "Case C reason 含 run_in_background" "run_in_background" "$out"

# Case D: live light + Bash run_in_background:false → 放行
echo ""
echo "=== Case D: live light + Bash bg=false → 放行 ==="
D_REPO="$TMPROOT/case-d"
make_repo "$D_REPO"
activate_dev "$D_REPO" "cp-test-d"
out=$(run_guard "$D_REPO" "Bash" '"tool_input":{"command":"echo hi","run_in_background":false}')
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit "Case D 放行" "0" "$exit_code"

# Case E: live light + Bash 无 background 字段 → 放行（默认 false）
echo ""
echo "=== Case E: Bash 无 bg 字段 → 放行 ==="
E_REPO="$TMPROOT/case-e"
make_repo "$E_REPO"
activate_dev "$E_REPO" "cp-test-e"
out=$(run_guard "$E_REPO" "Bash" '"tool_input":{"command":"echo hi"}')
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit "Case E 放行" "0" "$exit_code"

echo ""
echo "=== dev-mode-tool-guard: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
