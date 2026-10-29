#!/usr/bin/env bash
set -euo pipefail

DEPLOY="$(cd "$(dirname "$0")/.." && pwd)/brain-deploy.sh"
eval "$(sed -n '/^bluegreen_pre_swap_check() {/,/^}/p' "$DEPLOY")"

BRAIN_BOOTSTRAP_RECEIPT=''
DRAIN_STARTED_BY_DEPLOY=true
tick_status='{"draining":true}'
drain_started_at=$(node -e 'console.log(new Date(Date.now()-16*60*1000).toISOString())')
drain_status() {
  printf '{"draining":true,"hold_for_swap":true,"drain_completed":true,"remaining":0,"drain_started_at":"%s"}' "$drain_started_at"
}
curl() {
  case "$*" in
    *'/api/brain/tick/status') printf '%s' "$tick_status" ;;
    *'/api/brain/tick/drain-status') drain_status ;;
  esac
}

if bluegreen_pre_swap_check >/dev/null 2>&1; then
  echo 'FAIL: expired hold must not permit blue removal' >&2
  exit 1
fi
drain_started_at=$(node -e 'console.log(new Date().toISOString())')
tick_status='{"draining":false}'
if bluegreen_pre_swap_check >/dev/null 2>&1; then
  echo 'FAIL: resumed dispatch must not permit blue removal' >&2
  exit 1
fi
tick_status='{"draining":true}'
bluegreen_pre_swap_check >/dev/null
echo 'PASS: final pre-swap gate requires a live held drain'
