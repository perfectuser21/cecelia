#!/usr/bin/env bash
# ci-poll.sh 回归测试 (stub gh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CI_POLL="$SCRIPT_DIR/../ci-poll.sh"
TMPDIR_STUB=$(mktemp -d)
trap 'rm -rf "$TMPDIR_STUB"' EXIT

# ---- helpers ----
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

# ---- Test 1: CI 全绿时应 exit 0 且 stderr 含 CI_GREEN ----
echo "=== Test 1: CI全绿 exit 0 ==="
# 创建 stub gh
cat > "$TMPDIR_STUB/gh" << 'STUB'
#!/usr/bin/env bash
if [[ "$1" == "pr" && "$2" == "checks" ]]; then
  echo "ci/build  pass  2m  https://example.com"
  echo "ci/test   pass  3m  https://example.com"
elif [[ "$1" == "pr" && "$2" == "view" ]]; then
  echo '{"mergeStateStatus":"CLEAN"}'
fi
STUB
chmod +x "$TMPDIR_STUB/gh"

# 用 timeout 5 运行，捕获 stderr
STDERR_OUT=$(PATH="$TMPDIR_STUB:$PATH" timeout 5 bash "$CI_POLL" 123 owner/repo 2>&1 >/dev/null) || EXIT_CODE=$?
EXIT_CODE=${EXIT_CODE:-0}

[ "$EXIT_CODE" -eq 0 ] && pass "exit 0" || fail "exit $EXIT_CODE (期望0)"
echo "$STDERR_OUT" | grep -q "CI_GREEN" && pass "stderr含CI_GREEN" || fail "stderr缺CI_GREEN: $STDERR_OUT"

# ---- Test 2: CI 有失败时应 exit 10 ----
echo "=== Test 2: CI失败 exit 10 ==="
cat > "$TMPDIR_STUB/gh" << 'STUB'
#!/usr/bin/env bash
if [[ "$1" == "pr" && "$2" == "checks" ]]; then
  echo "ci/build  fail  2m  https://example.com"
elif [[ "$1" == "pr" && "$2" == "view" ]]; then
  echo '{"mergeStateStatus":"CLEAN"}'
fi
STUB
chmod +x "$TMPDIR_STUB/gh"

EXIT_CODE=0
PATH="$TMPDIR_STUB:$PATH" timeout 5 bash "$CI_POLL" 123 owner/repo 2>/dev/null || EXIT_CODE=$?
[ "$EXIT_CODE" -eq 10 ] && pass "exit 10" || fail "exit $EXIT_CODE (期望10)"

echo "=== 所有测试通过 ==="
