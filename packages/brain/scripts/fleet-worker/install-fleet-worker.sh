#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.cecelia.fleet-worker.plist.template"
LABEL='com.perfect21.fleet-worker'
ACCESS_LABEL='com.perfect21.fleet-worker-docker-access'
INSTALL_DIR="${FLEET_WORKER_INSTALL_DIR:-/Library/LaunchDaemons}"
LOG_DIR="${FLEET_WORKER_LOG_DIR:-/var/log/cecelia}"
LAUNCHCTL="${FLEET_WORKER_LAUNCHCTL:-/bin/launchctl}"
PLUTIL="${FLEET_WORKER_PLUTIL:-/usr/bin/plutil}"
ID_COMMAND="${FLEET_WORKER_ID:-/usr/bin/id}"
READLINK="${FLEET_WORKER_READLINK:-/usr/bin/readlink}"
ACL_LIST="${FLEET_WORKER_ACL_LIST:-/bin/ls}"
CHMOD="${FLEET_WORKER_CHMOD:-/bin/chmod}"
CHOWN="${FLEET_WORKER_CHOWN:-/usr/sbin/chown}"
STAT="${FLEET_WORKER_STAT:-/usr/bin/stat}"
MOVE="${FLEET_WORKER_MV:-/bin/mv}"
SLEEP="${FLEET_WORKER_SLEEP:-/bin/sleep}"
STARTUP_PROBE="${FLEET_WORKER_STARTUP_PROBE:-}"
STARTUP_ATTEMPTS="${FLEET_WORKER_STARTUP_ATTEMPTS:-20}"
PREFLIGHT_ATTEMPTS="${FLEET_WORKER_PREFLIGHT_ATTEMPTS:-10}"
PREFLIGHT_RETRY_SECONDS="${FLEET_WORKER_PREFLIGHT_RETRY_SECONDS:-1}"
DOCKER_SOCKET_LINK='/var/run/docker.sock'
DEFAULT_NODE_PROBE="$SCRIPT_DIR/node-probe.cjs"
NODE_PROBE="${FLEET_WORKER_NODE_PROBE:-$DEFAULT_NODE_PROBE}"
NODE_EXECUTABLE="${FLEET_WORKER_NODE_EXECUTABLE:-$(command -v node || true)}"
WORKER_SOURCE="$SCRIPT_DIR/fleet-worker.cjs"
PROBE_SOURCE="$SCRIPT_DIR/node-probe.cjs"
WORKSPACE_MANAGER_SOURCE="$SCRIPT_DIR/workspace-manager.cjs"
ATTEMPT_RUNNER_SOURCE="$SCRIPT_DIR/attempt-runner.cjs"
CREDENTIAL_ENVELOPE_SOURCE="$SCRIPT_DIR/credential-envelope.cjs"
GITHUB_CREDENTIAL_ENVELOPE_SOURCE="$SCRIPT_DIR/github-credential-envelope.cjs"
ACCESS_HELPER_SOURCE="$SCRIPT_DIR/refresh-fleet-worker-docker-access.sh"
ACCESS_TEMPLATE="$SCRIPT_DIR/com.cecelia.fleet-worker-docker-access.plist.template"
DRAIN_MARKER="${FLEET_WORKER_DRAIN_MARKER:-/var/run/cecelia/fleet-worker.drain}"
RUNNER_DIGEST=''
WORKER_BIND_HOST=''
BRAIN_HEALTH_URL=''
LOCK_DIR=''
BACKUP_DIR=''
STAGED_WORKER=''
STAGED_PROBE=''
STAGED_WORKSPACE_MANAGER=''
STAGED_ATTEMPT_RUNNER=''
STAGED_CREDENTIAL_ENVELOPE=''
STAGED_GITHUB_CREDENTIAL_ENVELOPE=''
STAGED_PLIST=''
STAGED_ACCESS_HELPER=''
STAGED_ACCESS_PLIST=''
ACL_ADDED=false
ACL_HOME=''
ORBSTACK_DIR_ACL_ADDED=false
ACL_ORBSTACK_DIR=''
RUN_DIR_ACL_ADDED=false
ACL_RUN_DIR=''
SOCKET_ACL_ADDED=false
DOCKER_SOCKET_TARGET=''
INSTALL_SUCCEEDED=false

case "$INSTALL_DIR" in
  */Library/LaunchDaemons)
    SYSTEM_ROOT="${INSTALL_DIR%/Library/LaunchDaemons}"
    ;;
  *)
    SYSTEM_ROOT=''
    ;;
