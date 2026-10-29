#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/bluegreen.sh"

blue_removed=false
old_image="sha256:$(printf 'a%.0s' {1..64})"
EXPECTED_SHA=$(printf 'b%.0s' {1..40})
internal_env=$(mktemp)
trap 'rm -f "$internal_env"' EXIT
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
    'inspect cecelia-bluegreen-sidecar '*) return 1 ;; # --rm sidecar exited right after docker run -d
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
echo 'PASS: blue remains when detached sidecar exits before swap'
