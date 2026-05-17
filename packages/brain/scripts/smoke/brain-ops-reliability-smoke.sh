#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BASE_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0

check() {
  local name="$1"
  shift
  if "$@" &>/dev/null; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo "=== brain-ops-reliability smoke ==="

# A. keepalive 脚本存在且可执行
check "brain-keepalive-check.sh 可执行" \
  test -x "$REPO_ROOT/scripts/ops/brain-keepalive-check.sh"

# A. plist 存在
check "com.cecelia.brain-keepalive.plist 存在" \
  test -f "$REPO_ROOT/scripts/ops/com.cecelia.brain-keepalive.plist"

# B. janitor API 可调用（要求 Brain 已运行）
check "janitor jobs API 包含 docker-prune" \
  bash -c "curl -sf '$BASE_URL/api/brain/janitor/jobs' | grep -q 'docker-prune'"

# C. selectBestAccount 可返回有效 accountId
check "selectBestAccount 返回有效 accountId" \
  node --input-type=module --eval "
    const { selectBestAccount } = await import('$REPO_ROOT/packages/brain/src/account-usage.js');
    const r = await selectBestAccount().catch(() => null);
    if (!r?.accountId) process.exit(1);
  "

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
