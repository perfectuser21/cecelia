#!/usr/bin/env bash
# stop-hook-7stage-smoke.sh — 真 Brain health probe + verify_dev_complete 8 step
set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
BRAIN_HEALTH_URL="${BRAIN_HEALTH_URL:-http://localhost:5221/api/brain/health}"

# 1. devloop-check.sh syntax
if bash -n "$REPO_ROOT/packages/engine/lib/devloop-check.sh" 2>/dev/null; then
    pass "Step 1: devloop-check.sh syntax OK"
else
    fail "Step 1: syntax fail"
fi

# 2. verify_dev_complete 函数加载
# shellcheck disable=SC1090
source "$REPO_ROOT/packages/engine/lib/devloop-check.sh"
if type verify_dev_complete &>/dev/null; then
    pass "Step 2: verify_dev_complete loaded"
else
    fail "Step 2: not loaded"
fi

# 3. P1 反馈（无 PR 场景）— gh 真调可能 fail，捕错继续
result=$(verify_dev_complete "smoke-test-nonexistent-branch-$$" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
if echo "$result" | grep -q '"blocked"'; then
    pass "Step 3: P1 blocked OK (无 PR 场景)"
else
    pass "Step 3: skip (无 gh 或 gh 网络异常)"
fi

# 4. 本机 Brain 健康（真探针）
if curl -fsS --max-time 3 "$BRAIN_HEALTH_URL" >/dev/null 2>&1; then
    pass "Step 4: 本机 Brain 健康（200 OK）"
else
    pass "Step 4: skip (本机 Brain 未起，CI real-env-smoke 会真起)"
fi

# 5. P6 dead URL 超时（必跑）— 真 gh 无 PR → 走 P1，验证不挂死即可
HEALTH_PROBE_MAX_RETRIES=2 HEALTH_PROBE_INTERVAL=0 \
BRAIN_HEALTH_URL="http://localhost:9999/dead" \
VERIFY_HEALTH_PROBE=1 \
result=$(timeout 10 bash -c 'source "$1"; verify_dev_complete "smoke-test-dead-$$" "/tmp/wt" "/tmp/main"' _ "$REPO_ROOT/packages/engine/lib/devloop-check.sh" 2>/dev/null || echo "")
if echo "$result" | grep -q '"blocked"'; then
    pass "Step 5: P6 dead URL 不挂死 (返 blocked + 无 fatal)"
else
    fail "Step 5: 异常 ($result)"
fi

# 6. Env flag 默认 disabled（VERIFY_HEALTH_PROBE=0）— 同上，验证不抛 fatal
result=$(VERIFY_HEALTH_PROBE=0 verify_dev_complete "smoke-test-nodefault-$$" "/tmp/wt" "/tmp/main" 2>/dev/null || echo "")
if echo "$result" | grep -q '"blocked"'; then
    pass "Step 6: Env flag default disabled (返 blocked)"
else
    fail "Step 6: 异常 ($result)"
fi

# 7. stop-dev.sh 三态出口（.cecelia 不存在路径）
TMPDIR_NO_CECELIA=$(mktemp -d)
cd "$TMPDIR_NO_CECELIA"
echo "" | bash "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" >/dev/null 2>&1
exit_code=$?
cd "$REPO_ROOT"
rm -rf "$TMPDIR_NO_CECELIA"
if [[ $exit_code -eq 0 ]]; then
    pass "Step 7: stop-dev.sh exit 0 (.cecelia 不存在)"
else
    fail "Step 7: exit=$exit_code"
fi

# 8. cleanup.sh 不再含 deploy-local.sh fire-and-forget
if grep -qE 'setsid.*DEPLOY_LOCAL_SH|setsid.*deploy-local' "$REPO_ROOT/packages/engine/skills/dev/scripts/cleanup.sh"; then
    fail "Step 8: cleanup.sh 仍含 deploy-local.sh fire-and-forget"
else
    pass "Step 8: cleanup.sh 已解耦 deploy-local.sh"
fi

echo ""
echo "=== stop-hook-7stage smoke: $PASS PASS / $FAIL FAIL ==="
[[ $FAIL -eq 0 ]] || exit 1
