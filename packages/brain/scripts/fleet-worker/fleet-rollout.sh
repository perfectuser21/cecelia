#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
RUNNER_DIGEST='sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36'

GIT="${FLEET_ROLLOUT_GIT:-$(command -v git || true)}"
DOCKER="${FLEET_ROLLOUT_DOCKER:-$(command -v docker || true)}"
SSH="${FLEET_ROLLOUT_SSH:-/usr/bin/ssh}"
TAR="${FLEET_ROLLOUT_TAR:-/usr/bin/tar}"
SUDO="${FLEET_ROLLOUT_SUDO:-/usr/bin/sudo}"
ROLLOUT_TMPDIR="${FLEET_ROLLOUT_TMPDIR:-${TMPDIR:-/tmp}}"
NODECTL_OVERRIDE="${FLEET_ROLLOUT_NODECTL:-}"

TEMP_ROOT=''

usage() {
  echo "usage: $0 <us-mac-m4|xian-mac-m4|xian-mac-m1|all> [--apply]" >&2
}

die() {
  echo "$1" >&2
  exit "${2:-1}"
}

require_machine() {
  case "$1" in
    us-mac-m4|xian-mac-m4|xian-mac-m1) ;;
    *) die "unknown_fleet_node" 64 ;;
  esac
}

ssh_target_for() {
  case "$1" in
    xian-mac-m4) echo 'jinnuoshengyuan@100.86.57.69' ;;
    xian-mac-m1) echo 'xx-macmini@100.88.166.55' ;;
    *) return 1 ;;
  esac
}

cleanup() {
  if [[ -n "$TEMP_ROOT" && -d "$TEMP_ROOT" ]]; then
    /bin/rm -rf -- "$TEMP_ROOT"
  fi
}

run_node_apply() {
  local machine_id="$1"
  local payload_root="$2"
  local node_ctl

  require_machine "$machine_id"
  [[ -d "$payload_root" && ! -L "$payload_root" \
    && -f "$payload_root/repository.bundle" \
    && ! -L "$payload_root/repository.bundle" \
    && -f "$payload_root/runner.tar" \
    && ! -L "$payload_root/runner.tar" ]] \
    || die "rollout_payload_invalid"

  node_ctl="${NODECTL_OVERRIDE:-$payload_root/source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh}"
  [[ -x "$node_ctl" && ! -L "$node_ctl" ]] || die "rollout_nodectl_invalid"
  [[ -x "$SUDO" ]] || die "sudo_unavailable"

  run_node_command() {
    "$SUDO" -n env \
      CECELIA_MACHINE_ID="$machine_id" \
      FLEET_BASELINE_REPOSITORY_BUNDLE="$payload_root/repository.bundle" \
      FLEET_BASELINE_RUNNER_ARCHIVE="$payload_root/runner.tar" \
      "$node_ctl" "$@"
  }

  run_node_command drain "$machine_id" --apply
  if ! run_node_command bootstrap "$machine_id" --apply; then
    run_node_command drain "$machine_id" --apply >/dev/null 2>&1 || true
    return 1
  fi
  if ! run_node_command undrain "$machine_id" --apply; then
    run_node_command drain "$machine_id" --apply >/dev/null 2>&1 || true
    return 1
  fi
  if ! run_node_command admit "$machine_id"; then
    run_node_command drain "$machine_id" --apply >/dev/null 2>&1 || true
    return 1
  fi
}

