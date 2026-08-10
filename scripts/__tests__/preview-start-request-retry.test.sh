#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/request-preview-start.sh"
WORKFLOW="$ROOT_DIR/.github/workflows/preview-deploy.yml"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat > "$TEST_DIR/fake-curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
count=0
if [[ -f "$COUNT_FILE" ]]; then
  count="$(cat "$COUNT_FILE")"
fi
count=$((count + 1))
printf '%s' "$count" > "$COUNT_FILE"
if (( count < SUCCEED_ON_ATTEMPT )); then
  echo 'connection refused' >&2
  exit 7
fi
echo '{"port":5311,"status":"starting"}'
FAKE_CURL
chmod +x "$TEST_DIR/fake-curl"

COUNT_FILE="$TEST_DIR/eventual.count" \
SUCCEED_ON_ATTEMPT=3 \
CURL_BIN="$TEST_DIR/fake-curl" \
PREVIEW_START_MAX_ATTEMPTS=4 \
PREVIEW_START_RETRY_DELAY_SECONDS=0 \
BRAIN_URL='http://brain.test:5221' \
DEPLOY_TOKEN='test-token' \
PR_NUMBER=4751 \
BRANCH_NAME='cp-preview-retry' \
  bash "$SCRIPT" > "$TEST_DIR/eventual.json"

grep -q '"port":5311' "$TEST_DIR/eventual.json"
[[ "$(cat "$TEST_DIR/eventual.count")" == '3' ]]

set +e
COUNT_FILE="$TEST_DIR/failure.count" \
SUCCEED_ON_ATTEMPT=99 \
CURL_BIN="$TEST_DIR/fake-curl" \
PREVIEW_START_MAX_ATTEMPTS=3 \
PREVIEW_START_RETRY_DELAY_SECONDS=0 \
BRAIN_URL='http://brain.test:5221' \
DEPLOY_TOKEN='test-token' \
PR_NUMBER=4751 \
BRANCH_NAME='cp-preview-retry' \
  bash "$SCRIPT" > "$TEST_DIR/failure.json" 2> "$TEST_DIR/failure.log"
status=$?
set -e

[[ "$status" -ne 0 ]]
[[ "$(cat "$TEST_DIR/failure.count")" == '3' ]]
grep -q 'preview start failed after 3 attempts' "$TEST_DIR/failure.log"
grep -q 'bash scripts/request-preview-start.sh' "$WORKFLOW"

echo 'PASS: preview start retries transient Brain downtime'
