#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.cecelia.fleet-worker.plist.template"
LABEL='com.perfect21.fleet-worker'
INSTALL_DIR="${FLEET_WORKER_INSTALL_DIR:-/Library/LaunchDaemons}"
LOG_DIR="${FLEET_WORKER_LOG_DIR:-/var/log/cecelia}"
LAUNCHCTL="${FLEET_WORKER_LAUNCHCTL:-/bin/launchctl}"
PLUTIL="${FLEET_WORKER_PLUTIL:-/usr/bin/plutil}"
ID_COMMAND="${FLEET_WORKER_ID:-/usr/bin/id}"
DEFAULT_NODE_PROBE="$SCRIPT_DIR/node-probe.cjs"
NODE_PROBE="${FLEET_WORKER_NODE_PROBE:-$DEFAULT_NODE_PROBE}"
NODE_EXECUTABLE="${FLEET_WORKER_NODE_EXECUTABLE:-$(command -v node || true)}"
WORKER_SOURCE="$SCRIPT_DIR/fleet-worker.cjs"
PROBE_SOURCE="$SCRIPT_DIR/node-probe.cjs"
DRAIN_MARKER="${FLEET_WORKER_DRAIN_MARKER:-/var/run/cecelia/fleet-worker.drain}"
RUNNER_DIGEST=''
LOCK_DIR=''
BACKUP_DIR=''
STAGED_WORKER=''
STAGED_PROBE=''
STAGED_PLIST=''

case "$INSTALL_DIR" in
  */Library/LaunchDaemons)
    SYSTEM_ROOT="${INSTALL_DIR%/Library/LaunchDaemons}"
    ;;
  *)
    SYSTEM_ROOT=''
    ;;
esac
RUNTIME_DIR="${FLEET_WORKER_RUNTIME_DIR:-$SYSTEM_ROOT/usr/local/libexec/cecelia/fleet-worker}"
WORKER_SCRIPT="$RUNTIME_DIR/fleet-worker.cjs"
WORKTREE_ROOT="${FLEET_WORKER_REPO_ROOT:-$SYSTEM_ROOT/var/lib/cecelia/repository}"

usage() {
  echo "usage: $0 <us-mac-m4|xian-mac-m4|xian-mac-m1> [--render-to PATH|--apply]" >&2
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

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "$value"
}

load_runner_digest() {
  [[ -n "$NODE_EXECUTABLE" && -x "$NODE_EXECUTABLE" ]] || return 1
  (
    cd "$REPO_ROOT"
    FLEET_WORKER_PROFILE_MACHINE="$machine_id" \
      "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { getNodeProfile } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const profile = getNodeProfile(process.env.FLEET_WORKER_PROFILE_MACHINE);
process.stdout.write(profile.runner_image_digest);
NODE
  )
}

