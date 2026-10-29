#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/bluegreen.sh"

blue_removed=false
old_image="sha256:$(printf 'a%.0s' {1..64})"
new_image="sha256:$(printf 'c%.0s' {1..64})"
EXPECTED_SHA=$(printf 'b%.0s' {1..40})
internal_env=$(mktemp)
sidecar_inspect_log=$(mktemp)
isolated_home=$(mktemp -d)
trap 'rm -f "$internal_env" "$sidecar_inspect_log"; rmdir "$isolated_home"' EXIT
HOME="$isolated_home"
mock_sidecar_observed=''
CECELIA_INTERNAL_ENV_FILE="$internal_env"
BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=true
DEPLOY_ROOT_DIR=/tmp/no-smoke-list
bluegreen_wait_for_stable_http() { BLUEGREEN_HEALTHY_URL=http://green:5221; return 0; }
bluegreen_pre_swap_check() { return 0; }
bluegreen_guard_blue() { return 0; }
send_bark() { return 0; }
timeout() { shift 3; "$@"; }
docker() {
  case "$*" in
    'inspect cecelia-node-brain --format'*NetworkSettings*) echo bridge ;;
    'inspect cecelia-node-brain --format {{.Image}}') echo "$old_image" ;;
    'image inspect '*GIT_SHA*) echo "GIT_SHA=$EXPECTED_SHA" ;;
    'image inspect cecelia-brain:blue-fallback --format {{.Id}}') echo "$old_image" ;;
    'image inspect '*"--format {{.Id}}"*) echo "$new_image" ;;
    'inspect cecelia-bluegreen-sidecar '*)
      echo inspected > "$sidecar_inspect_log"
      [[ -n "$mock_sidecar_observed" ]] || return 1 # --rm sidecar exited right after docker run -d
      echo "$mock_sidecar_observed" ;;
    'rm -f cecelia-node-brain') blue_removed=true ;;
    *) return 0 ;;
  esac
}

if TARGET_VERSION=1.445.85 bluegreen_swap >/dev/null 2>&1; then
  echo 'FAIL: blue was promoted after sidecar exited before swap' >&2
  exit 1
fi
[[ "$blue_removed" == false ]] || {
  echo 'FAIL: old Brain removed without a running sidecar' >&2
  exit 1
}
[[ -s "$sidecar_inspect_log" ]] || {
  echo 'FAIL: test did not reach detached sidecar liveness probe' >&2
  exit 1
}
echo 'PASS: blue remains when detached sidecar exits before swap'

mock_sidecar_observed="/cecelia-bluegreen-sidecar $old_image true"
if TARGET_VERSION=1.445.85 bluegreen_swap >/dev/null 2>&1; then
  echo 'FAIL: a running sidecar with the wrong image must not remove blue' >&2
  exit 1
fi
[[ "$blue_removed" == false ]] || {
  echo 'FAIL: blue removed despite sidecar image drift' >&2
  exit 1
}

mock_sidecar_observed="/cecelia-bluegreen-sidecar $new_image true"
TARGET_VERSION=1.445.85 bluegreen_swap >/dev/null
[[ "$blue_removed" == true ]] || {
  echo 'FAIL: exact running sidecar did not proceed to blue removal' >&2
  exit 1
}
echo 'PASS: only an exact running sidecar permits blue removal'
