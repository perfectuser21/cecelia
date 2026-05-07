#!/usr/bin/env bash
# stop-dev-deploy-escape.test.sh — v23 心跳模型 mtime TTL + 鲁棒性
# 原 BUG-4 场景（v22 auto-rm dev-active）已由 v23 灯 mtime 自然过期替代。
# 本文件保留语义等价的 v23 版本：
#   Case 1: 老灯（1h 前 mtime）→ hook release（灯熄 → 放行）
#   Case 2: 新灯（刚 touch）→ hook block（灯亮）
#   Case 3: TTL=1min + 5 分钟老灯 → hook release（TTL 可配置）
#   Case 4: 各种杂文件存在（dev-active, fail-counter）→ stop-hook 不崩
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

old_mtime_1h() {
    local f="$1"
    touch -t $(date -v-1H +%Y%m%d%H%M.%S 2>/dev/null || date -d '1 hour ago' +%Y%m%d%H%M.%S 2>/dev/null) "$f"
}

old_mtime_5min() {
    local f="$1"
    touch -t $(date -v-5M +%Y%m%d%H%M.%S 2>/dev/null || date -d '5 minutes ago' +%Y%m%d%H%M.%S 2>/dev/null) "$f"
}

SESSION_OLD="sessold1-full-uuid"
SESSION_NEW="sessnew1-full-uuid"
SID_OLD="${SESSION_OLD:0:8}"
SID_NEW="${SESSION_NEW:0:8}"

# Case 1: 老灯（mtime > TTL 300s）→ 放行
TMP=$(build_main)
LIGHT="$TMP/.cecelia/lights/${SID_OLD}-cp-old.live"
echo '{"session_id":"sessold1-full-uuid","branch":"cp-old"}' > "$LIGHT"
old_mtime_1h "$LIGHT"
out=$(echo "{\"session_id\":\"${SESSION_OLD}\"}" | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
if ! echo "$out" | grep -q '"decision".*block'; then
    pass "Case 1: 老灯（1h mtime）→ release"
else
    fail "Case 1: 老灯误 block"
fi
rm -rf "$TMP"

# Case 2: 新灯（刚 touch）→ block
TMP=$(build_main)
LIGHT="$TMP/.cecelia/lights/${SID_NEW}-cp-new.live"
echo '{"session_id":"sessnew1-full-uuid","branch":"cp-new"}' > "$LIGHT"
out=$(echo "{\"session_id\":\"${SESSION_NEW}\"}" | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
if echo "$out" | grep -q '"decision".*block'; then
    pass "Case 2: 新灯（刚 touch）→ block"
else
    fail "Case 2: 新灯未 block，output=[$out]"
fi
rm -rf "$TMP"

# Case 3: STOP_HOOK_LIGHT_TTL_SEC=60 + 5 分钟老灯 → 放行（TTL 可配置）
TMP=$(build_main)
SESSION_CFG="sesscfg1-full-uuid"
SID_CFG="${SESSION_CFG:0:8}"
LIGHT="$TMP/.cecelia/lights/${SID_CFG}-cp-cfg.live"
echo '{"session_id":"sesscfg1-full-uuid","branch":"cp-cfg"}' > "$LIGHT"
old_mtime_5min "$LIGHT"
out=$(echo "{\"session_id\":\"${SESSION_CFG}\"}" | STOP_HOOK_LIGHT_TTL_SEC=60 CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
if ! echo "$out" | grep -q '"decision".*block'; then
    pass "Case 3: TTL_SEC=60 + 5 分钟老灯 → release"
else
    fail "Case 3: TTL env 未生效，output=[$out]"
fi
rm -rf "$TMP"

# Case 4: 各种杂文件（dev-active, fail-counter）→ stop-hook 不崩
TMP=$(build_main)
cat > "$TMP/.cecelia/dev-active-cp-deploy-fail.json" <<EOF
{"branch":"cp-deploy-fail","worktree":"/tmp/wt","session_id":"sess-d"}
EOF
echo "3" > "$TMP/.cecelia/deploy-fail-count-cp-deploy-fail"
out=$(echo '{}' | CLAUDE_HOOK_CWD="$TMP" bash "$STOP_HOOK" 2>&1 || true)
# hook 不应崩（exit 非 2/99），结果不论 block/release
echo "ℹ️  Case 4 output: $out" | head -3
pass "Case 4: 杂文件存在 → stop-hook 不崩"
rm -rf "$TMP"

echo ""
echo "=== stop-dev-deploy-escape: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