esac
RUNTIME_DIR="${FLEET_WORKER_RUNTIME_DIR:-$SYSTEM_ROOT/usr/local/libexec/cecelia/fleet-worker}"
TOOLCHAIN_BIN="$SYSTEM_ROOT/usr/local/libexec/cecelia/toolchain/bin"
COMMAND_PATH="$TOOLCHAIN_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
WORKER_SCRIPT="$RUNTIME_DIR/fleet-worker.cjs"
WORKSPACE_MANAGER_SCRIPT="$RUNTIME_DIR/workspace-manager.cjs"
ATTEMPT_RUNNER_SCRIPT="$RUNTIME_DIR/attempt-runner.cjs"
CREDENTIAL_ENVELOPE_SCRIPT="$RUNTIME_DIR/credential-envelope.cjs"
GITHUB_CREDENTIAL_ENVELOPE_SCRIPT="$RUNTIME_DIR/github-credential-envelope.cjs"
ACCESS_HELPER="$RUNTIME_DIR/refresh-fleet-worker-docker-access.sh"
WORKTREE_ROOT="${FLEET_WORKER_REPO_ROOT:-$SYSTEM_ROOT/var/lib/cecelia/repository}"
FLEET_DATA_ROOT="${FLEET_WORKER_DATA_ROOT:-$SYSTEM_ROOT/var/lib/cecelia/fleet-worker}"
WORKER_TOKEN_FILE="${FLEET_WORKER_TOKEN_FILE:-$FLEET_DATA_ROOT/worker-token}"
ORBSTACK_HOME="${FLEET_WORKER_ORBSTACK_HOME:-/var/empty}"
SHARED_TMPDIR="${FLEET_WORKER_SHARED_TMPDIR:-$SYSTEM_ROOT/Users/Shared/cecelia-fleet-tmp}"

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

load_worker_bind_host() {
  [[ -n "$NODE_EXECUTABLE" && -x "$NODE_EXECUTABLE" ]] || return 1
  (
    cd "$REPO_ROOT"
    FLEET_WORKER_PROFILE_MACHINE="$machine_id" \
      "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { getNodeProfile } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const profile = getNodeProfile(process.env.FLEET_WORKER_PROFILE_MACHINE);
process.stdout.write(profile.worker_bind_host);
NODE
  )
}

load_brain_health_url() {
  [[ -n "$NODE_EXECUTABLE" && -x "$NODE_EXECUTABLE" ]] || return 1
  (
    cd "$REPO_ROOT"
    FLEET_WORKER_PROFILE_MACHINE="$machine_id" \
      "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { getNodeProfile } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const profile = getNodeProfile(process.env.FLEET_WORKER_PROFILE_MACHINE);
process.stdout.write(profile.brain_health_url);
NODE
  )
}

run_default_preflight() {
  local service_uid service_gid
  [[ -n "$NODE_EXECUTABLE" && -x "$NODE_EXECUTABLE" ]] \
    || die "prerequisite_node"
  [[ -f "$NODE_PROBE" ]] || die "prerequisite_probe"
  "$ID_COMMAND" -u _cecelia >/dev/null 2>&1 || die "prerequisite_service_user"
  service_uid="$("$ID_COMMAND" -u _cecelia)"
  service_gid="$("$ID_COMMAND" -g _cecelia)"

  PATH="$COMMAND_PATH" \
  DOCKER_HOST='unix:///var/run/docker.sock' \
  CECELIA_CALLBACK_URL="$BRAIN_HEALTH_URL" \
  CECELIA_MACHINE_ID="$machine_id" \
  CECELIA_RUNNER_DIGEST="$RUNNER_DIGEST" \
  CECELIA_ORBSTACK_HOME="$ORBSTACK_HOME" \
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

run_preflight_with_retry() {
  local attempt output retry_signature status

  if [[ ! "$PREFLIGHT_ATTEMPTS" =~ ^([1-9]|[1-5][0-9]|60)$ ]]; then
    die "preflight_retry_config_invalid"
  fi
  if [[ ! "$PREFLIGHT_RETRY_SECONDS" =~ ^(0|[1-9]|[1-5][0-9]|60)$ ]]; then
    die "preflight_retry_config_invalid"
  fi

  for ((attempt = 1; attempt <= PREFLIGHT_ATTEMPTS; attempt += 1)); do
    if output="$(run_preflight 2>&1)"; then
      [[ -z "$output" ]] || printf '%s\n' "$output"
      return 0
    else
      status=$?
    fi

    retry_signature="${output##*$'\n'}"
    case "$retry_signature" in
      prerequisite_orbstack) ;;
      *)
        printf '%s\n' "$output" >&2
        return "$status"
        ;;
    esac

    if (( attempt == PREFLIGHT_ATTEMPTS )); then
      printf '%s\n' "$output" >&2
      return "$status"
    fi
    "$SLEEP" "$PREFLIGHT_RETRY_SECONDS" \
      || die "preflight_retry_sleep_failed"
  done
}

