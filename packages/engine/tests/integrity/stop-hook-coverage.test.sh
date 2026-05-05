#!/usr/bin/env bash
# stop-hook-coverage.test.sh — 元测试：stop hook 测试套有没有真被 CI 跑 + 配置真接通
set -uo pipefail
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$THIS_DIR/../../../.." && pwd)"

PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

CI_YAML_FILES=$(find "$REPO_ROOT/.github/workflows" -name "*.yml" 2>/dev/null)

expect_in_ci() {
    local pattern="$1"
    local label="$2"
    if grep -qE "$pattern" $CI_YAML_FILES 2>/dev/null; then
        pass "$label 在 CI workflow"
    else
        fail "$label 未接 CI（死代码）"
    fi
}

# 1-6: 关键 .test.sh / smoke.sh 在 CI workflow 引用
expect_in_ci 'verify-dev-complete\.test\.sh|tests/unit/.*test\.sh|tests/unit/\*\.test\.sh' "verify-dev-complete unit"
expect_in_ci 'stop-hook-7stage-flow|tests/integration/.*test\.sh|tests/integration/\*\.test\.sh' "stop-hook-7stage-flow integration"
expect_in_ci 'ralph-loop-mode|tests/integration/.*test\.sh|tests/integration/\*\.test\.sh' "ralph-loop-mode integration"
expect_in_ci 'dev-mode-tool-guard|tests/integration/.*test\.sh|tests/integration/\*\.test\.sh' "dev-mode-tool-guard integration"
expect_in_ci 'stop-hook-7stage-smoke|scripts/smoke/.*-smoke\.sh|scripts/smoke/\*-smoke\.sh' "stop-hook-7stage-smoke"
expect_in_ci 'ralph-loop-smoke|scripts/smoke/.*-smoke\.sh|scripts/smoke/\*-smoke\.sh' "ralph-loop-smoke"

# 7: stop-dev.sh 调 verify_dev_complete
if grep -q 'verify_dev_complete' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 调用 verify_dev_complete"
else
    fail "stop-dev.sh 未调 verify_dev_complete"
fi

# 8: P5 启用
if grep -qE 'VERIFY_DEPLOY_WORKFLOW.*=.*1' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 启用 VERIFY_DEPLOY_WORKFLOW=1"
else
    fail "stop-dev.sh P5 disabled（功能死）"
fi

# 9: P6 启用
if grep -qE 'VERIFY_HEALTH_PROBE.*=.*1' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 启用 VERIFY_HEALTH_PROBE=1"
else
    fail "stop-dev.sh P6 disabled（功能死）"
fi

# 10: ghost 过滤
if grep -qE 'is_ghost|session_id.*unknown' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 含 ghost 过滤逻辑"
else
    fail "stop-dev.sh 无 ghost 过滤"
fi

# 11: PreToolUse 拦截器存在
if [[ -f "$REPO_ROOT/packages/engine/hooks/dev-mode-tool-guard.sh" ]]; then
    pass "dev-mode-tool-guard.sh 存在"
else
    fail "dev-mode-tool-guard.sh 缺失"
fi

echo ""
echo "=== integrity: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
