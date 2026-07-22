#!/usr/bin/env bash
# Regression: one transient 200 from a reused canary port must not release pre-swap smoke.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/bluegreen.sh
source "$ROOT_DIR/scripts/lib/bluegreen.sh"

CURL_CALLS=0
curl() {
  CURL_CALLS=$((CURL_CALLS + 1))
  case "$CURL_CALLS" in
    1|3|4|5) return 0 ;;
    *) return 1 ;;
  esac
}

docker() {
  if [[ "$*" == *".IPAddress"* ]]; then
    return 0
  fi
  if [[ "$*" == *".State.Health"* ]]; then
    printf 'starting\n'
    return 0
  fi
  return 1
}

sleep() { :; }

BLUEGREEN_HEALTHY_URL=""
if ! bluegreen_wait_for_stable_http \
  "green-test" "5223" "20" "http://localhost:5223" "3"; then
  echo "❌ stable health helper rejected a valid three-success tail"
  exit 1
fi

if [[ "$CURL_CALLS" -ne 5 ]]; then
  echo "❌ expected 5 probes (transient success must reset), got $CURL_CALLS"
  exit 1
fi

if [[ "$BLUEGREEN_HEALTHY_URL" != "http://localhost:5223" ]]; then
  echo "❌ unexpected healthy URL: $BLUEGREEN_HEALTHY_URL"
  exit 1
fi

echo "✅ bluegreen stable-health regression passed"