run_default_preflight() {
  local service_uid service_gid
  [[ -n "$NODE_EXECUTABLE" && -x "$NODE_EXECUTABLE" ]] \
    || die "prerequisite_node"
  [[ -f "$NODE_PROBE" ]] || die "prerequisite_probe"
  /usr/bin/id -u _cecelia >/dev/null 2>&1 || die "prerequisite_service_user"
  service_uid="$(/usr/bin/id -u _cecelia)"
  service_gid="$(/usr/bin/id -g _cecelia)"

  PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  CECELIA_MACHINE_ID="$machine_id" \
  CECELIA_RUNNER_DIGEST="$RUNNER_DIGEST" \
  CECELIA_REPO_ROOT="$WORKTREE_ROOT" \
  CECELIA_DRAIN_MARKER="$DRAIN_MARKER" \
    "$NODE_EXECUTABLE" - \
      "$NODE_PROBE" "$RUNNER_DIGEST" "$service_uid" "$service_gid" <<'NODE'
'use strict';

const probePath = process.argv[2];
const expectedDigest = process.argv[3];
const serviceUid = Number(process.argv[4]);
const serviceGid = Number(process.argv[5]);
const { probeFleetWorkerHealth } = require(probePath);
const GIB = 1024 ** 3;

try {
  process.setgroups([serviceGid]);
  process.setgid(serviceGid);
  process.setuid(serviceUid);
} catch {
  process.stderr.write('prerequisite_service_user_access\n');
  process.exit(1);
}

probeFleetWorkerHealth().then((report) => {
  const failures = [];
  if (!report || report.orbstack?.version === 'unavailable') failures.push('orbstack');
  if (report?.docker?.available !== true) failures.push('docker');
  if (report?.runner?.image_digest !== expectedDigest) failures.push('runner_digest');
  if (!Number.isFinite(report?.resources?.disk_free_bytes)
      || report.resources.disk_free_bytes < 40 * GIB
      || report.resources.disk_used_percent > 85) failures.push('disk');
  if (!Number.isFinite(report?.resources?.memory_bytes)
      || report.resources.memory_bytes < 8 * GIB) failures.push('memory');
  if (report?.worktree?.root_ready !== true) failures.push('repository_access');
  if (report?.container?.probe_succeeded !== true) failures.push('container');
  if (failures.length > 0) {
    process.stderr.write(`prerequisite_${failures[0]}\n`);
    process.exitCode = 1;
  }
}).catch(() => {
  process.stderr.write('prerequisite_probe\n');
  process.exitCode = 1;
});
NODE
}

run_preflight() {
  if [[ "$NODE_PROBE" == "$DEFAULT_NODE_PROBE" ]]; then
    run_default_preflight
  else
    "$NODE_PROBE"
  fi
}

render_plist() {
  local target="$1"
  local target_dir temporary line
  local escaped_machine escaped_digest escaped_node escaped_worker
  local escaped_marker escaped_root escaped_stdout escaped_stderr

  [[ -f "$TEMPLATE" ]] || die "plist_template_missing"
  [[ -n "$NODE_EXECUTABLE" ]] || die "prerequisite_node"
  [[ -f "$WORKER_SOURCE" && -f "$PROBE_SOURCE" ]] || die "worker_script_missing"
  target_dir="$(dirname "$target")"
  [[ -d "$target_dir" ]] || die "render_target_parent_missing"
  temporary="$(mktemp "$target_dir/.fleet-worker.plist.XXXXXX")"

  escaped_machine="$(xml_escape "$machine_id")"
  escaped_digest="$(xml_escape "$RUNNER_DIGEST")"
  escaped_node="$(xml_escape "$NODE_EXECUTABLE")"
  escaped_worker="$(xml_escape "$WORKER_SCRIPT")"
  escaped_marker="$(xml_escape "$DRAIN_MARKER")"
  escaped_root="$(xml_escape "$WORKTREE_ROOT")"
  escaped_stdout="$(xml_escape "$LOG_DIR/fleet-worker.stdout.log")"
  escaped_stderr="$(xml_escape "$LOG_DIR/fleet-worker.stderr.log")"

  (
    trap 'rm -f "$temporary"' EXIT
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line//@@MACHINE_ID@@/$escaped_machine}"
      line="${line//@@RUNNER_DIGEST@@/$escaped_digest}"
      line="${line//@@NODE_EXECUTABLE@@/$escaped_node}"
      line="${line//@@WORKER_SCRIPT@@/$escaped_worker}"
      line="${line//@@DRAIN_MARKER@@/$escaped_marker}"
      line="${line//@@REPO_ROOT@@/$escaped_root}"
      line="${line//@@STDOUT_LOG@@/$escaped_stdout}"
      line="${line//@@STDERR_LOG@@/$escaped_stderr}"
      printf '%s\n' "$line"
    done < "$TEMPLATE" > "$temporary"

    chmod 0644 "$temporary"
    mv "$temporary" "$target"
  )
}

