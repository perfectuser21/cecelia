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

# 7 [v23 PR-2]: stop-dev.sh 读 .cecelia/lights/（心跳模型核心信号源）
# 替代 v22 的 verify_dev_complete 调用 — verify_dev_complete 函数本体留 PR-3 删
if grep -q '\.cecelia/lights' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 读 .cecelia/lights/（v23 心跳模型）"
else
    fail "stop-dev.sh 未读 .cecelia/lights/"
fi

# 8 [v23 PR-2]: stop-dev.sh 用 stat mtime 判定灯新鲜度（替代 v22 verify_dev_complete 的 P5/P6）
if grep -qE 'stat -[fc] %[mY]' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 用 stat mtime 判定灯新鲜度（v23 心跳模型）"
else
    fail "stop-dev.sh 未用 stat mtime"
fi

# 9 [v23 PR-2]: stop-dev.sh 有 TTL_SEC 配置（替代 v22 P5/P6 双轨道验证）
if grep -qE 'TTL_SEC|STOP_HOOK_LIGHT_TTL_SEC' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "stop-dev.sh 含 TTL_SEC（v23 灯新鲜度阈值）"
else
    fail "stop-dev.sh 缺 TTL_SEC"
fi

# 10 [v23 PR-2]: dev-heartbeat-guardian.sh 存在（PR-1 引入，PR-2 接入）
if [[ -f "$REPO_ROOT/packages/engine/lib/dev-heartbeat-guardian.sh" ]]; then
    pass "dev-heartbeat-guardian.sh 存在（v23 心跳守护）"
else
    fail "dev-heartbeat-guardian.sh 缺失"
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

# L11 [v23 PR-2]: stop-dev.sh 含 light_mtime / age 逻辑（替代 v22 EXPIRE_MINUTES dev-active mtime）
if grep -qE 'light_mtime|age=' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "L11 [v23]: stop-dev.sh 含 light_mtime/age 逻辑（心跳新鲜度判定）"
else
    fail "L11 [v23]: light_mtime/age 缺"
fi

# L12 [v23 PR-2]: stop-dev.sh 用 sid_short 文件名前缀做 session 路由（替代 v22 cwd→branch 路由）
if grep -qE 'sid_short|hook_session_id:0:8' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    pass "L12 [v23]: stop-dev.sh 用 sid_short 前缀路由（session_id 物理隔离）"
else
    fail "L12 [v23]: sid_short 路由缺"
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

# ============================================================================
# v18.22.1 invariant L15-L17（4 个 P1 修复 grep 验证）
# ============================================================================

# L15: .claude/settings.json 引用 dev-mode-tool-guard.sh
if [[ -f "$REPO_ROOT/.claude/settings.json" ]] && \
   grep -q 'dev-mode-tool-guard\.sh' "$REPO_ROOT/.claude/settings.json"; then
    pass "L15: settings.json 引用 dev-mode-tool-guard.sh"
else
    fail "L15: settings.json 未引用 dev-mode-tool-guard.sh"
fi

# L16: install-claude-settings.sh 存在 + 可执行（P1-4 跨机器 fallback）
if [[ -f "$REPO_ROOT/scripts/install-claude-settings.sh" ]] && \
   [[ -x "$REPO_ROOT/scripts/install-claude-settings.sh" ]]; then
    pass "L16: install-claude-settings.sh 存在且可执行（P1-4 跨机器 fallback）"
else
    fail "L16: install script 缺或不可执行"
fi

# L17: ci.yml engine-tests-shell 用 glob（P1-3 防新 .test.sh 漏接）
if grep -qE 'tests/integration/\*\.test\.sh' "$REPO_ROOT/.github/workflows/ci.yml"; then
    pass "L17: engine-tests-shell 用 glob 模式（P1-3 修复）"
else
    fail "L17: engine-tests-shell 仍是显式列表"
fi

# L18: feature-registry.yml 含 stop-hook feature 注册 + contract_url 指向 ZenithJoy（v18.22.3 升级）
if grep -qE '^  - id: stop-hook$' "$REPO_ROOT/packages/engine/feature-registry.yml" && \
   grep -q 'name: Stop Hook' "$REPO_ROOT/packages/engine/feature-registry.yml" && \
   grep -qE 'contract_url:.*357c40c2[-]?ba63[-]?81b8' "$REPO_ROOT/packages/engine/feature-registry.yml"; then
    pass "L18: feature-registry 含 stop-hook 完整 feature 注册（含 ZenithJoy contract_url）"
else
    fail "L18: stop-hook feature 未注册或 contract_url 未指向 ZenithJoy（357c40c2-ba63-81b8）"
fi

echo ""
echo "=== integrity: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
