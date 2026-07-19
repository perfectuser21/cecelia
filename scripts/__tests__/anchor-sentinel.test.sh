#!/usr/bin/env bash
# anchor-sentinel.test.sh — 锚点哨兵测试(stub check-script + notify,零 DB/网络依赖)
set -uo pipefail
ERRORS=0; PASS=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SCRIPT="$REPO_ROOT/scripts/patrol/anchor-sentinel.sh"
TMPD=$(mktemp -d -t anchor-sentinel-test.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT

NOTIFY_LOG="$TMPD/notify.log"
NOTIFY_STUB="$TMPD/notify.sh"; printf '#!/usr/bin/env bash\necho "$1" >> "%s"\n' "$NOTIFY_LOG" > "$NOTIFY_STUB"; chmod +x "$NOTIFY_STUB"

CHECK_LOW="$TMPD/check-low.sh"; printf '#!/usr/bin/env bash\necho '"'"'{"broken":2,"total":10,"covered":8}'"'"'\n' > "$CHECK_LOW"; chmod +x "$CHECK_LOW"
CHECK_HIGH="$TMPD/check-high.sh"; printf '#!/usr/bin/env bash\necho '"'"'{"broken":5,"total":10,"covered":5}'"'"'\n' > "$CHECK_HIGH"; chmod +x "$CHECK_HIGH"

echo "=== anchor-sentinel 测试 ==="

# 场景1:首次跑(无状态文件),broken=2 → 不告警,状态文件写入2
STATE_FILE="$TMPD/state1"
rm -f "$STATE_FILE"
ANCHOR_SENTINEL_STATE_FILE="$STATE_FILE" ANCHOR_SENTINEL_CHECK_CMD="$CHECK_LOW" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" \
  bash "$SCRIPT" >/dev/null 2>&1
if [ ! -f "$NOTIFY_LOG" ] && [ "$(cat "$STATE_FILE")" = "2" ]; then
  pass "首次跑(broken=2,无历史)不告警,状态文件写入2"
else
  fail "首次跑行为不符预期"
fi

# 场景2:broken 从 2 → 2(不升)不告警
rm -f "$NOTIFY_LOG"
ANCHOR_SENTINEL_STATE_FILE="$STATE_FILE" ANCHOR_SENTINEL_CHECK_CMD="$CHECK_LOW" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" \
  bash "$SCRIPT" >/dev/null 2>&1
if [ ! -f "$NOTIFY_LOG" ]; then
  pass "broken持平(2→2)不告警"
else
  fail "broken持平却告警了"
fi

# 场景3:broken 从 2 → 5(上升)告警
rm -f "$NOTIFY_LOG"
ANCHOR_SENTINEL_STATE_FILE="$STATE_FILE" ANCHOR_SENTINEL_CHECK_CMD="$CHECK_HIGH" SENTINEL_NOTIFY_CMD="$NOTIFY_STUB" \
  bash "$SCRIPT" >/dev/null 2>&1
if [ -f "$NOTIFY_LOG" ] && grep -q "5" "$NOTIFY_LOG" && [ "$(cat "$STATE_FILE")" = "5" ]; then
  pass "broken上升(2→5)触发告警,状态文件更新为5"
else
  fail "broken上升未告警或状态文件未更新"
fi

echo ""
echo "=== 结果: $PASS passed, $ERRORS failed ==="
[ "$ERRORS" -eq 0 ] || exit 1