cleanup_transaction() {
  [[ -z "$STAGED_WORKER" ]] || rm -f "$STAGED_WORKER"
  [[ -z "$STAGED_PROBE" ]] || rm -f "$STAGED_PROBE"
  [[ -z "$STAGED_PLIST" ]] || rm -f "$STAGED_PLIST"
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rm -f "$BACKUP_DIR/worker" "$BACKUP_DIR/probe" "$BACKUP_DIR/plist"
    rmdir "$BACKUP_DIR" 2>/dev/null || true
  fi
  [[ -z "$LOCK_DIR" ]] || rmdir "$LOCK_DIR" 2>/dev/null || true
}

prepare_transaction_paths() {
  local runtime_parent

  [[ ! -L "$RUNTIME_DIR" ]] || die "runtime_path_invalid"
  runtime_parent="$(dirname "$RUNTIME_DIR")"
  mkdir -p "$RUNTIME_DIR"
  chmod 0755 "$runtime_parent" "$RUNTIME_DIR"
  LOCK_DIR="$INSTALL_DIR/.fleet-worker.install.lock"
  mkdir "$LOCK_DIR" 2>/dev/null || die "install_locked"
  trap cleanup_transaction EXIT
  BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fleet-worker-backup.XXXXXX")"
  STAGED_WORKER="$(mktemp "$RUNTIME_DIR/.fleet-worker.cjs.XXXXXX")"
  STAGED_PROBE="$(mktemp "$RUNTIME_DIR/.node-probe.cjs.XXXXXX")"
  STAGED_PLIST="$(mktemp "$INSTALL_DIR/.fleet-worker.plist.XXXXXX")"
}

stage_generation() {
  cp "$WORKER_SOURCE" "$STAGED_WORKER"
  cp "$PROBE_SOURCE" "$STAGED_PROBE"
  chmod 0755 "$STAGED_WORKER"
  chmod 0644 "$STAGED_PROBE"
  render_plist "$STAGED_PLIST"
  "$PLUTIL" -lint "$STAGED_PLIST" >/dev/null 2>&1 \
    || die "plist_validation_failed"
}

file_mode() {
  case "$(uname -s)" in
    Darwin) stat -f '%Lp' "$1" ;;
    Linux) stat -c '%a' "$1" ;;
    *) return 1 ;;
  esac
}

snapshot_file() {
  local source="$1"
  local backup="$2"

  [[ ! -L "$source" ]] || die "install_path_invalid"
  if [[ -e "$source" ]]; then
    [[ -f "$source" ]] || die "install_path_invalid"
    cp "$source" "$backup"
    file_mode "$source"
  else
    printf 'absent'
  fi
}

restore_file() {
  local target="$1"
  local backup="$2"
  local mode="$3"
  local temporary

  if [[ "$mode" == 'absent' ]]; then
    rm -f "$target"
    return
  fi

  temporary="$(mktemp "$(dirname "$target")/.fleet-worker.rollback.XXXXXX")" \
    || return 1
  if ! cp "$backup" "$temporary" || ! chmod "$mode" "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  mv "$temporary" "$target"
}

prepare_logs() {
  local stdout_log="$LOG_DIR/fleet-worker.stdout.log"
  local stderr_log="$LOG_DIR/fleet-worker.stderr.log"

  mkdir -p "$LOG_DIR"
  chmod 0755 "$LOG_DIR"
  [[ ! -L "$stdout_log" && ! -L "$stderr_log" ]] || die "log_path_invalid"
  [[ ! -e "$stdout_log" || -f "$stdout_log" ]] || die "log_path_invalid"
  [[ ! -e "$stderr_log" || -f "$stderr_log" ]] || die "log_path_invalid"
  touch "$stdout_log" "$stderr_log"
  chmod 0640 "$stdout_log" "$stderr_log"
  if [[ "$(/usr/bin/id -u)" == '0' ]]; then
    /usr/sbin/chown _cecelia "$stdout_log" "$stderr_log"
  fi
}