probe_started_worker_once() {
  local health_url="http://$WORKER_BIND_HOST:5231/health"
  if [[ -n "$STARTUP_PROBE" ]]; then
    "$STARTUP_PROBE" "$health_url" "$machine_id"
    return
  fi

  FLEET_WORKER_STARTUP_HEALTH_URL="$health_url" \
  FLEET_WORKER_STARTUP_MACHINE="$machine_id" \
    "$NODE_EXECUTABLE" --input-type=module <<'NODE'
import { Buffer } from 'node:buffer';

const MAX_BODY_BYTES = 64 * 1024;
const healthUrl = process.env.FLEET_WORKER_STARTUP_HEALTH_URL;
const machineId = process.env.FLEET_WORKER_STARTUP_MACHINE;

try {
  const response = await fetch(healthUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('startup_health_http');

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('startup_health_too_large');
  }

  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('startup_health_body_missing');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('startup_health_too_large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }

  const report = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  if (report?.schema_version !== 'fleet-node-health/v1'
      || report?.machine_id !== machineId) {
    throw new Error('startup_health_identity');
  }
} catch {
  process.exitCode = 1;
}
NODE
}

verify_started_generation() {
  local attempt launch_state
  [[ "$STARTUP_ATTEMPTS" =~ ^[0-9]+$ ]] \
    && (( STARTUP_ATTEMPTS >= 1 && STARTUP_ATTEMPTS <= 60 )) \
    || return 1

  for ((attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt += 1)); do
    launch_state="$("$LAUNCHCTL" print "system/$LABEL" 2>/dev/null)" || launch_state=''
    if /usr/bin/grep -Eq \
      'state[[:space:]]*=[[:space:]]*running' <<<"$launch_state" \
      && probe_started_worker_once >/dev/null 2>&1; then
      return 0
    fi
    if (( attempt < STARTUP_ATTEMPTS )); then
      "$SLEEP" 0.5 || return 1
    fi
  done
  return 1
}

has_managed_orbstack_acl() {
  "$ACL_LIST" -lde "$ACL_HOME" 2>/dev/null \
    | /usr/bin/grep -Eq '^[[:space:]]*[0-9]+: user:_cecelia allow search$'
}

has_managed_orbstack_dir_acl() {
  "$ACL_LIST" -lde "$ACL_ORBSTACK_DIR" 2>/dev/null \
    | /usr/bin/grep -Eq '^[[:space:]]*[0-9]+: user:_cecelia allow search$'
}

has_managed_orbstack_run_acl() {
  "$ACL_LIST" -lde "$ACL_RUN_DIR" 2>/dev/null \
    | /usr/bin/grep -Eq '^[[:space:]]*[0-9]+: user:_cecelia allow search$'
}

has_managed_orbstack_socket_acl() {
  "$ACL_LIST" -lde "$DOCKER_SOCKET_TARGET" 2>/dev/null \
    | /usr/bin/grep -Eq \
      '^[[:space:]]*[0-9]+: user:_cecelia allow read,write$'
}

rollback_new_orbstack_socket_acl() {
  if [[ "$SOCKET_ACL_ADDED" == true && "$INSTALL_SUCCEEDED" != true ]]; then
    if ! has_managed_orbstack_socket_acl; then
      SOCKET_ACL_ADDED=false
      return
    fi
    if ! "$CHMOD" -a '_cecelia allow read,write' \
      "$DOCKER_SOCKET_TARGET" >/dev/null 2>&1; then
      echo "docker_socket_acl_rollback_incomplete" >&2
      return 1
    fi
    SOCKET_ACL_ADDED=false
  fi
}

rollback_new_orbstack_run_acl() {
  if [[ "$RUN_DIR_ACL_ADDED" == true && "$INSTALL_SUCCEEDED" != true ]]; then
    if ! has_managed_orbstack_run_acl; then
      RUN_DIR_ACL_ADDED=false
      return
    fi
    if ! "$CHMOD" -a '_cecelia allow search' \
      "$ACL_RUN_DIR" >/dev/null 2>&1; then
      echo "docker_acl_rollback_incomplete" >&2
      return 1
    fi
    RUN_DIR_ACL_ADDED=false
  fi
}

rollback_new_orbstack_dir_acl() {
  if [[ "$ORBSTACK_DIR_ACL_ADDED" == true \
    && "$INSTALL_SUCCEEDED" != true ]]; then
    if ! has_managed_orbstack_dir_acl; then
      ORBSTACK_DIR_ACL_ADDED=false
      return
    fi
    if ! "$CHMOD" -a '_cecelia allow search' \
      "$ACL_ORBSTACK_DIR" >/dev/null 2>&1; then
      echo "docker_acl_rollback_incomplete" >&2
      return 1
    fi
    ORBSTACK_DIR_ACL_ADDED=false
  fi
}

rollback_new_orbstack_acl() {
  if [[ "$ACL_ADDED" == true && "$INSTALL_SUCCEEDED" != true ]]; then
    if ! has_managed_orbstack_acl; then
      ACL_ADDED=false
      return
    fi
    if ! "$CHMOD" -a '_cecelia allow search' "$ACL_HOME" >/dev/null 2>&1; then
      echo "docker_acl_rollback_incomplete" >&2
      return 1
    fi
    ACL_ADDED=false
  fi
}

prepare_orbstack_access() {
  local owner_name

  "$ID_COMMAND" -u _cecelia >/dev/null 2>&1 || die "prerequisite_service_user"
  DOCKER_SOCKET_TARGET="$("$READLINK" "$DOCKER_SOCKET_LINK" 2>/dev/null)" \
    || die "prerequisite_docker_socket"
  case "$DOCKER_SOCKET_TARGET" in
    /Users/*/.orbstack/run/docker.sock) ;;
    *) die "prerequisite_docker_socket_target" ;;
  esac

  ACL_HOME="${DOCKER_SOCKET_TARGET%/.orbstack/run/docker.sock}"
  ACL_ORBSTACK_DIR="$ACL_HOME/.orbstack"
  ACL_RUN_DIR="$ACL_ORBSTACK_DIR/run"
  owner_name="${ACL_HOME#/Users/}"
  if [[ -z "$owner_name" || "$owner_name" == */* || "$owner_name" == '.' \
    || "$owner_name" == '..' || ! "$owner_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    die "prerequisite_docker_socket_target"
  fi

  if ! has_managed_orbstack_acl; then
    trap cleanup_transaction EXIT
    ACL_ADDED=true
    "$CHMOD" +a '_cecelia allow search' "$ACL_HOME" >/dev/null 2>&1 \
      || die "prerequisite_docker_acl"
  fi

  if ! has_managed_orbstack_dir_acl; then
    trap cleanup_transaction EXIT
    ORBSTACK_DIR_ACL_ADDED=true
    "$CHMOD" +a '_cecelia allow search' \
      "$ACL_ORBSTACK_DIR" >/dev/null 2>&1 \
      || die "prerequisite_docker_acl"
  fi

  if ! has_managed_orbstack_run_acl; then
    trap cleanup_transaction EXIT
    RUN_DIR_ACL_ADDED=true
    "$CHMOD" +a '_cecelia allow search' "$ACL_RUN_DIR" >/dev/null 2>&1 \
      || die "prerequisite_docker_acl"
  fi

  [[ -x "$ACCESS_HELPER_SOURCE" ]] || die "prerequisite_docker_access_helper"
  if has_managed_orbstack_socket_acl; then
    return
  fi

  trap cleanup_transaction EXIT
  SOCKET_ACL_ADDED=true
  FLEET_WORKER_ID="$ID_COMMAND" \
  FLEET_WORKER_READLINK="$READLINK" \
  FLEET_WORKER_STAT="$STAT" \
  FLEET_WORKER_ACL_LIST="$ACL_LIST" \
  FLEET_WORKER_CHMOD="$CHMOD" \
    "$ACCESS_HELPER_SOURCE" \
    || die "prerequisite_docker_socket_acl"
}

render_plist() {
  local target="$1"
  local target_dir temporary line
  local escaped_machine escaped_digest escaped_bind_host escaped_brain_health
  local escaped_orbstack_home
  local escaped_node escaped_worker
  local escaped_marker escaped_root escaped_token_file escaped_data_root
  local escaped_stdout escaped_stderr

  [[ -f "$TEMPLATE" ]] || die "plist_template_missing"
  [[ -n "$NODE_EXECUTABLE" ]] || die "prerequisite_node"
  [[ -f "$WORKER_SOURCE" && -f "$PROBE_SOURCE" \
    && -f "$WORKSPACE_MANAGER_SOURCE" && -f "$ATTEMPT_RUNNER_SOURCE" \
    && -f "$CREDENTIAL_ENVELOPE_SOURCE" \
    && -f "$GITHUB_CREDENTIAL_ENVELOPE_SOURCE" ]] \
    || die "worker_script_missing"
  target_dir="$(dirname "$target")"
  [[ -d "$target_dir" ]] || die "render_target_parent_missing"
  temporary="$(mktemp "$target_dir/.fleet-worker.plist.XXXXXX")"

  escaped_machine="$(xml_escape "$machine_id")"
  escaped_orbstack_home="$(xml_escape "$ORBSTACK_HOME")"
  escaped_digest="$(xml_escape "$RUNNER_DIGEST")"
  escaped_bind_host="$(xml_escape "$WORKER_BIND_HOST")"
  escaped_brain_health="$(xml_escape "$BRAIN_HEALTH_URL")"
  escaped_node="$(xml_escape "$NODE_EXECUTABLE")"
  escaped_worker="$(xml_escape "$WORKER_SCRIPT")"
  escaped_marker="$(xml_escape "$DRAIN_MARKER")"
  escaped_root="$(xml_escape "$WORKTREE_ROOT")"
  escaped_token_file="$(xml_escape "$WORKER_TOKEN_FILE")"
  escaped_data_root="$(xml_escape "$FLEET_DATA_ROOT")"
  escaped_stdout="$(xml_escape "$LOG_DIR/fleet-worker.stdout.log")"
  escaped_stderr="$(xml_escape "$LOG_DIR/fleet-worker.stderr.log")"

  (
    trap 'rm -f "$temporary"' EXIT
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line//@@MACHINE_ID@@/$escaped_machine}"
      line="${line//@@ORBSTACK_HOME@@/$escaped_orbstack_home}"
      line="${line//@@RUNNER_DIGEST@@/$escaped_digest}"
      line="${line//@@WORKER_BIND_HOST@@/$escaped_bind_host}"
      line="${line//@@BRAIN_HEALTH_URL@@/$escaped_brain_health}"
      line="${line//@@NODE_EXECUTABLE@@/$escaped_node}"
      line="${line//@@WORKER_SCRIPT@@/$escaped_worker}"
      line="${line//@@DRAIN_MARKER@@/$escaped_marker}"
      line="${line//@@REPO_ROOT@@/$escaped_root}"
      line="${line//@@WORKER_TOKEN_FILE@@/$escaped_token_file}"
      line="${line//@@FLEET_DATA_ROOT@@/$escaped_data_root}"
      line="${line//@@STDOUT_LOG@@/$escaped_stdout}"
      line="${line//@@STDERR_LOG@@/$escaped_stderr}"
      printf '%s\n' "$line"
    done < "$TEMPLATE" > "$temporary"

    chmod 0644 "$temporary"
    "$MOVE" "$temporary" "$target"
  )
}

render_access_plist() {
  local target="$1"
  local target_dir temporary line
  local escaped_helper escaped_socket escaped_stdout escaped_stderr

  [[ -f "$ACCESS_TEMPLATE" ]] || die "access_plist_template_missing"
  target_dir="$(dirname "$target")"
  [[ -d "$target_dir" ]] || die "render_target_parent_missing"
  temporary="$(mktemp "$target_dir/.fleet-worker-access.plist.XXXXXX")"
  escaped_helper="$(xml_escape "$ACCESS_HELPER")"
  escaped_socket="$(xml_escape "$DOCKER_SOCKET_TARGET")"
  escaped_stdout="$(xml_escape "$LOG_DIR/fleet-worker-docker-access.stdout.log")"
  escaped_stderr="$(xml_escape "$LOG_DIR/fleet-worker-docker-access.stderr.log")"

  (
    trap 'rm -f "$temporary"' EXIT
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line//@@ACCESS_HELPER@@/$escaped_helper}"
      line="${line//@@DOCKER_SOCKET_TARGET@@/$escaped_socket}"
      line="${line//@@ACCESS_STDOUT_LOG@@/$escaped_stdout}"
      line="${line//@@ACCESS_STDERR_LOG@@/$escaped_stderr}"
      printf '%s\n' "$line"
    done < "$ACCESS_TEMPLATE" > "$temporary"
    chmod 0644 "$temporary"
    "$MOVE" "$temporary" "$target"
  )
}

cleanup_transaction() {
  [[ -z "$STAGED_WORKER" ]] || rm -f "$STAGED_WORKER"
  [[ -z "$STAGED_PROBE" ]] || rm -f "$STAGED_PROBE"
  [[ -z "$STAGED_WORKSPACE_MANAGER" ]] || rm -f "$STAGED_WORKSPACE_MANAGER"
  [[ -z "$STAGED_ATTEMPT_RUNNER" ]] || rm -f "$STAGED_ATTEMPT_RUNNER"
  [[ -z "$STAGED_CREDENTIAL_ENVELOPE" ]] || rm -f "$STAGED_CREDENTIAL_ENVELOPE"
  [[ -z "$STAGED_GITHUB_CREDENTIAL_ENVELOPE" ]] \
    || rm -f "$STAGED_GITHUB_CREDENTIAL_ENVELOPE"
  [[ -z "$STAGED_PLIST" ]] || rm -f "$STAGED_PLIST"
  [[ -z "$STAGED_ACCESS_HELPER" ]] || rm -f "$STAGED_ACCESS_HELPER"
  [[ -z "$STAGED_ACCESS_PLIST" ]] || rm -f "$STAGED_ACCESS_PLIST"
  if [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    rm -f \
      "$BACKUP_DIR/worker" \
      "$BACKUP_DIR/probe" \
      "$BACKUP_DIR/workspace-manager" \
      "$BACKUP_DIR/attempt-runner" \
      "$BACKUP_DIR/credential-envelope" \
      "$BACKUP_DIR/github-credential-envelope" \
      "$BACKUP_DIR/plist" \
      "$BACKUP_DIR/access-helper" \
      "$BACKUP_DIR/access-plist"
    rmdir "$BACKUP_DIR" 2>/dev/null || true
  fi
  [[ -z "$LOCK_DIR" ]] || rmdir "$LOCK_DIR" 2>/dev/null || true
  rollback_new_orbstack_socket_acl || true
  rollback_new_orbstack_run_acl || true
  rollback_new_orbstack_dir_acl || true
  rollback_new_orbstack_acl || true
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
  STAGED_WORKSPACE_MANAGER="$(
    mktemp "$RUNTIME_DIR/.workspace-manager.cjs.XXXXXX"
  )"
  STAGED_ATTEMPT_RUNNER="$(mktemp "$RUNTIME_DIR/.attempt-runner.cjs.XXXXXX")"
  STAGED_CREDENTIAL_ENVELOPE="$(
    mktemp "$RUNTIME_DIR/.credential-envelope.cjs.XXXXXX"
  )"
  STAGED_GITHUB_CREDENTIAL_ENVELOPE="$(
    mktemp "$RUNTIME_DIR/.github-credential-envelope.cjs.XXXXXX"
  )"
  STAGED_PLIST="$(mktemp "$INSTALL_DIR/.fleet-worker.plist.XXXXXX")"
  STAGED_ACCESS_HELPER="$(mktemp "$RUNTIME_DIR/.docker-access.sh.XXXXXX")"
  STAGED_ACCESS_PLIST="$(
    mktemp "$INSTALL_DIR/.fleet-worker-docker-access.plist.XXXXXX"
  )"
}

