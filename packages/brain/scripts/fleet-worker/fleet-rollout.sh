#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
RUNNER_DIGEST='sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36'
FLEET_WORKER_LABEL='com.perfect21.fleet-worker'
FLEET_WORKER_DRAIN_MARKER='/var/run/cecelia/fleet-worker.drain'

GIT="${FLEET_ROLLOUT_GIT:-$(command -v git || true)}"
DOCKER="${FLEET_ROLLOUT_DOCKER:-$(command -v docker || true)}"
SSH="${FLEET_ROLLOUT_SSH:-/usr/bin/ssh}"
TAR="${FLEET_ROLLOUT_TAR:-/usr/bin/tar}"
SUDO="${FLEET_ROLLOUT_SUDO:-/usr/bin/sudo}"
ROLLOUT_TMPDIR="${FLEET_ROLLOUT_TMPDIR:-${TMPDIR:-/tmp}}"
WORKER_TOKEN_SOURCE="${FLEET_ROLLOUT_WORKER_TOKEN_FILE:-/var/lib/cecelia/fleet-worker/worker-auth}"

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

local_file_mode() {
  case "$(uname -s)" in
    Darwin) /usr/bin/stat -f '%Lp' "$1" ;;
    Linux) /usr/bin/stat -c '%a' "$1" ;;
    *) return 1 ;;
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
  local node_ctl_override="${3:-}"
  local node_ctl
  local drain_guard_armed=false

  require_machine "$machine_id"
  [[ -d "$payload_root" && ! -L "$payload_root" \
    && -f "$payload_root/repository.bundle" \
    && ! -L "$payload_root/repository.bundle" \
    && -f "$payload_root/runner.tar" \
    && ! -L "$payload_root/runner.tar" \
    && -f "$payload_root/worker-token" \
    && ! -L "$payload_root/worker-token" ]] \
    || die "rollout_payload_invalid"

  node_ctl="${node_ctl_override:-$payload_root/source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh}"
  [[ -x "$node_ctl" && ! -L "$node_ctl" ]] || die "rollout_nodectl_invalid"

  run_node_command() {
    /usr/bin/env \
      CECELIA_MACHINE_ID="$machine_id" \
      FLEET_BASELINE_REPOSITORY_BUNDLE="$payload_root/repository.bundle" \
      FLEET_BASELINE_RUNNER_ARCHIVE="$payload_root/runner.tar" \
      FLEET_BASELINE_WORKER_TOKEN_FILE="$payload_root/worker-token" \
      "$node_ctl" "$@"
  }

  restore_drain_guard() {
    if [[ "$drain_guard_armed" == true ]]; then
      drain_guard_armed=false
      run_node_command drain "$machine_id" --apply >/dev/null 2>&1 || true
    fi
  }

  # shellcheck disable=SC2329  # Invoked indirectly by signal traps below.
  stop_with_drain() {
    local status="$1"
    restore_drain_guard
    trap - EXIT HUP INT TERM
    exit "$status"
  }

  run_node_command drain "$machine_id" --apply
  if ! run_node_command bootstrap "$machine_id" --apply; then
    run_node_command drain "$machine_id" --apply >/dev/null 2>&1 || true
    return 1
  fi
  drain_guard_armed=true
  trap restore_drain_guard EXIT
  trap 'stop_with_drain 129' HUP
  trap 'stop_with_drain 130' INT
  trap 'stop_with_drain 143' TERM
  if ! run_node_command undrain "$machine_id" --apply; then
    restore_drain_guard
    trap - EXIT HUP INT TERM
    return 1
  fi
  if ! run_node_command admit "$machine_id"; then
    restore_drain_guard
    trap - EXIT HUP INT TERM
    return 1
  fi
  drain_guard_armed=false
  trap - EXIT HUP INT TERM
}

