#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/wait-preview-active.sh"
WORKFLOW="$ROOT_DIR/.github/workflows/preview-deploy.yml"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat > "$TEST_DIR/fake-curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
url="${*: -1}"
if [[ "$url" == */api/brain/health ]]; then
  count=0
  [[ -f "$HEALTH_COUNT_FILE" ]] && count="$(cat "$HEALTH_COUNT_FILE")"
  count=$((count + 1))
  printf '%s' "$count" > "$HEALTH_COUNT_FILE"
  if (( count == 1 )); then
    echo '{"status":"healthy","uptime_seconds":120}'
  else
    echo '{"status":"healthy","uptime_seconds":2}'
  fi
  exit 0
fi

if [[ "$url" == */api/brain/preview/status/* ]]; then
  if [[ -f "$REISSUE_COUNT_FILE" ]]; then
    echo '{"status":"active"}'
  else
    echo '{"status":"starting"}'
  fi
  exit 0
fi

exit 22
FAKE_CURL

cat > "$TEST_DIR/fake-request-start" <<'FAKE_START'
#!/usr/bin/env bash
set -euo pipefail
count=0
[[ -f "$REISSUE_COUNT_FILE" ]] && count="$(cat "$REISSUE_COUNT_FILE")"
printf '%s' "$((count + 1))" > "$REISSUE_COUNT_FILE"
echo '{"port":5300,"status":"starting"}'
FAKE_START

cat > "$TEST_DIR/fake-sleep" <<'FAKE_SLEEP'
#!/usr/bin/env bash
exit 0
FAKE_SLEEP

chmod +x "$TEST_DIR/fake-curl" "$TEST_DIR/fake-request-start" "$TEST_DIR/fake-sleep"

HEALTH_COUNT_FILE="$TEST_DIR/health.count" \
REISSUE_COUNT_FILE="$TEST_DIR/reissue.count" \
CURL_BIN="$TEST_DIR/fake-curl" \
REQUEST_PREVIEW_START_SCRIPT="$TEST_DIR/fake-request-start" \
SLEEP_BIN="$TEST_DIR/fake-sleep" \
PREVIEW_WAIT_MAX_SECONDS=5 \
PREVIEW_WAIT_INTERVAL_SECONDS=1 \
PREVIEW_INITIAL_BRAIN_UPTIME=120 \
BRAIN_URL='http://brain.test:5221' \
DEPLOY_TOKEN='test-token' \
PR_NUMBER=4753 \
BRANCH_NAME='cp-preview-restart' \
EXPECTED_PORT=5300 \
  bash "$SCRIPT" > "$TEST_DIR/wait.log"

[[ "$(cat "$TEST_DIR/reissue.count")" == '1' ]]
grep -q 'production Brain restart detected' "$TEST_DIR/wait.log"
grep -q 'preview status=active' "$TEST_DIR/wait.log"
grep -q 'bash scripts/wait-preview-active.sh' "$WORKFLOW"

echo 'PASS: preview wait reissues start after production Brain restart'
