#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/wait-for-production-sha.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

if [[ ! -f "$SCRIPT" ]]; then
  echo "FAIL: missing $SCRIPT"
  exit 1
fi

STATE_FILE="$TEST_DIR/state"
FAKE_CURL="$TEST_DIR/curl"
cat > "$FAKE_CURL" <<'SH'
#!/usr/bin/env bash
count=0
[[ -f "$FAKE_CURL_STATE" ]] && count=$(cat "$FAKE_CURL_STATE")
count=$((count + 1))
printf '%s' "$count" > "$FAKE_CURL_STATE"
if [[ "$FAKE_CURL_MODE" == "eventual" && "$count" -ge 2 ]]; then
  printf '{"status":"healthy","git_sha":"target-sha"}\n'
else
  printf '{"status":"healthy","git_sha":"old-sha"}\n'
fi
SH
chmod +x "$FAKE_CURL"

FAKE_CURL_STATE="$STATE_FILE" FAKE_CURL_MODE=eventual CURL_BIN="$FAKE_CURL" \
  BRAIN_URL=http://brain EXPECTED_SHA=target-sha MAX_WAIT_SECONDS=2 POLL_INTERVAL_SECONDS=0 \
  bash "$SCRIPT" > "$TEST_DIR/eventual.log"
grep -q 'production SHA ready: target-sha' "$TEST_DIR/eventual.log"

printf '0' > "$STATE_FILE"
if FAKE_CURL_STATE="$STATE_FILE" FAKE_CURL_MODE=never CURL_BIN="$FAKE_CURL" \
  BRAIN_URL=http://brain EXPECTED_SHA=target-sha MAX_WAIT_SECONDS=1 POLL_INTERVAL_SECONDS=0 \
  bash "$SCRIPT" > "$TEST_DIR/timeout.log" 2>&1; then
  echo 'FAIL: timeout case returned success'
  exit 1
fi
grep -q 'production SHA not ready' "$TEST_DIR/timeout.log"

echo 'PASS: wait-for-production-sha condition polling'