stage_generation() {
  cp "$WORKER_SOURCE" "$STAGED_WORKER"
  cp "$PROBE_SOURCE" "$STAGED_PROBE"
  cp "$WORKSPACE_MANAGER_SOURCE" "$STAGED_WORKSPACE_MANAGER"
  cp "$ATTEMPT_RUNNER_SOURCE" "$STAGED_ATTEMPT_RUNNER"
  cp "$CREDENTIAL_ENVELOPE_SOURCE" "$STAGED_CREDENTIAL_ENVELOPE"
  cp "$GITHUB_CREDENTIAL_ENVELOPE_SOURCE" "$STAGED_GITHUB_CREDENTIAL_ENVELOPE"
  cp "$ACCESS_HELPER_SOURCE" "$STAGED_ACCESS_HELPER"
  chmod 0755 "$STAGED_WORKER"
  chmod 0644 "$STAGED_PROBE"
  chmod 0644 \
    "$STAGED_WORKSPACE_MANAGER" \
    "$STAGED_ATTEMPT_RUNNER" \
    "$STAGED_CREDENTIAL_ENVELOPE" \
    "$STAGED_GITHUB_CREDENTIAL_ENVELOPE"
  chmod 0755 "$STAGED_ACCESS_HELPER"
  render_plist "$STAGED_PLIST"
  render_access_plist "$STAGED_ACCESS_PLIST"
  "$PLUTIL" -lint "$STAGED_PLIST" >/dev/null 2>&1 \
    || die "plist_validation_failed"
  "$PLUTIL" -lint "$STAGED_ACCESS_PLIST" >/dev/null 2>&1 \
    || die "access_plist_validation_failed"
}

