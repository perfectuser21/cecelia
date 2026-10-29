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
