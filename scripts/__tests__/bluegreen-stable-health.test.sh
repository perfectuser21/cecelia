#!/usr/bin/env bash
# Regression: one transient 200 from a reused canary port must not release pre-swap smoke.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
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

# 真 swap → 真稳定探活 → pre-swap smoke；只替换容器标记路径和进程边界。
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE/lib" "$FIXTURE/packages/brain/config/smoke" "$FIXTURE/packages/brain/scripts/smoke"
cp "$ROOT_DIR/scripts/lib/url-encode.sh" "$FIXTURE/lib/"
python3 - "$ROOT_DIR/scripts/lib/bluegreen.sh" "$FIXTURE/lib/bluegreen.sh" "$FIXTURE/dockerenv" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
assert source.count('[[ -f /.dockerenv ]]') == 1
pathlib.Path(sys.argv[2]).write_text(source.replace('[[ -f /.dockerenv ]]', '[[ -f "' + sys.argv[3] + '" ]]'))
PY
printf 'capture.sh\n' > "$FIXTURE/packages/brain/config/smoke/smoke-core.txt"
cat > "$FIXTURE/packages/brain/scripts/smoke/capture.sh" <<'CAPTURE'
#!/bin/bash
printf '%s\n' "$BRAIN_URL" > "$SMOKE_URL_FILE"
exit 1
CAPTURE
(
  source "$FIXTURE/lib/bluegreen.sh"
  send_bark() { :; }
  curl() { printf '%s\n' "${@: -1}" >> "$PROBE_URL_FILE"; }
  docker() {
    case "$*" in
      *NetworkSettings.Networks*) printf '%s\n' "$TEST_NETWORK" ;;
      *State.Status*) printf 'running\n' ;;
    esac
  }
  export SMOKE_URL_FILE="$FIXTURE/smoke-url" PROBE_URL_FILE="$FIXTURE/probe-urls"
  unset SKIP_PRE_SWAP_SMOKE
  for scenario in native-bridge container-bridge container-host explicit-bridge explicit-host; do
    rm -f "$FIXTURE/dockerenv" "$SMOKE_URL_FILE" "$PROBE_URL_FILE"
    unset CANARY_HOST
    TEST_NETWORK=bridge
    expected=localhost
    case "$scenario" in
      container-bridge) touch "$FIXTURE/dockerenv"; expected=host.docker.internal ;;
      container-host) touch "$FIXTURE/dockerenv"; TEST_NETWORK=host ;;
      explicit-bridge) CANARY_HOST=fixture-gateway; expected=fixture-gateway ;;
      explicit-host) CANARY_HOST=fixture-gateway; expected=fixture-gateway; TEST_NETWORK=host ;;
    esac
    if TARGET_VERSION=fixture TEMP_PORT=59999 GREEN_STABLE_SUCCESSES=1 DEPLOY_ROOT_DIR="$FIXTURE" bluegreen_swap > "$FIXTURE/$scenario.log" 2>&1; then
      echo "FAIL: fixture smoke failure must stop the swap"; exit 1
    fi
    [[ "$(cat "$PROBE_URL_FILE")" == "http://$expected:59999/api/brain/tick/status" ]] || {
      cat "$FIXTURE/$scenario.log"; echo "FAIL: $scenario probe URL"; exit 1;
    }
    [[ "$(cat "$SMOKE_URL_FILE")" == "http://$expected:59999" ]] || {
      echo "FAIL: $scenario smoke did not reuse the probed URL"; exit 1;
    }
    echo "PASS: $scenario 真实探活与 smoke 使用 $expected"
  done
)
