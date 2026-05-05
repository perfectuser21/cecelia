#!/usr/bin/env bash
# ralph-loop-mode.test.sh — Stop Hook Ralph Loop 模式 5 case 守门测试
# 验证三层防御：
#   1. 状态信号源切到主仓库根（不依赖 cwd）
#   2. assistant 删 .dev-mode 不影响（项目根状态文件主导）
#   3. hook 主动验证（不读 .dev-mode 字段）

set -uo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"
STOP_DEV="$REPO_ROOT/packages/engine/hooks/stop-dev.sh"

PASS=0; FAIL=0
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT

assert_contains() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == *"$expected"* ]]; then
        echo "✅ $label"
        PASS=$((PASS+1))
    else
        echo "❌ $label: 期望含 [$expected]，实际 [$got]"
        FAIL=$((FAIL+1))
    fi
}

assert_exit_code() {
    local label="$1" expected="$2" got="$3"
    if [[ "$got" == "$expected" ]]; then
        echo "✅ $label: exit=$got"
        PASS=$((PASS+1))
    else
        echo "❌ $label: exit=$got (期望 $expected)"
        FAIL=$((FAIL+1))
    fi
}

run_stop_dev() {
    local cwd="$1"
    local hook_session_id="${2:-}"  # v22: 可选 hook payload session_id
    # stop-dev.sh 用 CLAUDE_HOOK_CWD env（stop.sh 路由解析 stdin JSON 后 export）
    if [[ -n "$hook_session_id" ]]; then
        echo "{\"session_id\":\"$hook_session_id\",\"hook_event_name\":\"Stop\"}" | CLAUDE_HOOK_CWD="$cwd" bash "$STOP_DEV" 2>&1
    else
        echo '{}' | CLAUDE_HOOK_CWD="$cwd" bash "$STOP_DEV" 2>&1
    fi
    echo "EXIT:$?"
}

# Case A: .cecelia/dev-active 不存在 → 普通对话放行（exit 0）
A_REPO="$TMPROOT/case-a"
mkdir -p "$A_REPO"
( cd "$A_REPO" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init )
out=$(run_stop_dev "$A_REPO")
exit_code=$(echo "$out" | grep -oE 'EXIT:[0-9]+' | sed 's/EXIT://')
assert_exit_code "Case A 状态文件不存在 → exit 0" "0" "$exit_code"

# Case B: 状态文件存在 + cwd 在 worktree + PR 未创建 → block
B_REPO="$TMPROOT/case-b"
B_WT="$TMPROOT/case-b-worktree"
mkdir -p "$B_REPO/.cecelia"
( cd "$B_REPO" && git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init && git worktree add "$B_WT" -b cp-test-b 2>/dev/null )
cat > "$B_REPO/.cecelia/dev-active-cp-test-b.json" <<EOF
{"branch":"cp-test-b","worktree":"$B_WT","started_at":"2026-05-04T00:00:00Z","session_id":"test"}
EOF
out=$(run_stop_dev "$B_WT")
assert_contains "Case B PR 未创建 → block" "decision" "$out"

# Case C v22: cwd 漂到主仓库 + hook session_id=test（命中 dev-active.session_id）→ 仍 block
# 关键修复：v22 漂主仓库防护从"主分支+单 dev-active"换成"hook session_id 精确路由"
out_c=$(run_stop_dev "$B_REPO" "test")
assert_contains "Case C v22 cwd 漂主仓库 + session_id 命中 → 仍 block（session_id 路由不依赖 cwd）" "decision" "$out_c"

# Case D: 状态文件存在 + assistant 删了 .dev-mode → 仍 block（关键测试自删漏洞）
rm -f "$B_WT/.dev-mode.cp-test-b" 2>/dev/null || true
out_d=$(run_stop_dev "$B_WT")
assert_contains "Case D 删 .dev-mode → 仍 block（关键修复）" "decision" "$out_d"

# Case E: 完成路径完整 mock 复杂，由 E2E 12 场景覆盖
echo "ℹ️  Case E 完成路径完整验证由 E2E 12 场景覆盖"

echo ""
echo "=== Total: $((PASS+FAIL)) | PASS: $PASS | FAIL: $FAIL ==="
[[ "$FAIL" -eq 0 ]]
