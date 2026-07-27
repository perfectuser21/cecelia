#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

NODE_VERSION='25.8.0'
NODE_URL='https://nodejs.org/dist/v25.8.0/node-v25.8.0-darwin-arm64.tar.gz'
NODE_SHA256='75ff6fd07e0a85fb4d2529f6189c996014b1d3d83180c31e65feb2b3eaeec5d9'
CODEX_VERSION='0.145.0'
ORBSTACK_VERSION='2.2.1'
ORBSTACK_URL='https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.1_20628_arm64.dmg'
ORBSTACK_SHA256='5bc1719c3c987c4c60c65be9fdd65b4730990e1697ec1cb1c33e6bba31bf92b5'
MACOS_VERSION='15.7.4'
RUNNER_DIGEST='sha256:72afb77061714668276d4b47bce4554544afc0b862364ab2c646d28b785a3f36'
SERVICE_UID=450
SERVICE_GID=450

ID_COMMAND="${FLEET_BASELINE_ID:-/usr/bin/id}"
DSCL="${FLEET_BASELINE_DSCL:-/usr/bin/dscl}"
UNAME="${FLEET_BASELINE_UNAME:-/usr/bin/uname}"
SW_VERS="${FLEET_BASELINE_SW_VERS:-/usr/bin/sw_vers}"
UUIDGEN="${FLEET_BASELINE_UUIDGEN:-/usr/bin/uuidgen}"
CURL="${FLEET_BASELINE_CURL:-/usr/bin/curl}"
SHASUM="${FLEET_BASELINE_SHASUM:-/usr/bin/shasum}"
TAR="${FLEET_BASELINE_TAR:-/usr/bin/tar}"
HDIUTIL="${FLEET_BASELINE_HDIUTIL:-/usr/bin/hdiutil}"
DITTO="${FLEET_BASELINE_DITTO:-/usr/bin/ditto}"
CODESIGN="${FLEET_BASELINE_CODESIGN:-/usr/bin/codesign}"
DOCKER="${FLEET_BASELINE_DOCKER-$(command -v docker || true)}"
GIT="${FLEET_BASELINE_GIT:-$(command -v git || true)}"
CHOWN="${FLEET_BASELINE_CHOWN:-/usr/sbin/chown}"
INSTALLER="${FLEET_BASELINE_INSTALLER:-$SCRIPT_DIR/install-fleet-worker.sh}"

SYSTEM_ROOT="${FLEET_BASELINE_SYSTEM_ROOT:-}"
APPLICATIONS_DIR="${FLEET_BASELINE_APPLICATIONS_DIR:-$SYSTEM_ROOT/Applications}"
TOOLCHAIN_ROOT="${FLEET_BASELINE_TOOLCHAIN_ROOT:-$SYSTEM_ROOT/usr/local/libexec/cecelia/toolchain}"
TOOLCHAIN_BIN="$TOOLCHAIN_ROOT/bin"
REPOSITORY_ROOT="${FLEET_BASELINE_REPOSITORY_ROOT:-$SYSTEM_ROOT/var/lib/cecelia/repository}"
BASELINE_TMPDIR="${FLEET_BASELINE_TMPDIR:-${TMPDIR:-/tmp}}"
REPOSITORY_BUNDLE="${FLEET_BASELINE_REPOSITORY_BUNDLE:-}"
RUNNER_ARCHIVE="${FLEET_BASELINE_RUNNER_ARCHIVE:-}"

TEMP_ROOT=''
ORBSTACK_MOUNTED=false
ORBSTACK_MOUNTPOINT=''
ORBSTACK_BACKUP=''
ORBSTACK_REPLACED=false
ORBSTACK_INSTALL_SUCCEEDED=false