file_mode() {
  case "$(uname -s)" in
    Darwin) stat -f '%Lp' "$1" ;;
    Linux) stat -c '%a' "$1" ;;
    *) return 1 ;;
  esac
}

validate_worker_token_file() {
  local mode
  [[ -f "$WORKER_TOKEN_FILE" && ! -L "$WORKER_TOKEN_FILE" ]] \
    || die "worker_token_file_missing"
  mode="$(file_mode "$WORKER_TOKEN_FILE")" || die "worker_token_file_invalid"
  case "$mode" in
    400|600) ;;
    *) die "worker_token_file_permissions" ;;
  esac
  [[ "$(tr -d '\r\n' < "$WORKER_TOKEN_FILE" | wc -c | tr -d ' ')" -ge 32 ]] \
    || die "worker_token_file_invalid"
}

validate_worker_data_root_path() {
  local managed_parent="$SYSTEM_ROOT/var/lib/cecelia"
  local remaining
  local component
  local candidate
  case "$FLEET_DATA_ROOT" in
    "$managed_parent"/*) ;;
    *) die "worker_data_root_invalid" ;;
  esac
  [[ "$FLEET_DATA_ROOT" != "$managed_parent/" ]] \
    || die "worker_data_root_invalid"
  case "$FLEET_DATA_ROOT" in
    *'//'*) die "worker_data_root_invalid" ;;
    *'/./'*|*'/../'*|*'/.'|*'/..') die "worker_data_root_invalid" ;;
    */) die "worker_data_root_invalid" ;;
  esac
  [[ ! -L "$managed_parent" ]] || die "worker_data_root_invalid"
  remaining="${FLEET_DATA_ROOT#"$managed_parent"/}"
  candidate="$managed_parent"
  while [[ -n "$remaining" ]]; do
    component="${remaining%%/*}"
    candidate="$candidate/$component"
    [[ ! -L "$candidate" ]] || die "worker_data_root_invalid"
    if [[ "$remaining" == */* ]]; then
      remaining="${remaining#*/}"
    else
      remaining=''
    fi
  done
}

