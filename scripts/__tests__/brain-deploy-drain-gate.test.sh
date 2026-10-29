#!/usr/bin/env bash
set -euo pipefail

DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/brain-deploy.sh"
eval "$(sed -n '/^drain_before_swap() {/,/^}/p' "$DEPLOY")"
eval "$(sed -n '/^drain_cancel_with_retry() {/,/^}/p' "$DEPLOY")"

DRY_RUN=false
DRAIN_TIMEOUT_SECS=1
DRAIN_POST_RESP='{"draining":true,"hold_for_swap":true,"remaining":1}'
STATUS_BODY='{"draining":false}'
DRAIN_CANCEL_RESP='{"success":true}'
send_bark() { :; }
sleep() { :; }
curl() {
  case " $* " in
    *"/api/brain/tick/status"*) [[ "${STATUS_UP:-1}" == 1 ]] && printf '%s' "$STATUS_BODY" ;;
    *"/api/brain/tick/drain-cancel"*) [[ "${DRAIN_CANCEL_OK:-1}" == 1 ]] && printf '%s' "$DRAIN_CANCEL_RESP" ;;
    *"/api/brain/tick/drain-status"*) printf '%s' "${DRAIN_STATUS:-}" ;;
    *"/api/brain/tick/drain"*)
      [[ " $* " == *'"hold_for_swap":true'* ]] || return 1
      [[ "${DRAIN_POST_OK:-1}" == 1 ]] && printf '%s' "$DRAIN_POST_RESP" ;;
  esac
}

expect_reject() {
  if drain_before_swap true >/dev/null 2>&1; then
    echo "FAIL: $1 must stop swap" >&2
    exit 1
  fi
}

STATUS_UP=1 DRAIN_POST_OK=0 expect_reject 'drain activation failure'
STATUS_UP=1 DRAIN_POST_OK=1 DRAIN_POST_RESP='{"draining":true,"already_draining":true,"hold_for_swap":true}' DRAIN_STATUS='{"draining":true,"hold_for_swap":true,"drain_completed":true,"remaining":0}' expect_reject 'another deployment owns drain'
STATUS_UP=1 DRAIN_POST_OK=1 DRAIN_STATUS='{"draining":true,"remaining":1}' expect_reject 'timeout with live execution'
STATUS_UP=1 DRAIN_POST_OK=1 DRAIN_STATUS='{"draining":false,"remaining":0}' expect_reject 'zero without completion proof'
STATUS_UP=1 DRAIN_POST_OK=1 DRAIN_STATUS='{"draining":false,"drain_completed":true,"remaining":0}' expect_reject 'legacy API releases dispatch before swap'
STATUS_UP=1 DRAIN_POST_OK=1 DRAIN_STATUS='not-json' expect_reject 'unparseable status'
STATUS_UP=0 DRAIN_POST_OK=1 expect_reject 'existing Brain unavailable'

STATUS_UP=0
drain_before_swap false >/dev/null
echo 'PASS: first deployment without old Brain remains allowed'

STATUS_UP=1
DRAIN_STATUS='{"draining":true,"hold_for_swap":true,"drain_completed":true,"remaining":0}'
drain_before_swap true >/dev/null
echo 'PASS: confirmed drain completion allows swap'

DRAIN_CANCEL_RESP='{"success":false}'
if drain_cancel_with_retry >/dev/null 2>&1; then
  echo 'FAIL: drain-cancel response without success must not claim restoration' >&2
  exit 1
fi
DRAIN_CANCEL_RESP='{"success":true}'
STATUS_BODY='{"draining":true}'
if drain_cancel_with_retry >/dev/null 2>&1; then
  echo 'FAIL: drain-cancel must read back that dispatch resumed' >&2
  exit 1
fi
STATUS_BODY='{"draining":false}'
drain_cancel_with_retry >/dev/null
echo 'PASS: aborted deployment confirms drain cancellation and readback'