usage() {
  echo "usage: $0 <us-mac-m4|xian-mac-m4|xian-mac-m1> [--apply]" >&2
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

verify_regular_input() {
  local candidate="$1"
  local error_code="$2"
  [[ -n "$candidate" && -f "$candidate" && ! -L "$candidate" ]] \
    || die "$error_code"
}

cleanup() {
  local orb_app="$APPLICATIONS_DIR/OrbStack.app"

  if [[ "$ORBSTACK_MOUNTED" == true && -n "$ORBSTACK_MOUNTPOINT" ]]; then
    "$HDIUTIL" detach "$ORBSTACK_MOUNTPOINT" >/dev/null 2>&1 || true
    ORBSTACK_MOUNTED=false
  fi
  if [[ "$ORBSTACK_REPLACED" == true && "$ORBSTACK_INSTALL_SUCCEEDED" != true ]]; then
    /bin/rm -rf -- "$orb_app"
    if [[ -n "$ORBSTACK_BACKUP" && -d "$ORBSTACK_BACKUP" ]]; then
      /bin/mv "$ORBSTACK_BACKUP" "$orb_app" || true
    fi
  fi
  if [[ -n "$TEMP_ROOT" && -d "$TEMP_ROOT" ]]; then
    /bin/rm -rf -- "$TEMP_ROOT"
  fi
}

version_compare() {
  local left="$1"
  local right="$2"
  local left_major left_minor left_patch right_major right_minor right_patch

  IFS=. read -r left_major left_minor left_patch <<<"$left"
  IFS=. read -r right_major right_minor right_patch <<<"$right"
  for value in \
    "$left_major" "$left_minor" "$left_patch" \
    "$right_major" "$right_minor" "$right_patch"; do
    [[ "$value" =~ ^[0-9]+$ ]] || return 2
  done

  if (( 10#$left_major != 10#$right_major )); then
    (( 10#$left_major > 10#$right_major )) && echo 1 || echo -1
  elif (( 10#$left_minor != 10#$right_minor )); then
    (( 10#$left_minor > 10#$right_minor )) && echo 1 || echo -1
  elif (( 10#$left_patch != 10#$right_patch )); then
    (( 10#$left_patch > 10#$right_patch )) && echo 1 || echo -1
  else
    echo 0
  fi
}

read_orbstack_version() {
  local orbctl="$APPLICATIONS_DIR/OrbStack.app/Contents/MacOS/bin/orbctl"
  local output

  [[ -x "$orbctl" ]] || return 1
  output="$("$orbctl" version 2>/dev/null)" || return 1
  sed -E \
    -e 's/^Version:[[:space:]]*//' \
    -e 's/^OrbStack[[:space:]]*//' \
    -e 's/[[:space:]].*$//' \
    <<<"$output" \
    | head -n 1
}

resolve_docker_command() {
  local app_docker="$APPLICATIONS_DIR/OrbStack.app/Contents/MacOS/xbin/docker"
  local path_docker

  if [[ -n "$DOCKER" && -x "$DOCKER" ]]; then
    return
  fi
  if [[ -x "$app_docker" ]]; then
    DOCKER="$app_docker"
    return
  fi
  path_docker="$(command -v docker || true)"
  [[ -n "$path_docker" && -x "$path_docker" ]] || die "docker_command_unavailable"
  DOCKER="$path_docker"
}

verify_sha256() {
  local target="$1"
  local expected="$2"
  local actual

  actual="$("$SHASUM" -a 256 "$target" | awk '{print $1}')" \
    || die "artifact_checksum_unavailable"
  [[ "$actual" == "$expected" ]] || die "artifact_checksum_mismatch"
}

ensure_service_identity() {
  local user_match group_match generated_uuid

  if "$ID_COMMAND" -u _cecelia >/dev/null 2>&1; then
    [[ "$("$ID_COMMAND" -u _cecelia)" == "$SERVICE_UID" \
      && "$("$ID_COMMAND" -g _cecelia)" == "$SERVICE_GID" ]] \
      || die "service_identity_collision"
    return
  fi

  user_match="$("$DSCL" . -search /Users UniqueID "$SERVICE_UID" 2>/dev/null || true)"
  group_match="$(
    "$DSCL" . -search /Groups PrimaryGroupID "$SERVICE_GID" 2>/dev/null || true
  )"
  [[ -z "$user_match" && -z "$group_match" ]] || die "service_identity_collision"

  generated_uuid="$("$UUIDGEN")" || die "service_identity_create_failed"
  "$DSCL" . -create /Groups/_cecelia
  "$DSCL" . -create /Groups/_cecelia PrimaryGroupID "$SERVICE_GID"
  "$DSCL" . -create /Groups/_cecelia Password '*'
  "$DSCL" . -create /Groups/_cecelia RealName 'Cecelia Fleet Worker'
  "$DSCL" . -create /Groups/_cecelia GeneratedUID "$generated_uuid"
  "$DSCL" . -create /Users/_cecelia
  "$DSCL" . -create /Users/_cecelia UniqueID "$SERVICE_UID"
  "$DSCL" . -create /Users/_cecelia PrimaryGroupID "$SERVICE_GID"
  "$DSCL" . -create /Users/_cecelia NFSHomeDirectory /var/empty
  "$DSCL" . -create /Users/_cecelia UserShell /usr/bin/false
  "$DSCL" . -create /Users/_cecelia Password '*'
  "$DSCL" . -create /Users/_cecelia IsHidden 1
  "$DSCL" . -create /Users/_cecelia RealName 'Cecelia Fleet Worker'
  "$DSCL" . -create /Users/_cecelia GeneratedUID "$generated_uuid"

  [[ "$("$ID_COMMAND" -u _cecelia)" == "$SERVICE_UID" \
    && "$("$ID_COMMAND" -g _cecelia)" == "$SERVICE_GID" ]] \
    || die "service_identity_create_failed"
}

ensure_node_toolchain() {
  local node_target="$TOOLCHAIN_ROOT/node-v$NODE_VERSION"
  local node_bin="$node_target/bin/node"
  local npm_bin="$node_target/bin/npm"
  local node_archive="$TEMP_ROOT/node-v$NODE_VERSION-darwin-arm64.tar.gz"
  local extract_root="$TEMP_ROOT/node-extract"
  local extracted="$extract_root/node-v$NODE_VERSION-darwin-arm64"
  local installed_version=''

  if [[ -x "$node_bin" ]]; then
    installed_version="$("$node_bin" --version 2>/dev/null || true)"
  fi
  if [[ "$installed_version" != "v$NODE_VERSION" ]]; then
    [[ ! -e "$node_target" && ! -L "$node_target" ]] || die "node_install_conflict"
    "$CURL" -fL --retry 3 --connect-timeout 15 -o "$node_archive" "$NODE_URL"
    verify_sha256 "$node_archive" "$NODE_SHA256"
    /bin/mkdir -p "$extract_root" "$TOOLCHAIN_ROOT"
    "$TAR" -xzf "$node_archive" -C "$extract_root"
    [[ -x "$extracted/bin/node" && -x "$extracted/bin/npm" ]] \
      || die "node_artifact_invalid"
    /bin/mv "$extracted" "$node_target"
    [[ "$("$node_bin" --version 2>/dev/null)" == "v$NODE_VERSION" ]] \
      || die "node_version_mismatch"
  fi

  /bin/mkdir -p "$TOOLCHAIN_BIN"
  /bin/ln -sfn "$node_bin" "$TOOLCHAIN_BIN/node"
  /bin/ln -sfn "$npm_bin" "$TOOLCHAIN_BIN/npm"
}

ensure_codex_toolchain() {
  local node_target="$TOOLCHAIN_ROOT/node-v$NODE_VERSION"
  local codex_prefix="$TOOLCHAIN_ROOT/codex-$CODEX_VERSION"
  local codex_bin="$codex_prefix/bin/codex"
  local installed_version=''

  if [[ -x "$codex_bin" ]]; then
    installed_version="$("$codex_bin" --version 2>/dev/null || true)"
  fi
  if [[ "$installed_version" != "codex-cli $CODEX_VERSION" ]]; then
    [[ ! -e "$codex_prefix" && ! -L "$codex_prefix" ]] \
      || die "codex_install_conflict"
    "$node_target/bin/npm" install --global --prefix "$codex_prefix" \
      "@openai/codex@$CODEX_VERSION"
    [[ -x "$codex_bin" \
      && "$("$codex_bin" --version 2>/dev/null)" == "codex-cli $CODEX_VERSION" ]] \
      || die "codex_version_mismatch"
  fi
  /bin/ln -sfn "$codex_bin" "$TOOLCHAIN_BIN/codex"
}

ensure_orbstack() {
  local current_version comparison
  local orb_app="$APPLICATIONS_DIR/OrbStack.app"
  local orb_dmg="$TEMP_ROOT/OrbStack-v$ORBSTACK_VERSION.dmg"
  local stage_app="$APPLICATIONS_DIR/.OrbStack.app.stage.$$"
  local source_app

  current_version="$(read_orbstack_version || true)"
  if [[ -n "$current_version" ]]; then
    comparison="$(version_compare "$current_version" "$ORBSTACK_VERSION")" \
      || die "orbstack_version_invalid"
    if [[ "$comparison" == '1' ]]; then
      die "orbstack_newer_than_baseline"
    fi
    if [[ "$comparison" == '0' ]]; then
      "$orb_app/Contents/MacOS/bin/orb" start >/dev/null 2>&1 || die "orbstack_start_failed"
      resolve_docker_command
      "$DOCKER" info --format '{{json .ServerVersion}}' >/dev/null 2>&1 \
        || die "docker_unavailable"
      return
    fi
  fi

  "$CURL" -fL --retry 3 --connect-timeout 15 -o "$orb_dmg" "$ORBSTACK_URL"
  verify_sha256 "$orb_dmg" "$ORBSTACK_SHA256"
  ORBSTACK_MOUNTPOINT="$TEMP_ROOT/orbstack-mount"
  /bin/mkdir -p "$ORBSTACK_MOUNTPOINT" "$APPLICATIONS_DIR"
  "$HDIUTIL" attach "$orb_dmg" -nobrowse -readonly \
    -mountpoint "$ORBSTACK_MOUNTPOINT" >/dev/null
  ORBSTACK_MOUNTED=true
  source_app="$ORBSTACK_MOUNTPOINT/OrbStack.app"
  [[ -d "$source_app" && ! -L "$source_app" ]] || die "orbstack_artifact_invalid"
  "$CODESIGN" --verify --deep --strict "$source_app" >/dev/null 2>&1 \
    || die "orbstack_signature_invalid"
  [[ ! -e "$stage_app" && ! -L "$stage_app" ]] || die "orbstack_stage_conflict"
  "$DITTO" "$source_app" "$stage_app"

  if [[ -d "$orb_app" && ! -L "$orb_app" ]]; then
    "$orb_app/Contents/MacOS/bin/orb" stop >/dev/null 2>&1 || true
    ORBSTACK_BACKUP="$TEMP_ROOT/OrbStack.previous.app"
    /bin/mv "$orb_app" "$ORBSTACK_BACKUP"
  elif [[ -e "$orb_app" || -L "$orb_app" ]]; then
    die "orbstack_install_path_invalid"
  fi
  /bin/mv "$stage_app" "$orb_app"
  ORBSTACK_REPLACED=true
  "$orb_app/Contents/MacOS/bin/orb" start >/dev/null 2>&1 \
    || die "orbstack_start_failed"
  [[ "$(read_orbstack_version)" == "$ORBSTACK_VERSION" ]] \
    || die "orbstack_version_mismatch"
  resolve_docker_command
  "$DOCKER" info --format '{{json .ServerVersion}}' >/dev/null 2>&1 \
    || die "docker_unavailable"
  ORBSTACK_INSTALL_SUCCEEDED=true
}

ensure_repository() {
  local repository_parent

  repository_parent="$(dirname "$REPOSITORY_ROOT")"
  [[ ! -L "$repository_parent" && ! -L "$REPOSITORY_ROOT" ]] \
    || die "repository_path_invalid"
  /bin/mkdir -p "$repository_parent"
  if [[ ! -e "$REPOSITORY_ROOT" ]]; then
    "$GIT" init --bare "$REPOSITORY_ROOT" >/dev/null
  fi
  [[ -d "$REPOSITORY_ROOT" \
    && "$("$GIT" -C "$REPOSITORY_ROOT" rev-parse --is-bare-repository)" == true ]] \
    || die "repository_path_invalid"
  "$GIT" -C "$REPOSITORY_ROOT" fetch --force "$REPOSITORY_BUNDLE" \
    HEAD:refs/heads/fleet-baseline >/dev/null
  "$GIT" -C "$REPOSITORY_ROOT" symbolic-ref HEAD refs/heads/fleet-baseline
  "$GIT" -C "$REPOSITORY_ROOT" rev-parse --verify HEAD >/dev/null \
    || die "repository_import_failed"
  "$CHOWN" -R _cecelia:_cecelia "$REPOSITORY_ROOT"
}

ensure_runner() {
  resolve_docker_command
  if ! "$DOCKER" image inspect "$RUNNER_DIGEST" >/dev/null 2>&1; then
    "$DOCKER" load --input "$RUNNER_ARCHIVE" >/dev/null
  fi
  "$DOCKER" image inspect "$RUNNER_DIGEST" >/dev/null 2>&1 \
    || die "runner_digest_unavailable"
}

[[ $# -ge 1 && $# -le 2 ]] || { usage; exit 64; }
machine_id="$1"
shift
require_machine "$machine_id"

mode='dry-run'
if [[ $# -gt 0 ]]; then
  [[ $# -eq 1 && "$1" == '--apply' ]] || { usage; exit 64; }
  mode='apply'
fi

if [[ "$mode" == 'dry-run' ]]; then
  echo "dry-run: would reconcile $machine_id with macOS $MACOS_VERSION, OrbStack $ORBSTACK_VERSION, Node $NODE_VERSION, Codex $CODEX_VERSION, and Runner $RUNNER_DIGEST"
  exit 0
fi

[[ "$("$ID_COMMAND" -u)" == '0' ]] || die "root_required" 77
[[ "$("$UNAME" -m)" == 'arm64' ]] || die "unsupported_architecture"
verify_regular_input "$REPOSITORY_BUNDLE" "repository_bundle_required"
verify_regular_input "$RUNNER_ARCHIVE" "runner_archive_required"
[[ -n "$GIT" && -x "$GIT" ]] || die "git_command_unavailable"
[[ -x "$INSTALLER" ]] || die "fleet_worker_installer_unavailable"

current_orbstack="$(read_orbstack_version || true)"
if [[ -n "$current_orbstack" \
  && "$(version_compare "$current_orbstack" "$ORBSTACK_VERSION")" == '1' ]]; then
  die "orbstack_newer_than_baseline"
fi

/bin/mkdir -p "$BASELINE_TMPDIR"
TEMP_ROOT="$(mktemp -d "$BASELINE_TMPDIR/fleet-node-baseline.XXXXXX")"
trap cleanup EXIT

ensure_service_identity
ensure_node_toolchain
ensure_codex_toolchain
ensure_orbstack
ensure_repository
ensure_runner

observed_os="$("$SW_VERS" -productVersion 2>/dev/null || true)"
if [[ "$observed_os" != "$MACOS_VERSION" ]]; then
  echo "warning: os_version_drift expected=$MACOS_VERSION observed=${observed_os:-unavailable}" >&2
fi

PATH="$TOOLCHAIN_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
FLEET_WORKER_NODE_EXECUTABLE="$TOOLCHAIN_BIN/node" \
FLEET_WORKER_REPO_ROOT="$REPOSITORY_ROOT" \
FLEET_WORKER_ID="$ID_COMMAND" \
  "$INSTALLER" "$machine_id" --apply

echo "reconciled: $machine_id"
