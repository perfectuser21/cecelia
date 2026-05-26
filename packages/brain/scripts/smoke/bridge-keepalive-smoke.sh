#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
LOG_PREFIX="[smoke:bridge-keepalive]"

pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }
skip() { echo "⏭  SKIP: $1"; exit 0; }

[[ "${CI:-}" == "true" ]] && skip "CI 环境不跑此脚本"

echo "$LOG_PREFIX 检查 bridge-keepalive 相关文件..."

# [ARTIFACT] bridge-keepalive-check.sh 存在且可执行
[[ -x "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" ]] || \
  fail "scripts/ops/bridge-keepalive-check.sh 不存在或不可执行"
pass "scripts/ops/bridge-keepalive-check.sh 存在且可执行"

# [ARTIFACT] com.cecelia.bridge-keepalive.plist 存在
[[ -f "$REPO_ROOT/scripts/ops/com.cecelia.bridge-keepalive.plist" ]] || \
  fail "scripts/ops/com.cecelia.bridge-keepalive.plist 不存在"
pass "scripts/ops/com.cecelia.bridge-keepalive.plist 存在"

# [BEHAVIOR] bridge-keepalive-check.sh 语法正确
bash -n "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh bash 语法错误"
pass "bridge-keepalive-check.sh 语法正确"

# [BEHAVIOR] brain-keepalive-check.sh 包含 DAEMON_STATE_FILE
grep -q "DAEMON_STATE_FILE" "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh" || \
  fail "brain-keepalive-check.sh 缺少 DAEMON_STATE_FILE（SILENCED bug 未修复）"
pass "brain-keepalive-check.sh 含 DAEMON_STATE_FILE"

# [BEHAVIOR] brain-keepalive-check.sh 含 TTL 检查（file_age_seconds）
grep -q "file_age_seconds" "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh" || \
  fail "brain-keepalive-check.sh 缺少 file_age_seconds（SILENCED TTL 未实现）"
pass "brain-keepalive-check.sh 含 TTL 检查逻辑"

# [BEHAVIOR] bridge-keepalive-check.sh 含 SILENCED_TTL
grep -q "SILENCED_TTL" "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh 缺少 SILENCED_TTL"
pass "bridge-keepalive-check.sh 含 SILENCED_TTL"

# [BEHAVIOR] bridge-keepalive-check.sh 含 launchctl kickstart
grep -q "launchctl kickstart" "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh 缺少 launchctl kickstart"
pass "bridge-keepalive-check.sh 含 launchctl kickstart"

# [BEHAVIOR] bridge-keepalive-check.sh 含 direct spawn fallback
grep -q "nohup" "$REPO_ROOT/scripts/ops/bridge-keepalive-check.sh" || \
  fail "bridge-keepalive-check.sh 缺少 direct spawn fallback"
pass "bridge-keepalive-check.sh 含 direct spawn fallback"

echo ""
echo "$LOG_PREFIX bridge-keepalive smoke: ALL PASS"
