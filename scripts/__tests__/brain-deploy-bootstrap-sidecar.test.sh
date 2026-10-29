#!/usr/bin/env bash
# The old deploy process dies with blue. Only the detached sidecar can restore
# the persistent manual tick disable after the new container is pinned.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SCRIPT_DIR/lib/brain-bootstrap-sidecar.sh"

old_image="sha256:$(printf 'a%.0s' {1..64})"
new_image="sha256:$(printf 'b%.0s' {1..64})"
old_sha=$(printf 'c%.0s' {1..40})
new_sha=$(printf 'd%.0s' {1..40})
BRAIN_BOOTSTRAP_RESTORE_TICK=1
BRAIN_BOOTSTRAP_BINDING_JSON=$(node -e 'console.log(JSON.stringify({
  schema_version:"brain-drain-bootstrap/v1",old_version:"1.445.84",
  old_image_id:process.argv[1],old_git_sha:process.argv[2],
  new_version:"1.445.85",new_image_id:process.argv[3],new_git_sha:process.argv[4],
  approval_decision_id:"11111111-1111-4111-8111-111111111111",
  expires_at:new Date(Date.now()+600000).toISOString()}))' "$old_image" "$old_sha" "$new_image" "$new_sha")
PRIMARY_IMAGE="$new_image"
FALLBACK_IMAGE="$old_image"
EXPECTED_SHA="$new_sha"
TARGET_IMAGE="$new_image"
TARGET_SHA="$new_sha"
BRAIN_VERSION=1.445.85
TARGET_CONTAINER=immutable-target-id
enabled=false
calls=''
_sidecar_same_target() { return 0; }
bootstrap_sidecar_audit() { calls="${calls}audit,"; return 0; }
_sidecar_docker() {
  case "$*" in
    *'/api/brain/tick/enable'*) calls="${calls}enable,"; enabled=true; printf '{"success":true,"enabled":true,"loop_running":true}' ;;
    *'/api/brain/tick/status'*) calls="${calls}status,"; if [[ "$enabled" == true ]]; then printf '{"enabled":true,"loop_running":true,"draining":false}'; else printf '{"enabled":false,"loop_running":false,"draining":false}'; fi ;;
    *) return 1 ;;
  esac
}

bootstrap_sidecar_restore_tick success
[[ "$calls" == 'audit,enable,status,' ]] || { echo "FAIL: sidecar restore calls=$calls" >&2; exit 1; }
enabled=false
TARGET_SHA="$old_sha"
TARGET_IMAGE="$old_image"
bootstrap_sidecar_restore_tick recovered
echo 'PASS: detached sidecar restores manual tick disable on new and fallback images'