validate_internal_staging() {
  local staged_root="$1"
  local relative_path path metadata owner mode canonical_root canonical_path

  [[ "$EUID" -eq 0 ]] || return 1
  /bin/test -d "$staged_root" && /bin/test ! -L "$staged_root" || return 1
  metadata="$(/usr/bin/stat -f '%u:%Lp' -- "$staged_root")" || return 1
  [[ "$metadata" == '0:700' ]] || return 1
  canonical_root="$(/bin/realpath -- "$staged_root")" || return 1

  for relative_path in \
    source/packages/brain/scripts/fleet-worker/fleet-rollout.sh \
    source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh; do
    path="$staged_root/$relative_path"
    /bin/test -f "$path" && /bin/test ! -L "$path" || return 1
    canonical_path="$(/bin/realpath -- "$path")" || return 1
    [[ "$canonical_path" == "$canonical_root/$relative_path" ]] || return 1
    metadata="$(/usr/bin/stat -f '%u:%Lp' -- "$path")" || return 1
    IFS=: read -r owner mode <<<"$metadata"
    [[ "$owner" == 0 && "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$mode & 8#022) == 0 )) || return 1
  done
}

validate_root_staging() {
  local staged_root="$1"
  local relative_path path metadata owner mode canonical_root canonical_path

  "$SUDO" -n /bin/test -d "$staged_root" \
    && "$SUDO" -n /bin/test ! -L "$staged_root" \
    || return 1
  metadata="$("$SUDO" -n /usr/bin/stat -f '%u:%Lp' -- "$staged_root")" \
    || return 1
  [[ "$metadata" == '0:700' ]] || return 1
  canonical_root="$("$SUDO" -n /bin/realpath -- "$staged_root")" || return 1

  for relative_path in \
    source/packages/brain/scripts/fleet-worker/fleet-rollout.sh \
    source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh; do
    path="$staged_root/$relative_path"
    "$SUDO" -n /bin/test -f "$path" \
      && "$SUDO" -n /bin/test ! -L "$path" \
      || return 1
    canonical_path="$("$SUDO" -n /bin/realpath -- "$path")" || return 1
    [[ "$canonical_path" == "$canonical_root/$relative_path" ]] || return 1
    metadata="$("$SUDO" -n /usr/bin/stat -f '%u:%Lp' -- "$path")" \
      || return 1
    IFS=: read -r owner mode <<<"$metadata"
    [[ "$owner" == 0 && "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$mode & 8#022) == 0 )) || return 1
  done
}

emergency_drain_local() {
  local status=0

  "$SUDO" -n /bin/mkdir -p /var/run/cecelia >/dev/null 2>&1 || status=1
  "$SUDO" -n /usr/bin/touch \
    "$FLEET_WORKER_DRAIN_MARKER" >/dev/null 2>&1 || status=1
  "$SUDO" -n /bin/launchctl bootout \
    "system/$FLEET_WORKER_LABEL" >/dev/null 2>&1 || true
  if [[ "$status" -ne 0 ]]; then
    echo "emergency_drain_failed" >&2
    return 1
  fi
}

run_root_staged_payload() {
  local machine_id="$1"
  local payload_tar="$2"
  local staged_root controller controller_pid='' status=0

  interrupt_root_staged_payload() {
    local signal_name="$1"
    local signal_status="$2"

    trap - HUP INT TERM
    if [[ -n "$controller_pid" ]]; then
      "$SUDO" -n /bin/kill -s "$signal_name" \
        "$controller_pid" >/dev/null 2>&1 || true
      wait "$controller_pid" >/dev/null 2>&1 || true
      controller_pid=''
    fi
    emergency_drain_local || true
    "$SUDO" -n /bin/rm -rf -- "$staged_root" >/dev/null 2>&1 || true
    exit "$signal_status"
  }

  staged_root="$("$SUDO" -n /usr/bin/mktemp \
    -d /var/tmp/cecelia-fleet-rollout.XXXXXX)"
  if ! "$SUDO" -n /usr/bin/tar -xf - -C "$staged_root" <"$payload_tar" \
    || ! "$SUDO" -n /bin/mkdir -p "$staged_root/source" \
    || ! "$SUDO" -n /usr/bin/tar \
      -xf "$staged_root/source.tar" -C "$staged_root/source"; then
    "$SUDO" -n /bin/rm -rf -- "$staged_root" >/dev/null 2>&1 || true
    return 1
  fi

  controller="$staged_root/source/packages/brain/scripts/fleet-worker/fleet-rollout.sh"
  if ! validate_root_staging "$staged_root"; then
    echo "rollout_staging_invalid" >&2
    "$SUDO" -n /bin/rm -rf -- "$staged_root" >/dev/null 2>&1 || true
    return 1
  fi
  if ! "$SUDO" -n /bin/chmod \
    +x "$staged_root/source/packages/brain/scripts/fleet-worker/"*.sh; then
    status=1
  else
    trap 'interrupt_root_staged_payload HUP 129' HUP
    trap 'interrupt_root_staged_payload INT 130' INT
    trap 'interrupt_root_staged_payload TERM 143' TERM
    "$SUDO" -n "$controller" __node-apply "$machine_id" "$staged_root" &
    controller_pid=$!
    wait "$controller_pid" || status=$?
    controller_pid=''
  fi
  if ! "$SUDO" -n /bin/rm -rf -- "$staged_root" >/dev/null 2>&1; then
    emergency_drain_local || true
    status=1
  fi
  trap - HUP INT TERM
  return "$status"
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

if [[ "${1:-}" == '__node-apply' ]]; then
  [[ $# -eq 3 ]] || die "rollout_internal_usage" 64
  [[ "$EUID" -eq 0 ]] || die "rollout_internal_root_required" 77
  validate_internal_staging "$3" || die "rollout_staging_invalid"
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
[[ -f "$WORKER_TOKEN_SOURCE" && ! -L "$WORKER_TOKEN_SOURCE" ]] \
  || die "worker_token_file_required"
case "$(local_file_mode "$WORKER_TOKEN_SOURCE")" in
  400|600) ;;
  *) die "worker_token_file_permissions" ;;
esac
[[ "$(/usr/bin/tr -d '\r\n' < "$WORKER_TOKEN_SOURCE" | /usr/bin/wc -c | /usr/bin/tr -d ' ')" -ge 32 ]] \
  || die "worker_token_file_invalid"

rollout_commit="$(
  "$GIT" -C "$REPO_ROOT" rev-parse --verify 'HEAD^{commit}'
)"
[[ "$rollout_commit" =~ ^[0-9a-f]{40}$ ]] || die "rollout_source_invalid"
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
worker_token="$TEMP_ROOT/worker-token"
payload_tar="$TEMP_ROOT/payload.tar"
bundle_repository="$TEMP_ROOT/bundle.git"

"$GIT" -C "$REPO_ROOT" -c tar.umask=0022 \
  archive --format=tar --output "$source_tar" "$rollout_commit" \
  packages/brain/package.json \
  packages/brain/config/fleet-node-profiles.json \
  packages/brain/src/orchestrator/fleet-node/node-profile.js \
  packages/brain/scripts/fleet-worker
"$GIT" init --bare "$bundle_repository" >/dev/null
"$GIT" --git-dir="$bundle_repository" fetch --no-tags \
  "$REPO_ROOT" "$rollout_commit" >/dev/null
"$GIT" --git-dir="$bundle_repository" update-ref \
  refs/heads/fleet-rollout "$rollout_commit"
"$GIT" --git-dir="$bundle_repository" bundle create \
  "$repository_bundle" refs/heads/fleet-rollout
"$DOCKER" save --output "$runner_archive" "$RUNNER_DIGEST"
/bin/cp "$WORKER_TOKEN_SOURCE" "$worker_token"
/bin/chmod 0600 "$worker_token"
"$TAR" -cf "$payload_tar" -C "$TEMP_ROOT" \
  source.tar repository.bundle runner.tar worker-token
rollout_commit_after="$(
  "$GIT" -C "$REPO_ROOT" rev-parse --verify 'HEAD^{commit}'
)"
source_status_after="$(
  "$GIT" -C "$REPO_ROOT" status --porcelain --untracked-files=all
)"
[[ "$rollout_commit_after" == "$rollout_commit" && -z "$source_status_after" ]] \
  || die "rollout_source_changed"

remote_program="$(cat <<'REMOTE'
set -euo pipefail
machine_id="$1"
sudo_command="${FLEET_ROLLOUT_SUDO:-/usr/bin/sudo}"
remote_root="$("$sudo_command" -n /usr/bin/mktemp \
  -d /var/tmp/cecelia-fleet-rollout.XXXXXX)"
controller_pid=''
emergency_drain_remote() {
  local status=0
  "$sudo_command" -n /bin/mkdir \
    -p /var/run/cecelia >/dev/null 2>&1 || status=1
  "$sudo_command" -n /usr/bin/touch \
    /var/run/cecelia/fleet-worker.drain >/dev/null 2>&1 || status=1
  "$sudo_command" -n /bin/launchctl bootout \
    system/com.perfect21.fleet-worker >/dev/null 2>&1 || true
  if [[ "$status" -ne 0 ]]; then
    echo "emergency_drain_failed" >&2
    return 1
  fi
}
validate_remote_staging() {
  staged_root="$1"
  canonical_root=''
  "$sudo_command" -n /bin/test -d "$staged_root" \
    && "$sudo_command" -n /bin/test ! -L "$staged_root" \
    || return 1
  metadata="$("$sudo_command" -n /usr/bin/stat -f '%u:%Lp' -- "$staged_root")" \
    || return 1
  [[ "$metadata" == '0:700' ]] || return 1
  canonical_root="$("$sudo_command" -n /bin/realpath -- "$staged_root")" \
    || return 1
  for relative_path in \
    source/packages/brain/scripts/fleet-worker/fleet-rollout.sh \
    source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh; do
    path="$staged_root/$relative_path"
    "$sudo_command" -n /bin/test -f "$path" \
      && "$sudo_command" -n /bin/test ! -L "$path" \
      || return 1
    canonical_path="$("$sudo_command" -n /bin/realpath -- "$path")" || return 1
    [[ "$canonical_path" == "$canonical_root/$relative_path" ]] || return 1
    metadata="$("$sudo_command" -n /usr/bin/stat -f '%u:%Lp' -- "$path")" \
      || return 1
    IFS=: read -r owner mode <<<"$metadata"
    [[ "$owner" == 0 && "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$mode & 8#022) == 0 )) || return 1
  done
}
interrupt_remote() {
  signal_name="$1"
  signal_status="$2"
  trap - HUP INT TERM
  if [[ -n "$controller_pid" ]]; then
    "$sudo_command" -n /bin/kill -s "$signal_name" \
      "$controller_pid" >/dev/null 2>&1 || true
    wait "$controller_pid" >/dev/null 2>&1 || true
  fi
  emergency_drain_remote || true
  "$sudo_command" -n /bin/rm -rf -- "$remote_root" >/dev/null 2>&1 || true
  exit "$signal_status"
}
"$sudo_command" -n /usr/bin/tar -xf - -C "$remote_root"
"$sudo_command" -n /bin/mkdir -p "$remote_root/source"
"$sudo_command" -n /usr/bin/tar \
  -xf "$remote_root/source.tar" -C "$remote_root/source"
controller="$remote_root/source/packages/brain/scripts/fleet-worker/fleet-rollout.sh"
if ! validate_remote_staging "$remote_root"; then
  echo "rollout_staging_invalid" >&2
  "$sudo_command" -n /bin/rm -rf -- "$remote_root" >/dev/null 2>&1 || true
  exit 1
fi
"$sudo_command" -n /bin/chmod \
  +x "$remote_root/source/packages/brain/scripts/fleet-worker/"*.sh
trap 'interrupt_remote HUP 129' HUP
trap 'interrupt_remote INT 130' INT
trap 'interrupt_remote TERM 143' TERM
status=0
"$sudo_command" -n "$controller" __node-apply "$machine_id" "$remote_root" &
controller_pid=$!
wait "$controller_pid" || status=$?
controller_pid=''
if ! "$sudo_command" -n /bin/rm -rf -- "$remote_root" >/dev/null 2>&1; then
  emergency_drain_remote || true
  status=1
fi
trap - HUP INT TERM
exit "$status"
REMOTE
)"

interrupt_transport() {
  local signal_name="$1"
  local signal_status="$2"

  trap - HUP INT TERM
  if [[ -n "${transport_pid:-}" ]]; then
    kill -s "$signal_name" "$transport_pid" >/dev/null 2>&1 || true
    wait "$transport_pid" >/dev/null 2>&1 || true
  fi
  exit "$signal_status"
}

for machine_id in "${targets[@]}"; do
  if [[ "$machine_id" == 'us-mac-m4' ]]; then
    run_root_staged_payload "$machine_id" "$payload_tar"
    continue
  fi

  remote_target="$(ssh_target_for "$machine_id")" || die "unknown_fleet_node" 64
  remote_command="$(printf '%q ' /bin/bash -c "$remote_program" -- "$machine_id")"
  transport_status=0
  trap 'interrupt_transport HUP 129' HUP
  trap 'interrupt_transport INT 130' INT
  trap 'interrupt_transport TERM 143' TERM
  "$SSH" \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o StrictHostKeyChecking=yes \
    "$remote_target" \
    "$remote_command" \
    <"$payload_tar" &
  transport_pid=$!
  wait "$transport_pid" || transport_status=$?
  transport_pid=''
  trap - HUP INT TERM
  [[ "$transport_status" -eq 0 ]] || exit "$transport_status"
done