prepare_worker_data_root() {
  local data_parent
  validate_worker_data_root_path
  data_parent="$(dirname "$FLEET_DATA_ROOT")"
  [[ ! -L "$data_parent" && ! -L "$FLEET_DATA_ROOT" ]] \
    || die "worker_data_root_invalid"
  mkdir -p "$data_parent" "$FLEET_DATA_ROOT"
  [[ -d "$FLEET_DATA_ROOT" ]] || die "worker_data_root_invalid"
  "$CHMOD" 0700 "$FLEET_DATA_ROOT"
  "$CHOWN" _cecelia:_cecelia "$FLEET_DATA_ROOT"
  "$CHOWN" _cecelia:_cecelia "$WORKER_TOKEN_FILE"
}

prepare_shared_tmpdir() {
  local shared_parent="$SYSTEM_ROOT/Users/Shared"

  [[ "$SHARED_TMPDIR" == "$shared_parent/cecelia-fleet-tmp" ]] \
    || die "shared_tmpdir_invalid"
  [[ ! -L "$shared_parent" && ! -L "$SHARED_TMPDIR" ]] \
    || die "shared_tmpdir_invalid"
  mkdir -p "$shared_parent" "$SHARED_TMPDIR"
  [[ -d "$SHARED_TMPDIR" && ! -L "$SHARED_TMPDIR" ]] \
    || die "shared_tmpdir_invalid"
  "$CHMOD" 0755 "$SHARED_TMPDIR"
  "$CHOWN" _cecelia:_cecelia "$SHARED_TMPDIR"
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
  "$MOVE" "$temporary" "$target"
}

