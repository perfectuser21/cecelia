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

# ============================================================================
# v18.22.0 invariant L11-L14（4 个 P0 修复 grep 验证）
# ============================================================================

# L11: stop-dev.sh 含 mtime expire 逻辑（BUG-4 修复）
if grep -qE 'EXPIRE_MINUTES|file_mtime|age_min' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "L11: stop-dev.sh 含 mtime expire 逻辑（BUG-4 修复）"
else
    fail "L11: BUG-4 mtime expire 缺"
fi

# L12: stop-dev.sh 含 cwd 路由（BUG-1 修复）
if grep -qE 'rev-parse --abbrev-ref HEAD' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" && \
   grep -qE 'case.*current_branch|case "\$current_branch"' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "L12: stop-dev.sh 含 cwd 路由（BUG-1 修复）"
else
    fail "L12: BUG-1 cwd 路由缺"
fi

# L13: devloop-check.sh 主 CI 查询必带 --workflow CI（BUG-2 修复）
violations=$(grep -nE 'gh run list --branch' "$REPO_ROOT/packages/engine/lib/devloop-check.sh" | grep -v -- '--workflow' | grep -v 'check\|reason\|action' | wc -l | tr -d ' ')
if [[ "$violations" -eq 0 ]]; then
    pass "L13: 所有 gh run list --branch 都带 --workflow（BUG-2 修复）"
else
    fail "L13: $violations 处 gh run list --branch 缺 --workflow"
fi

# L14: .claude/settings.json 在 repo + 含 PreToolUse（BUG-3 修复）
if [[ -f "$REPO_ROOT/.claude/settings.json" ]] && \
   command -v jq &>/dev/null && \
   jq -e '.hooks.PreToolUse | length > 0' "$REPO_ROOT/.claude/settings.json" >/dev/null 2>&1; then
    pass "L14: .claude/settings.json 含 PreToolUse 注册（BUG-3 修复）"
else
    fail "L14: BUG-3 settings 缺"
fi

echo ""
echo "=== integrity: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