if [[ "${1:-}" == '__node-apply' ]]; then
  [[ $# -eq 3 ]] || die "rollout_internal_usage" 64
  run_node_apply "$2" "$3"
  exit 0
fi

[[ $# -ge 1 && $# -le 2 ]] || { usage; exit 64; }
target="$1"
shift
case "$target" in
  us-mac-m4|xian-mac-m4|xian-mac-m1|all) ;;
  *) die "unknown_fleet_node" 64 ;;
esac

mode='dry-run'
if [[ $# -gt 0 ]]; then
  [[ $# -eq 1 && "$1" == '--apply' ]] || { usage; exit 64; }
  mode='apply'
fi

if [[ "$target" == 'all' ]]; then
  targets=(xian-mac-m4 us-mac-m4 xian-mac-m1)
else
  targets=("$target")
fi

if [[ "$mode" == 'dry-run' ]]; then
  for machine_id in "${targets[@]}"; do
    echo "dry-run: would roll out committed Phase 4A baseline to $machine_id"
  done
  exit 0
fi

[[ "${CECELIA_MACHINE_ID:-}" == 'us-mac-m4' ]] \
  || die "controller_machine_mismatch" 65
[[ -n "$GIT" && -x "$GIT" ]] || die "git_unavailable"
[[ -n "$DOCKER" && -x "$DOCKER" ]] || die "docker_unavailable"
[[ -x "$SSH" && -x "$TAR" ]] || die "rollout_transport_unavailable"

source_status="$(
  "$GIT" -C "$REPO_ROOT" status --porcelain --untracked-files=all
)"
[[ -z "$source_status" ]] || die "rollout_source_dirty"

/bin/mkdir -p "$ROLLOUT_TMPDIR"
TEMP_ROOT="$(mktemp -d "$ROLLOUT_TMPDIR/fleet-rollout.XXXXXX")"
trap cleanup EXIT
source_tar="$TEMP_ROOT/source.tar"
repository_bundle="$TEMP_ROOT/repository.bundle"
runner_archive="$TEMP_ROOT/runner.tar"
payload_tar="$TEMP_ROOT/payload.tar"

"$GIT" -C "$REPO_ROOT" archive --format=tar --output "$source_tar" HEAD \
  packages/brain/package.json \
  packages/brain/config/fleet-node-profiles.json \
  packages/brain/src/orchestrator/fleet-node/node-profile.js \
  packages/brain/scripts/fleet-worker
"$GIT" -C "$REPO_ROOT" bundle create "$repository_bundle" HEAD
"$DOCKER" save --output "$runner_archive" "$RUNNER_DIGEST"
"$TAR" -cf "$payload_tar" -C "$TEMP_ROOT" \
  source.tar repository.bundle runner.tar

remote_program="$(cat <<'REMOTE'
set -euo pipefail
machine_id="$1"
remote_root="$(mktemp -d /tmp/cecelia-fleet-rollout.XXXXXX)"
cleanup_remote() {
  /bin/rm -rf -- "$remote_root"
}
trap cleanup_remote EXIT
/usr/bin/tar -xf - -C "$remote_root"
/bin/mkdir -p "$remote_root/source"
/usr/bin/tar -xf "$remote_root/source.tar" -C "$remote_root/source"
controller="$remote_root/source/packages/brain/scripts/fleet-worker/fleet-rollout.sh"
/bin/chmod +x "$remote_root/source/packages/brain/scripts/fleet-worker/"*.sh
"$controller" __node-apply "$machine_id" "$remote_root"
REMOTE
)"

for machine_id in "${targets[@]}"; do
  if [[ "$machine_id" == 'us-mac-m4' ]]; then
    local_payload="$TEMP_ROOT/local-$machine_id"
    /bin/mkdir -p "$local_payload/source"
    /bin/cp "$repository_bundle" "$local_payload/repository.bundle"
    /bin/cp "$runner_archive" "$local_payload/runner.tar"
    "$TAR" -xf "$source_tar" -C "$local_payload/source"
    local_controller="$local_payload/source/packages/brain/scripts/fleet-worker/fleet-rollout.sh"
    /bin/chmod +x "$local_payload/source/packages/brain/scripts/fleet-worker/"*.sh
    "$local_controller" __node-apply "$machine_id" "$local_payload"
    continue
  fi

  remote_target="$(ssh_target_for "$machine_id")" || die "unknown_fleet_node" 64
  remote_command="$(printf '%q ' /bin/bash -c "$remote_program" -- "$machine_id")"
  "$SSH" \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "$remote_target" \
    "$remote_command" \
    <"$payload_tar"
done