prepare_logs() {
  local stdout_log="$LOG_DIR/fleet-worker.stdout.log"
  local stderr_log="$LOG_DIR/fleet-worker.stderr.log"
  local access_stdout_log="$LOG_DIR/fleet-worker-docker-access.stdout.log"
  local access_stderr_log="$LOG_DIR/fleet-worker-docker-access.stderr.log"

  [[ ! -L "$LOG_DIR" ]] || die "log_path_invalid"
  mkdir -p "$LOG_DIR"
  chmod 0755 "$LOG_DIR"
  [[ ! -L "$stdout_log" && ! -L "$stderr_log" \
    && ! -L "$access_stdout_log" && ! -L "$access_stderr_log" ]] \
    || die "log_path_invalid"
  [[ ! -e "$stdout_log" || -f "$stdout_log" ]] || die "log_path_invalid"
  [[ ! -e "$stderr_log" || -f "$stderr_log" ]] || die "log_path_invalid"
  [[ ! -e "$access_stdout_log" || -f "$access_stdout_log" ]] \
    || die "log_path_invalid"
  [[ ! -e "$access_stderr_log" || -f "$access_stderr_log" ]] \
    || die "log_path_invalid"
  touch "$stdout_log" "$stderr_log" "$access_stdout_log" "$access_stderr_log"
  chmod 0640 \
    "$stdout_log" \
    "$stderr_log" \
    "$access_stdout_log" \
    "$access_stderr_log"
  if [[ "$(/usr/bin/id -u)" == '0' ]]; then
    "$CHOWN" _cecelia "$stdout_log" "$stderr_log"
    "$CHOWN" root:wheel "$access_stdout_log" "$access_stderr_log"
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
if ! WORKER_BIND_HOST="$(load_worker_bind_host)"; then
  die "node_profile_unavailable"
fi
if ! BRAIN_HEALTH_URL="$(load_brain_health_url)"; then
  die "node_profile_unavailable"
fi

if [[ "$mode" == 'apply' && "$("$ID_COMMAND" -u)" != '0' ]]; then
  die "root_required" 77
fi

validate_worker_data_root_path
if [[ "$mode" == 'apply' ]]; then
  prepare_orbstack_access
fi
run_preflight_with_retry
validate_worker_token_file
if [[ "$mode" == 'apply' ]]; then
  prepare_worker_data_root
  prepare_shared_tmpdir
fi

if [[ "$mode" == 'render' ]]; then
  render_plist "$render_target"
  echo "rendered: $render_target"
  exit 0
fi

installed_plist="$INSTALL_DIR/$LABEL.plist"
installed_access_plist="$INSTALL_DIR/$ACCESS_LABEL.plist"
[[ ! -L "$INSTALL_DIR" && ! -L "$installed_plist" \
  && ! -L "$installed_access_plist" ]] || die "install_path_invalid"
prior_files_complete=false
if [[ -f "$installed_plist" && ! -L "$installed_plist" \
    && -f "$WORKER_SCRIPT" && ! -L "$WORKER_SCRIPT" \
    && -f "$RUNTIME_DIR/node-probe.cjs" \
    && ! -L "$RUNTIME_DIR/node-probe.cjs" \
    && -f "$CREDENTIAL_ENVELOPE_SCRIPT" \
    && ! -L "$CREDENTIAL_ENVELOPE_SCRIPT" \
    && -f "$GITHUB_CREDENTIAL_ENVELOPE_SCRIPT" \
    && ! -L "$GITHUB_CREDENTIAL_ENVELOPE_SCRIPT" ]]; then
  prior_files_complete=true
fi
prior_access_files_complete=false
if [[ -f "$installed_access_plist" && ! -L "$installed_access_plist" \
  && -f "$ACCESS_HELPER" && ! -L "$ACCESS_HELPER" ]]; then
  prior_access_files_complete=true
fi
prior_service_loaded=false
if "$LAUNCHCTL" print "system/$LABEL" >/dev/null 2>&1; then
  prior_service_loaded=true
fi
prior_access_service_loaded=false
if "$LAUNCHCTL" print "system/$ACCESS_LABEL" >/dev/null 2>&1; then
  prior_access_service_loaded=true
fi
if [[ "$prior_service_loaded" == true && "$prior_files_complete" != true ]]; then
  die "prior_service_state_invalid"
fi
if [[ "$prior_access_service_loaded" == true \
  && "$prior_access_files_complete" != true ]]; then
  die "prior_access_service_state_invalid"
fi

mkdir -p "$INSTALL_DIR"
prepare_logs
prepare_transaction_paths
stage_generation

prior_worker_mode="$(snapshot_file "$WORKER_SCRIPT" "$BACKUP_DIR/worker")"
prior_probe_mode="$(
  snapshot_file "$RUNTIME_DIR/node-probe.cjs" "$BACKUP_DIR/probe"
)"
prior_workspace_manager_mode="$(
  snapshot_file "$WORKSPACE_MANAGER_SCRIPT" "$BACKUP_DIR/workspace-manager"
)"
prior_attempt_runner_mode="$(
  snapshot_file "$ATTEMPT_RUNNER_SCRIPT" "$BACKUP_DIR/attempt-runner"
)"
prior_credential_envelope_mode="$(
  snapshot_file "$CREDENTIAL_ENVELOPE_SCRIPT" "$BACKUP_DIR/credential-envelope"
)"
prior_github_credential_envelope_mode="$(
  snapshot_file \
    "$GITHUB_CREDENTIAL_ENVELOPE_SCRIPT" \
    "$BACKUP_DIR/github-credential-envelope"
)"
prior_plist_mode="$(snapshot_file "$installed_plist" "$BACKUP_DIR/plist")"
prior_access_helper_mode="$(
  snapshot_file "$ACCESS_HELPER" "$BACKUP_DIR/access-helper"
)"
prior_access_plist_mode="$(
  snapshot_file "$installed_access_plist" "$BACKUP_DIR/access-plist"
)"

