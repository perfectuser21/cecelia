#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/bluegreen.sh"

BLUE_REMOVED=false
docker() {
  case "$*" in
    'inspect cecelia-node-brain --format'*NetworkSettings*) echo bridge ;;
    'rm -f cecelia-node-brain') BLUE_REMOVED=true ;;
    *) return 0 ;;
  esac
}
bluegreen_wait_for_stable_http() { BLUEGREEN_HEALTHY_URL=http://green:5221; return 0; }
bluegreen_guard_blue() { return 0; }
send_bark() { return 0; }
bluegreen_pre_swap_check() { return 1; }

if TARGET_VERSION=1.445.85 DEPLOY_ROOT_DIR='' bluegreen_swap >/dev/null 2>&1; then
  echo 'FAIL: failed last-moment audit still promoted green' >&2; exit 1
fi
[[ "$BLUE_REMOVED" == false ]] || { echo 'FAIL: blue removed despite failed audit' >&2; exit 1; }
echo 'PASS: last-moment audit blocks blue removal'

# The old process cannot recover after SIGKILL, so its rollback image must be
# pinned before removal. A failed tag must retain blue during bootstrap.
bluegreen_pre_swap_check() { return 0; }
BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=true
blue_image="sha256:$(printf 'a%.0s' {1..64})"
new_image="sha256:$(printf 'b%.0s' {1..64})"
internal_env=$(mktemp)
test_log=$(mktemp)
trap 'rm -f "$internal_env" "$test_log"' EXIT
CECELIA_INTERNAL_ENV_FILE="$internal_env"
EXPECTED_SHA=$(printf 'd%.0s' {1..40})
timeout() { shift 3; "$@"; }
docker() {
  case "$*" in
    'inspect cecelia-node-brain --format'*NetworkSettings*) echo bridge ;;
    'inspect cecelia-node-brain --format {{.Image}}') echo "$blue_image" ;;
    'image inspect '*) echo "GIT_SHA=$EXPECTED_SHA" ;;
    'tag '*) return 1 ;;
    'rm -f cecelia-node-brain') BLUE_REMOVED=true ;;
    *) return 0 ;;
  esac
}
if TARGET_VERSION=1.445.85 DEPLOY_ROOT_DIR=/tmp/no-smoke-list bluegreen_swap >"$test_log" 2>&1; then
  echo 'FAIL: missing rollback image accepted' >&2; exit 1
fi
grep -q 'bootstrap rollback image unavailable' "$test_log" || { cat "$test_log" >&2; echo 'FAIL: failed before rollback image check' >&2; exit 1; }
[[ "$BLUE_REMOVED" == false ]] || { echo 'FAIL: blue removed without rollback image' >&2; exit 1; }
echo 'PASS: bootstrap requires a pinned rollback image'
