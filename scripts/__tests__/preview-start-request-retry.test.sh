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
out=""
while (( $# )); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
body='{"port":5311,"status":"starting"}'
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; printf '200'; else echo "$body"; fi
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

# ── 503 拒绝原因可见（2026-10-12，B1）：旧实现 curl -f 丢掉响应体，CI 日志只有
#    「curl: (22) ... 503」，too_many_active 一直没被定位；容量类拒绝 12×5s 重试也是白等。
cat > "$TEST_DIR/fake-curl-503" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
count=0
[[ -f "$COUNT_FILE" ]] && count="$(cat "$COUNT_FILE")"
count=$((count + 1))
printf '%s' "$count" > "$COUNT_FILE"
out=""
while (( $# )); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
body="{\"error\":\"preview admission rejected\",\"reason\":\"${REJECT_REASON}\"}"
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
printf '503'
FAKE_CURL
chmod +x "$TEST_DIR/fake-curl-503"

run_503() {
  local reason="$1" tag="$2"
  set +e
  COUNT_FILE="$TEST_DIR/$tag.count" \
  REJECT_REASON="$reason" \
  CURL_BIN="$TEST_DIR/fake-curl-503" \
  PREVIEW_START_MAX_ATTEMPTS=3 \
  PREVIEW_START_RETRY_DELAY_SECONDS=0 \
  BRAIN_URL='http://brain.test:5221' \
  DEPLOY_TOKEN='test-token' \
  PR_NUMBER=6320 \
  BRANCH_NAME='cp-preview-503' \
    bash "$SCRIPT" > "$TEST_DIR/$tag.out" 2> "$TEST_DIR/$tag.log"
  echo $? > "$TEST_DIR/$tag.status"
  set -e
}

for reason in too_many_active insufficient_free_space usage_pct_too_high; do
  run_503 "$reason" "cap-$reason"
  if [[ "$(cat "$TEST_DIR/cap-$reason.status")" != '3' ]] \
    || [[ "$(cat "$TEST_DIR/cap-$reason.count")" != '1' ]] \
    || ! grep -q "$reason" "$TEST_DIR/cap-$reason.log" \
    || ! grep -q '503' "$TEST_DIR/cap-$reason.log"; then
    echo "FAIL: 容量类拒绝 $reason 应打印原因+HTTP 码并以 3 立即退出" >&2
    echo "status=$(cat "$TEST_DIR/cap-$reason.status") count=$(cat "$TEST_DIR/cap-$reason.count") log=$(cat "$TEST_DIR/cap-$reason.log")" >&2
    exit 1
  fi
done
grep -q 'DEPLOY_TOKEN\|test-token' "$TEST_DIR/cap-too_many_active.log" && { echo 'FAIL: 日志泄露令牌' >&2; exit 1; }

run_503 sample_stale sample
if [[ "$(cat "$TEST_DIR/sample.status")" != '1' ]] \
  || [[ "$(cat "$TEST_DIR/sample.count")" != '3' ]] \
  || ! grep -q 'sample_stale' "$TEST_DIR/sample.log"; then
  echo "FAIL: sample_* 类拒绝应按 MAX_ATTEMPTS 重试并打印原因" >&2
  echo "status=$(cat "$TEST_DIR/sample.status") count=$(cat "$TEST_DIR/sample.count") log=$(cat "$TEST_DIR/sample.log")" >&2
  exit 1
fi

echo 'PASS: preview start 503 打印拒绝原因，容量类原因退出码 3 立即退出'
