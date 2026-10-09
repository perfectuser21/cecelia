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
if [[ "$FAKE_CURL_MODE" == "sealed" ]]; then
  # tick 被有意封停（决策 751f73be）：/health 恒为 degraded，唯一原因是 scheduler.enabled=false
  printf '{"status":"degraded","git_sha":"target-sha","version":"1.2.3","organs":{"scheduler":{"enabled":false},"circuit_breaker":{"open":[]}}}\n'
elif [[ "$FAKE_CURL_MODE" == "sealed-open-breaker" ]]; then
  printf '{"status":"degraded","git_sha":"target-sha","version":"1.2.3","organs":{"scheduler":{"enabled":false},"circuit_breaker":{"open":["cecelia-run"]}}}\n'
elif [[ "$FAKE_CURL_MODE" == "degraded-plain" ]]; then
  printf '{"status":"degraded","git_sha":"target-sha"}\n'
elif [[ "$FAKE_CURL_MODE" == "eventual" && "$count" -ge 2 ]]; then
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

# tick 被有意封停的 degraded 视为就绪（与部署收账 policy.deployHealth 同口径）——否则 Auto Staging Deploy 永远超时
printf '0' > "$STATE_FILE"
FAKE_CURL_STATE="$STATE_FILE" FAKE_CURL_MODE=sealed CURL_BIN="$FAKE_CURL" \
  BRAIN_URL=http://brain EXPECTED_SHA=target-sha MAX_WAIT_SECONDS=2 POLL_INTERVAL_SECONDS=0 \
  bash "$SCRIPT" > "$TEST_DIR/sealed.log" 2>&1 || { cat "$TEST_DIR/sealed.log"; echo 'FAIL: 封停 tick 的 degraded 应视为就绪'; exit 1; }
grep -q 'production SHA ready: target-sha' "$TEST_DIR/sealed.log"

# 折算不放宽：断路器 OPEN / 非封停原因的 degraded 仍必须超时失败
for mode in sealed-open-breaker degraded-plain; do
  printf '0' > "$STATE_FILE"
  if FAKE_CURL_STATE="$STATE_FILE" FAKE_CURL_MODE="$mode" CURL_BIN="$FAKE_CURL" \
    BRAIN_URL=http://brain EXPECTED_SHA=target-sha MAX_WAIT_SECONDS=1 POLL_INTERVAL_SECONDS=0 \
    bash "$SCRIPT" > "$TEST_DIR/$mode.log" 2>&1; then
    echo "FAIL: $mode 不应视为就绪"
    exit 1
  fi
  grep -q 'production SHA not ready' "$TEST_DIR/$mode.log"
done

echo 'PASS: wait-for-production-sha condition polling'