if [[ "$prior_access_service_loaded" == true ]]; then
  "$LAUNCHCTL" bootout "system/$ACCESS_LABEL" >/dev/null 2>&1 || true
fi
if [[ "$prior_service_loaded" == true ]]; then
  "$LAUNCHCTL" bootout "system/$LABEL" >/dev/null 2>&1 || true
fi

placement_ok=true
"$MOVE" "$STAGED_PROBE" "$RUNTIME_DIR/node-probe.cjs" || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_WORKSPACE_MANAGER" "$WORKSPACE_MANAGER_SCRIPT" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_ATTEMPT_RUNNER" "$ATTEMPT_RUNNER_SCRIPT" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_CREDENTIAL_ENVELOPE" "$CREDENTIAL_ENVELOPE_SCRIPT" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" \
    "$STAGED_GITHUB_CREDENTIAL_ENVELOPE" \
    "$GITHUB_CREDENTIAL_ENVELOPE_SCRIPT" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_WORKER" "$WORKER_SCRIPT" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_ACCESS_HELPER" "$ACCESS_HELPER" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_ACCESS_PLIST" "$installed_access_plist" \
  || placement_ok=false
[[ "$placement_ok" == false ]] \
  || "$MOVE" "$STAGED_PLIST" "$installed_plist" \
  || placement_ok=false

launch_ok="$placement_ok"
if [[ "$launch_ok" == true ]]; then
  "$LAUNCHCTL" bootstrap system "$installed_access_plist" >/dev/null 2>&1 \
    || launch_ok=false
fi
if [[ "$launch_ok" == true ]]; then
  "$LAUNCHCTL" kickstart -k "system/$ACCESS_LABEL" >/dev/null 2>&1 \
    || launch_ok=false
fi
if [[ "$launch_ok" == true ]]; then
  "$LAUNCHCTL" bootstrap system "$installed_plist" >/dev/null 2>&1 \
    || launch_ok=false
fi
if [[ "$launch_ok" == true ]]; then
  "$LAUNCHCTL" kickstart -k "system/$LABEL" >/dev/null 2>&1 \
    || launch_ok=false
fi
if [[ "$launch_ok" == true ]]; then
  verify_started_generation || launch_ok=false
fi

if [[ "$launch_ok" != true ]]; then
  "$LAUNCHCTL" bootout "system/$ACCESS_LABEL" >/dev/null 2>&1 || true
  "$LAUNCHCTL" bootout "system/$LABEL" >/dev/null 2>&1 || true
  rollback_ok=true
  restore_file "$WORKER_SCRIPT" "$BACKUP_DIR/worker" "$prior_worker_mode" \
    || rollback_ok=false
  restore_file "$RUNTIME_DIR/node-probe.cjs" "$BACKUP_DIR/probe" "$prior_probe_mode" \
    || rollback_ok=false
  restore_file \
    "$WORKSPACE_MANAGER_SCRIPT" \
    "$BACKUP_DIR/workspace-manager" \
    "$prior_workspace_manager_mode" \
    || rollback_ok=false
  restore_file \
    "$ATTEMPT_RUNNER_SCRIPT" \
    "$BACKUP_DIR/attempt-runner" \
    "$prior_attempt_runner_mode" \
    || rollback_ok=false
  restore_file \
    "$CREDENTIAL_ENVELOPE_SCRIPT" \
    "$BACKUP_DIR/credential-envelope" \
    "$prior_credential_envelope_mode" \
    || rollback_ok=false
  restore_file \
    "$GITHUB_CREDENTIAL_ENVELOPE_SCRIPT" \
    "$BACKUP_DIR/github-credential-envelope" \
    "$prior_github_credential_envelope_mode" \
    || rollback_ok=false
  restore_file "$installed_plist" "$BACKUP_DIR/plist" "$prior_plist_mode" \
    || rollback_ok=false
  restore_file \
    "$ACCESS_HELPER" \
    "$BACKUP_DIR/access-helper" \
    "$prior_access_helper_mode" \
    || rollback_ok=false
  restore_file \
    "$installed_access_plist" \
    "$BACKUP_DIR/access-plist" \
    "$prior_access_plist_mode" \
    || rollback_ok=false
  if [[ "$prior_access_service_loaded" == true ]]; then
    "$LAUNCHCTL" bootstrap system "$installed_access_plist" >/dev/null 2>&1 \
      || rollback_ok=false
    "$LAUNCHCTL" kickstart -k "system/$ACCESS_LABEL" >/dev/null 2>&1 \
      || rollback_ok=false
  fi
  if [[ "$prior_service_loaded" == true ]]; then
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

INSTALL_SUCCEEDED=true
echo "installed: system/$LABEL for $machine_id"
