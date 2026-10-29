#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/lib/brain-bootstrap.sh"

trace=$(mktemp)
trap 'rm -f "$trace"' EXIT
BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=false
DRAIN_STARTED_BY_DEPLOY=false
bootstrap_assert_identity() { echo identity >> "$trace"; BOOTSTRAP_BINDING_JSON='{}'; }
bootstrap_audit() { echo audit >> "$trace"; [[ "${AUDIT_SAFE:-1}" == 1 ]]; }
curl() {
  echo "$*" >> "$trace"
  case "$*" in
    *'/tick/disable'*)
      printf '{"enabled":false}'
      [[ "${DISABLE_ACK_LOST:-0}" != 1 ]] ;;
    *'/tick/drain-cancel'*) printf '{"success":true}' ;;
    *'/tick/drain'*) printf '{"draining":true,"remaining":30}' ;;
    *'/tick/status'*)
      if grep -q '/tick/enable' "$trace"; then
        if grep -q '/tick/drain-cancel' "$trace"; then
          printf '{"enabled":true,"loop_running":true,"tick_running":false,"draining":false}'
        else
          printf '{"enabled":true,"loop_running":true,"tick_running":false,"draining":true}'
        fi
      else
        printf '{"enabled":false,"loop_running":false,"tick_running":false,"draining":true}'
      fi ;;
    *'/tick/enable'*) printf '{"enabled":true}' ;;
  esac
}

AUDIT_SAFE=0
if bootstrap_before_swap old new sha version >/dev/null 2>&1; then
  echo 'FAIL: unsafe pre-audit allowed bootstrap' >&2; exit 1
fi
! grep -q '/tick/disable' "$trace" || { echo 'FAIL: tick disabled before audit' >&2; exit 1; }

: > "$trace"
AUDIT_SAFE=1
bootstrap_before_swap old new sha version >/dev/null
[[ "$BOOTSTRAP_TICK_DISABLED_BY_DEPLOY" == true ]]
[[ "$DRAIN_STARTED_BY_DEPLOY" == true ]]
order=$(sed -e 's|.*/tick/disable.*|disable|' -e 's|.*/tick/drain.*|drain|' "$trace" | grep -E '^(identity|audit|disable|drain)$' | tr '\n' ' ')
[[ "$order" == 'identity audit disable drain audit ' ]] || { echo "FAIL: wrong bootstrap order: $order" >&2; exit 1; }
echo 'PASS: bootstrap audits before and after pausing dispatch'

: > "$trace"
BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=false
DRAIN_STARTED_BY_DEPLOY=false
DISABLE_ACK_LOST=1
if bootstrap_before_swap old new sha version >/dev/null 2>&1; then
  echo 'FAIL: lost disable acknowledgement allowed bootstrap' >&2; exit 1
fi
[[ "$BOOTSTRAP_TICK_DISABLED_BY_DEPLOY" == true ]] || { echo 'FAIL: lost disable ack was not marked for restoration' >&2; exit 1; }

: > "$trace"
DISABLE_ACK_LOST=0
BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=true
DRAIN_STARTED_BY_DEPLOY=true
bootstrap_restore_tick >/dev/null
grep -q '/tick/drain-cancel' "$trace" || { echo 'FAIL: restore did not clear owned drain' >&2; exit 1; }
[[ "$BOOTSTRAP_TICK_DISABLED_BY_DEPLOY" == false ]]
echo 'PASS: bootstrap failure restores dispatch and reads back the release'