[[ $# -ge 1 && $# -le 3 ]] || { usage; exit 64; }
machine_id="$1"
shift
require_machine "$machine_id"

mode='dry-run'
render_target=''
if [[ $# -gt 0 ]]; then
  case "$1" in
    --apply)
      [[ $# -eq 1 ]] || { usage; exit 64; }
      mode='apply'
      ;;
    --render-to)
      [[ $# -eq 2 && -n "$2" ]] || { usage; exit 64; }
      mode='render'
      render_target="$2"
      ;;
    *)
      usage
      exit 64
      ;;
  esac
fi

if [[ "$mode" == 'dry-run' ]]; then
  echo "dry-run: would validate and install system/$LABEL for $machine_id"
  exit 0
fi

if ! RUNNER_DIGEST="$(load_runner_digest)"; then
  die "node_profile_unavailable"
fi

if [[ "$mode" == 'apply' && "$("$ID_COMMAND" -u)" != '0' ]]; then
  die "root_required" 77
fi

run_preflight

if [[ "$mode" == 'render' ]]; then
  render_plist "$render_target"
  echo "rendered: $render_target"
  exit 0
fi

installed_plist="$INSTALL_DIR/$LABEL.plist"
[[ ! -L "$INSTALL_DIR" && ! -L "$installed_plist" ]] || die "install_path_invalid"
mkdir -p "$INSTALL_DIR"
prepare_logs
prepare_transaction_paths
stage_generation

prior_worker_mode="$(snapshot_file "$WORKER_SCRIPT" "$BACKUP_DIR/worker")"
prior_probe_mode="$(
  snapshot_file "$RUNTIME_DIR/node-probe.cjs" "$BACKUP_DIR/probe"
)"
prior_plist_mode="$(snapshot_file "$installed_plist" "$BACKUP_DIR/plist")"
had_prior_service=false
[[ "$prior_plist_mode" == 'absent' ]] || had_prior_service=true

if [[ "$had_prior_service" == true ]]; then
  "$LAUNCHCTL" bootout "system/$LABEL" >/dev/null 2>&1 || true
fi

placement_ok=true
mv "$STAGED_PROBE" "$RUNTIME_DIR/node-probe.cjs" || placement_ok=false
[[ "$placement_ok" == false ]] \
  || mv "$STAGED_WORKER" "$WORKER_SCRIPT" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || mv "$STAGED_PLIST" "$installed_plist" \
  || placement_ok=false

launch_ok="$placement_ok"
if [[ "$launch_ok" == true ]]; then
  "$LAUNCHCTL" bootstrap system "$installed_plist" >/dev/null 2>&1 \
    || launch_ok=false
fi
if [[ "$launch_ok" == true ]]; then
  "$LAUNCHCTL" kickstart -k "system/$LABEL" >/dev/null 2>&1 \
    || launch_ok=false
fi

if [[ "$launch_ok" != true ]]; then
  "$LAUNCHCTL" bootout "system/$LABEL" >/dev/null 2>&1 || true
  rollback_ok=true
  restore_file "$WORKER_SCRIPT" "$BACKUP_DIR/worker" "$prior_worker_mode" \
    || rollback_ok=false
  restore_file "$RUNTIME_DIR/node-probe.cjs" "$BACKUP_DIR/probe" "$prior_probe_mode" \
    || rollback_ok=false
  restore_file "$installed_plist" "$BACKUP_DIR/plist" "$prior_plist_mode" \
    || rollback_ok=false
  if [[ "$had_prior_service" == true ]]; then
    "$LAUNCHCTL" bootstrap system "$installed_plist" >/dev/null 2>&1 \
      || rollback_ok=false
    "$LAUNCHCTL" kickstart -k "system/$LABEL" >/dev/null 2>&1 \
      || rollback_ok=false
  fi
  if [[ "$rollback_ok" == true ]]; then
    die "install_failed_rolled_back"
  fi
  die "install_failed_rollback_incomplete"
fi

echo "installed: system/$LABEL for $machine_id"
