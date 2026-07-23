#!/usr/bin/env bash
set -euo pipefail

umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_SOURCE="$REPO_ROOT/config/codex-slot/hosts.example.json"

SSH_OPTIONS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
)
SCP_OPTIONS=(
  -o BatchMode=yes
  -o ConnectTimeout=15
)

MODE=""
TARGET_HOST=""
LOCAL_STAGE=""
LOCAL_LOCK=""
LOCAL_LOCK_OWNED=0
LOCAL_LOCK_TOKEN=""
LOCAL_LOCK_PID=""
LOCAL_LOCK_HOST=""
LOCAL_LOCK_START=""
LOCAL_LINK_STAGE=""
REMOTE_CLEANUP_HOST=""
REMOTE_CLEANUP_PATHS=()
CLIENT_TRANSACTION_ACTIVE=0
CLIENT_TRANSACTION_OK=0
CLIENT_LIB_DIR=""
CLIENT_LIB_INSTALLED=0
CLIENT_SAVED_DIR=""
CLIENT_LINK_PATH=""
CLIENT_LINK_INSTALLED=0
CLIENT_SAVED_LINK=""
CLIENT_CONFIG_PATH=""
CLIENT_CONFIG_CREATED=0
CLIENT_CONFIG_DIR=""
CLIENT_CONFIG_DIR_CREATED=0
CLIENT_CONFIG_STAGE=""
CLIENT_ZSHRC=""
CLIENT_ZSHRC_CHANGED=0
CLIENT_ZSHRC_EXISTED=0
CLIENT_SAVED_ZSHRC=""
CLIENT_ZSHRC_STAGE=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  install-codex-slot.sh --client-only
  install-codex-slot.sh --broker-host HOST
  install-codex-slot.sh --agent-host HOST
  install-codex-slot.sh --all
USAGE
}

die() {
  printf 'install-codex-slot: %s\n' "$*" >&2
  exit 1
}

validate_host() {
  local host="$1"
  case "$host" in
    ""|*[!A-Za-z0-9._-]*)
      die "unsafe host: $host"
      ;;
  esac
  case "$host" in
    [A-Za-z0-9]*)
      ;;
    *)
      die "unsafe host: $host"
      ;;
  esac
}

posix_single_quote() {
  local value="$1"
  printf "'"
  while [[ "$value" == *"'"* ]]; do
    printf '%s%s' "${value%%\'*}" "'\\''"
    value="${value#*\'}"
  done
  printf "%s'" "$value"
}

parse_args() {
  if [[ "$#" -eq 0 ]]; then
    usage
    exit 2
  fi

  case "$1" in
    --client-only)
      [[ "$#" -eq 1 ]] || die "--client-only does not accept other arguments"
      MODE="client"
      ;;
    --broker-host)
      [[ "$#" -eq 2 ]] || die "--broker-host requires exactly one HOST"
      validate_host "$2"
      MODE="broker"
      TARGET_HOST="$2"
      ;;
    --agent-host)
      [[ "$#" -eq 2 ]] || die "--agent-host requires exactly one HOST"
      validate_host "$2"
      MODE="agent"
      TARGET_HOST="$2"
      ;;
    --all)
      [[ "$#" -eq 1 ]] || die "--all does not accept other arguments"
      MODE="all"
      ;;
    *)
      usage
      die "unknown argument: $1"
      ;;
  esac
}

remove_client_lib_dir() {
  local dir="$1"
  rm -f \
    "$dir/codex-slot-client.mjs" \
    "$dir/codex-slot" 2>/dev/null || true
  rmdir "$dir" 2>/dev/null || true
}

read_owner_field() {
  local owner_file="$1"
  local field="$2"
  case "$field" in
    pid|start)
      sed -n "s/.*\"$field\":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" \
        "$owner_file" 2>/dev/null
      ;;
    host|token)
      sed -n "s/.*\"$field\":[[:space:]]*\"\\([A-Za-z0-9._-][A-Za-z0-9._-]*\\)\".*/\\1/p" \
        "$owner_file" 2>/dev/null
      ;;
  esac
}

lock_mtime() {
  stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null
}

local_hostname() {
  local value
  value="$(hostname)"
  case "$value" in
    ""|*[!A-Za-z0-9._-]*)
      die "unsafe local hostname"
      ;;
  esac
  printf '%s\n' "$value"
}

lock_owner_matches() {
  local lock="$1"
  local expected_pid="$2"
  local expected_host="$3"
  local expected_start="$4"
  local expected_token="$5"
  local owner="$lock/owner.json"
  [[ -f "$owner" ]] || return 1
  [[ "$(read_owner_field "$owner" pid)" == "$expected_pid" ]] || return 1
  [[ "$(read_owner_field "$owner" host)" == "$expected_host" ]] || return 1
  [[ "$(read_owner_field "$owner" start)" == "$expected_start" ]] || return 1
  [[ "$(read_owner_field "$owner" token)" == "$expected_token" ]]
}

release_local_lock() {
  if [[ "$LOCAL_LOCK_OWNED" -ne 1 ||
        -z "$LOCAL_LOCK" ||
        -z "$LOCAL_LOCK_TOKEN" ||
        ! -d "$LOCAL_LOCK" ]]; then
    return
  fi

  local owner="$LOCAL_LOCK/owner.json"
  if lock_owner_matches \
      "$LOCAL_LOCK" \
      "$LOCAL_LOCK_PID" \
      "$LOCAL_LOCK_HOST" \
      "$LOCAL_LOCK_START" \
      "$LOCAL_LOCK_TOKEN"; then
    rm -f "$owner" 2>/dev/null || true
    rmdir "$LOCAL_LOCK" 2>/dev/null || true
  fi
  LOCAL_LOCK_OWNED=0
}

rollback_client_transaction() {
  if [[ "$CLIENT_TRANSACTION_ACTIVE" -ne 1 ||
        "$CLIENT_TRANSACTION_OK" -eq 1 ]]; then
    return
  fi

  if [[ "$CLIENT_ZSHRC_CHANGED" -eq 1 ]]; then
    if [[ "$CLIENT_ZSHRC_EXISTED" -eq 1 && -f "$CLIENT_SAVED_ZSHRC" ]]; then
      cp -p "$CLIENT_SAVED_ZSHRC" "$CLIENT_ZSHRC" 2>/dev/null || true
    else
      rm -f "$CLIENT_ZSHRC" 2>/dev/null || true
    fi
  fi

  if [[ "$CLIENT_CONFIG_CREATED" -eq 1 ]]; then
    rm -f "$CLIENT_CONFIG_PATH" 2>/dev/null || true
  fi
  if [[ "$CLIENT_CONFIG_DIR_CREATED" -eq 1 ]]; then
    rmdir "$CLIENT_CONFIG_DIR" 2>/dev/null || true
  fi

  if [[ "$CLIENT_LINK_INSTALLED" -eq 1 ]]; then
    rm -f "$CLIENT_LINK_PATH" 2>/dev/null || true
  fi
  if [[ -n "$CLIENT_SAVED_LINK" &&
        ( -e "$CLIENT_SAVED_LINK" || -L "$CLIENT_SAVED_LINK" ) ]]; then
    mv "$CLIENT_SAVED_LINK" "$CLIENT_LINK_PATH" 2>/dev/null || true
  fi

  if [[ "$CLIENT_LIB_INSTALLED" -eq 1 ]]; then
    remove_client_lib_dir "$CLIENT_LIB_DIR"
  fi
  if [[ -n "$CLIENT_SAVED_DIR" && -e "$CLIENT_SAVED_DIR" ]]; then
    mv "$CLIENT_SAVED_DIR" "$CLIENT_LIB_DIR" 2>/dev/null || true
  fi
}

cleanup_all() {
  local remote_path

  rollback_client_transaction

  if [[ -n "$LOCAL_STAGE" && -d "$LOCAL_STAGE" ]]; then
    remove_client_lib_dir "$LOCAL_STAGE"
  fi
  if [[ -n "$LOCAL_LINK_STAGE" ]]; then
    rm -f "$LOCAL_LINK_STAGE" 2>/dev/null || true
  fi
  if [[ -n "$CLIENT_CONFIG_STAGE" ]]; then
    rm -f "$CLIENT_CONFIG_STAGE" 2>/dev/null || true
  fi
  if [[ -n "$CLIENT_ZSHRC_STAGE" ]]; then
    rm -f "$CLIENT_ZSHRC_STAGE" 2>/dev/null || true
  fi

  release_local_lock

  if [[ -n "$REMOTE_CLEANUP_HOST" ]]; then
    for remote_path in "${REMOTE_CLEANUP_PATHS[@]}"; do
      ssh "${SSH_OPTIONS[@]}" "$REMOTE_CLEANUP_HOST" \
        "rm -f -- \"\$HOME/$remote_path\"" >/dev/null 2>&1 || true
    done
  fi
}

on_exit() {
  local status=$?
  cleanup_all
  return "$status"
}

on_signal() {
  local status="$1"
  trap - HUP INT TERM
  cleanup_all
  trap - EXIT
  exit "$status"
}

trap on_exit EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

require_source() {
  local path="$1"
  [[ -f "$path" ]] || die "required source is missing: $path"
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

timestamp_id() {
  printf '%s-%s-%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "${RANDOM:-0}"
}

install_lock_ttl() {
  local value="${CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS:-600}"
  case "$value" in
    ""|*[!0-9]*)
      die "CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS must be a non-negative integer"
      ;;
  esac
  printf '%s\n' "$value"
}

clear_reclaimable_lock() {
  local lock="$1"
  local ttl="$2"
  local owner="$lock/owner.json"
  local owner_snapshot=""
  local owner_pid=""
  local owner_host=""
  local owner_start=""
  local owner_token=""
  local current_host
  local now
  local age
  local mtime
  local valid=0

  current_host="$(local_hostname)"
  now="$(date +%s)"
  if [[ -f "$owner" ]]; then
    owner_snapshot="$(cat "$owner")"
    owner_pid="$(read_owner_field "$owner" pid)"
    owner_host="$(read_owner_field "$owner" host)"
    owner_start="$(read_owner_field "$owner" start)"
    owner_token="$(read_owner_field "$owner" token)"
    if [[ -n "$owner_pid" &&
          -n "$owner_host" &&
          -n "$owner_start" &&
          -n "$owner_token" ]]; then
      valid=1
    fi
  fi

  if [[ "$valid" -eq 1 ]]; then
    if [[ "$owner_host" == "$current_host" ]]; then
      if kill -0 "$owner_pid" 2>/dev/null; then
        return 1
      fi
    else
      age=$((now - owner_start))
      if [[ "$age" -lt "$ttl" ]]; then
        return 1
      fi
    fi
    lock_owner_matches \
      "$lock" "$owner_pid" "$owner_host" "$owner_start" "$owner_token" ||
      return 1
    rm -f "$owner" || return 1
  else
    mtime="$(lock_mtime "$lock")"
    [[ -n "$mtime" ]] || return 1
    age=$((now - mtime))
    if [[ "$age" -lt "$ttl" ]]; then
      return 1
    fi
    if [[ -e "$owner" ]]; then
      [[ "$(cat "$owner")" == "$owner_snapshot" ]] || return 1
      rm -f "$owner" || return 1
    fi
  fi

  rmdir "$lock" 2>/dev/null
}

acquire_local_lock() {
  local lock="$1"
  local token="$2"
  local ttl
  local owner_host
  local owner_start
  local owner="$lock/owner.json"

  ttl="$(install_lock_ttl)"
  if ! mkdir "$lock" 2>/dev/null; then
    clear_reclaimable_lock "$lock" "$ttl" ||
      die "another codex-slot install is in progress"
    mkdir "$lock" 2>/dev/null ||
      die "another codex-slot install is in progress"
  fi

  owner_host="$(local_hostname)"
  owner_start="$(date +%s)"
  if ! printf '{"pid":%s,"host":"%s","start":%s,"token":"%s"}\n' \
      "$$" "$owner_host" "$owner_start" "$token" >"$owner"; then
    rm -f "$owner" 2>/dev/null || true
    rmdir "$lock" 2>/dev/null || true
    die "failed to write install lock owner"
  fi
  LOCAL_LOCK="$lock"
  LOCAL_LOCK_TOKEN="$token"
  LOCAL_LOCK_PID="$$"
  LOCAL_LOCK_HOST="$owner_host"
  LOCAL_LOCK_START="$owner_start"
  LOCAL_LOCK_OWNED=1
}

path_has_local_bin() {
  case ":${PATH:-}:" in
    *":$HOME/.local/bin:"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_path_block() {
  local unique="$1"
  local backup_dir="$2"
  local zshrc="$HOME/.zshrc"
  local begin_marker="# codex-slot-path-begin"
  local end_marker="# codex-slot-path-end"

  if path_has_local_bin; then
    return
  fi

  if [[ -e "$zshrc" || -L "$zshrc" ]]; then
    [[ -f "$zshrc" && ! -L "$zshrc" ]] ||
      die "cannot update non-regular zshrc: $zshrc"
  fi
  if [[ -f "$zshrc" ]] && grep -qF "$begin_marker" "$zshrc" 2>/dev/null; then
    return
  fi

  CLIENT_ZSHRC="$zshrc"
  CLIENT_ZSHRC_STAGE="$zshrc.new.$unique"
  if [[ -f "$zshrc" ]]; then
    CLIENT_ZSHRC_EXISTED=1
    CLIENT_SAVED_ZSHRC="$backup_dir/zshrc"
    cp -p "$zshrc" "$CLIENT_SAVED_ZSHRC"
    cp -p "$zshrc" "$CLIENT_ZSHRC_STAGE"
  else
    : >"$CLIENT_ZSHRC_STAGE"
    chmod 600 "$CLIENT_ZSHRC_STAGE"
  fi

  {
    printf '\n%s\n' "$begin_marker"
    printf '%s\n' '# Added by install-codex-slot.sh'
    printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"'
    printf '%s\n' "$end_marker"
  } >>"$CLIENT_ZSHRC_STAGE"
  mv -f "$CLIENT_ZSHRC_STAGE" "$zshrc"
  CLIENT_ZSHRC_STAGE=""
  CLIENT_ZSHRC_CHANGED=1
}

install_default_config() {
  local unique="$1"
  local config_dir="$HOME/.config/codex-slot"
  local config_path="$config_dir/config.json"

  CLIENT_CONFIG_DIR="$config_dir"
  CLIENT_CONFIG_PATH="$config_path"
  if [[ -e "$config_dir" || -L "$config_dir" ]]; then
    [[ -d "$config_dir" && ! -L "$config_dir" ]] ||
      die "cannot use non-directory config path: $config_dir"
  else
    mkdir -p "$config_dir"
    chmod 700 "$config_dir"
    CLIENT_CONFIG_DIR_CREATED=1
  fi
  if [[ -e "$config_path" || -L "$config_path" ]]; then
    return
  fi

  CLIENT_CONFIG_STAGE="$config_path.new.$unique"
  cp "$CONFIG_SOURCE" "$CLIENT_CONFIG_STAGE"
  chmod 600 "$CLIENT_CONFIG_STAGE"
  mv -f "$CLIENT_CONFIG_STAGE" "$config_path"
  CLIENT_CONFIG_STAGE=""
  CLIENT_CONFIG_CREATED=1
}

install_client() {
  local lib_parent="$HOME/.local/lib"
  local lib_dir="$lib_parent/codex-slot"
  local bin_dir="$HOME/.local/bin"
  local unique
  local backup_dir
  local client_source="$SCRIPT_DIR/codex-slot-client.mjs"
  local entry_source="$SCRIPT_DIR/codex-slot"

  require_source "$client_source"
  require_source "$entry_source"
  require_source "$CONFIG_SOURCE"

  mkdir -p "$lib_parent" "$bin_dir"
  chmod 700 "$lib_parent" "$bin_dir"

  unique="$(timestamp_id)"
  LOCAL_LOCK="$lib_parent/.codex-slot-install.lock"
  acquire_local_lock "$LOCAL_LOCK" "$unique"

  LOCAL_STAGE="$lib_parent/codex-slot.new.$unique"
  mkdir "$LOCAL_STAGE"
  chmod 700 "$LOCAL_STAGE"

  cp "$client_source" "$LOCAL_STAGE/codex-slot-client.mjs"
  cp "$entry_source" "$LOCAL_STAGE/codex-slot"
  chmod 755 \
    "$LOCAL_STAGE/codex-slot-client.mjs" \
    "$LOCAL_STAGE/codex-slot"

  [[ "$(sha256_file "$client_source")" == \
      "$(sha256_file "$LOCAL_STAGE/codex-slot-client.mjs")" ]] \
    || die "local client checksum mismatch"
  [[ "$(sha256_file "$entry_source")" == \
      "$(sha256_file "$LOCAL_STAGE/codex-slot")" ]] \
    || die "local entry checksum mismatch"

  LOCAL_LINK_STAGE="$bin_dir/codex-slot.new.$unique"
  ln -s "../lib/codex-slot/codex-slot-client.mjs" "$LOCAL_LINK_STAGE"
  if [[ -d "$bin_dir/codex-slot" && ! -L "$bin_dir/codex-slot" ]]; then
    die "cannot replace directory: $bin_dir/codex-slot"
  fi
  if [[ -e "$HOME/.zshrc" || -L "$HOME/.zshrc" ]]; then
    [[ -f "$HOME/.zshrc" && ! -L "$HOME/.zshrc" ]] ||
      die "cannot update non-regular zshrc: $HOME/.zshrc"
  fi

  backup_dir="$HOME/.codex-script-backups/${unique}-codex-slot"
  mkdir -p "$backup_dir"
  chmod 700 "$HOME/.codex-script-backups" "$backup_dir"

  CLIENT_TRANSACTION_ACTIVE=1
  CLIENT_LIB_DIR="$lib_dir"
  CLIENT_LINK_PATH="$bin_dir/codex-slot"

  if [[ -e "$lib_dir" || -L "$lib_dir" ]]; then
    CLIENT_SAVED_DIR="$backup_dir/client"
    mv "$lib_dir" "$CLIENT_SAVED_DIR"
  fi
  if [[ -e "$CLIENT_LINK_PATH" || -L "$CLIENT_LINK_PATH" ]]; then
    CLIENT_SAVED_LINK="$backup_dir/entry"
    mv "$CLIENT_LINK_PATH" "$CLIENT_SAVED_LINK"
  fi

  if ! mv "$LOCAL_STAGE" "$lib_dir"; then
    die "failed to atomically install client"
  fi
  CLIENT_LIB_INSTALLED=1
  LOCAL_STAGE=""

  if ! mv -f "$LOCAL_LINK_STAGE" "$bin_dir/codex-slot"; then
    die "failed to atomically install client entry"
  fi
  CLIENT_LINK_INSTALLED=1
  LOCAL_LINK_STAGE=""

  install_default_config "$unique"
  ensure_path_block "$unique" "$backup_dir"

  CLIENT_TRANSACTION_OK=1
  release_local_lock
  LOCAL_LOCK=""
  printf 'Installed codex-slot client in %s\n' "$lib_dir"
}

remote_prepare() {
  local host="$1"
  local role="$2"
  local role_root

  if [[ "$role" == "broker" ]]; then
    role_root='.codex-slot'
  else
    role_root='.codex-slots'
  fi

  ssh "${SSH_OPTIONS[@]}" "$host" \
    "set -eu; mkdir -p \"\$HOME/.local/lib/codex-slot\" \"\$HOME/$role_root\"; chmod 700 \"\$HOME/.local/lib/codex-slot\" \"\$HOME/$role_root\""
}

remote_sha256() {
  local host="$1"
  local remote_path="$2"
  ssh "${SSH_OPTIONS[@]}" "$host" \
    "shasum -a 256 -- \"\$HOME/$remote_path\"" | awk '{print $1}'
}

deploy_remote_role() {
  local role="$1"
  local host="$2"
  shift 2
  local -a sources=("$@")
  local unique
  local source
  local filename
  local remote_new
  local local_sha
  local remote_sha
  local files_words=""
  local new_words=""
  local exit_node="${CODEX_SLOT_EXIT_NODE:-mmv}"
  local final_command
  local quoted_final_command
  local lock_ttl

  validate_host "$host"
  validate_host "$exit_node"
  for source in "${sources[@]}"; do
    require_source "$source"
  done

  unique="$(timestamp_id)"
  lock_ttl="$(install_lock_ttl)"
  remote_prepare "$host" "$role"
  REMOTE_CLEANUP_HOST="$host"
  REMOTE_CLEANUP_PATHS=()

  for source in "${sources[@]}"; do
    filename="${source##*/}"
    remote_new=".local/lib/codex-slot/$filename.new.$unique"
    local_sha="$(sha256_file "$source")"

    REMOTE_CLEANUP_PATHS+=("$remote_new")

    scp "${SCP_OPTIONS[@]}" "$source" "$host:$remote_new"
    remote_sha="$(remote_sha256 "$host" "$remote_new")"
    if [[ ! "$remote_sha" =~ ^[0-9a-fA-F]{64}$ || "$remote_sha" != "$local_sha" ]]; then
      die "SHA256 mismatch for $host:$filename"
    fi

    if [[ -n "$files_words" ]]; then
      files_words+=" "
      new_words+=" "
    fi
    files_words+="$filename"
    new_words+="$filename.new.$unique"
  done

  read -r -d '' final_command <<'REMOTE_INSTALL' || true
set -eu
role='@ROLE@'
unique='@UNIQUE@'
exit_node='@EXIT_NODE@'
lock_ttl='@LOCK_TTL@'
files='@FILES@'
new_files='@NEW_FILES@'
base="$HOME/.local/lib/codex-slot"
lock="$HOME/.local/lib/.codex-slot-install.lock"
owner="$lock/owner.json"
backup="$HOME/.codex-script-backups/@UNIQUE@-codex-slot"
rollback="$base/.rollback.@UNIQUE@"
lock_token="@UNIQUE@-$$"
lock_pid=$$
lock_owned=0
ok=0
started=0
cleaned=0

read_remote_owner() {
  remote_owner_pid=$(sed -n 's/.*"pid":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$owner" 2>/dev/null)
  remote_owner_host=$(sed -n 's/.*"host":[[:space:]]*"\([A-Za-z0-9._-][A-Za-z0-9._-]*\)".*/\1/p' "$owner" 2>/dev/null)
  remote_owner_start=$(sed -n 's/.*"start":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$owner" 2>/dev/null)
  remote_owner_token=$(sed -n 's/.*"token":[[:space:]]*"\([A-Za-z0-9._-][A-Za-z0-9._-]*\)".*/\1/p' "$owner" 2>/dev/null)
}

remote_lock_mtime() {
  stat -f '%m' "$lock" 2>/dev/null || stat -c '%Y' "$lock" 2>/dev/null
}

reclaim_remote_lock() {
  remote_now=$(date +%s)
  remote_current_host=$(hostname)
  case "$remote_current_host" in
    ""|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  remote_snapshot=""
  if [ -f "$owner" ]; then
    remote_snapshot=$(cat "$owner")
  fi
  read_remote_owner
  if [ -n "$remote_owner_pid" ] &&
      [ -n "$remote_owner_host" ] &&
      [ -n "$remote_owner_start" ] &&
      [ -n "$remote_owner_token" ]; then
    if [ "$remote_owner_host" = "$remote_current_host" ]; then
      if kill -0 "$remote_owner_pid" 2>/dev/null; then
        return 1
      fi
    else
      remote_age=$((remote_now - remote_owner_start))
      [ "$remote_age" -ge "$lock_ttl" ] || return 1
    fi
    expected_pid=$remote_owner_pid
    expected_host=$remote_owner_host
    expected_start=$remote_owner_start
    expected_token=$remote_owner_token
    read_remote_owner
    [ "$remote_owner_pid" = "$expected_pid" ] &&
      [ "$remote_owner_host" = "$expected_host" ] &&
      [ "$remote_owner_start" = "$expected_start" ] &&
      [ "$remote_owner_token" = "$expected_token" ] || return 1
    rm -f "$owner" || return 1
  else
    remote_mtime=$(remote_lock_mtime)
    [ -n "$remote_mtime" ] || return 1
    remote_age=$((remote_now - remote_mtime))
    [ "$remote_age" -ge "$lock_ttl" ] || return 1
    if [ -e "$owner" ]; then
      [ "$(cat "$owner")" = "$remote_snapshot" ] || return 1
      rm -f "$owner" || return 1
    fi
  fi
  rmdir "$lock" 2>/dev/null
}

if ! mkdir "$lock" 2>/dev/null; then
  reclaim_remote_lock || {
    echo "another codex-slot install is in progress" >&2
    exit 73
  }
  mkdir "$lock" 2>/dev/null || {
    echo "another codex-slot install is in progress" >&2
    exit 73
  }
fi

owner_host=$(hostname)
case "$owner_host" in
  ""|*[!A-Za-z0-9._-]*)
    rmdir "$lock" 2>/dev/null || true
    echo "unsafe remote hostname" >&2
    exit 73
    ;;
esac
owner_start=$(date +%s)
printf '{"pid":%s,"host":"%s","start":%s,"token":"%s"}\n' \
  "$lock_pid" "$owner_host" "$owner_start" "$lock_token" >"$owner"
lock_owned=1

cleanup_role_install() {
  if [ "$cleaned" -eq 1 ]; then
    return
  fi
  cleaned=1
  set +e
  if [ "$ok" -ne 1 ] && [ "$started" -eq 1 ]; then
    for file in $files; do
      if [ -f "$rollback/$file" ]; then
        mv -f "$rollback/$file" "$base/$file"
      else
        rm -f "$base/$file"
      fi
    done
  fi
  for staged in $new_files; do
    rm -f "$base/$staged"
  done
  for file in $files; do
    rm -f "$rollback/$file"
  done
  rmdir "$rollback" 2>/dev/null || true
  if [ "$lock_owned" -eq 1 ] && [ -d "$lock" ]; then
    read_remote_owner
    if [ "$remote_owner_pid" = "$lock_pid" ] &&
        [ "$remote_owner_host" = "$owner_host" ] &&
        [ "$remote_owner_start" = "$owner_start" ] &&
        [ "$remote_owner_token" = "$lock_token" ]; then
      rm -f "$owner"
      rmdir "$lock" 2>/dev/null || true
    fi
  fi
}

signal_role_install() {
  signal_status=$1
  trap - HUP INT TERM
  cleanup_role_install
  trap - EXIT
  exit "$signal_status"
}

trap cleanup_role_install EXIT
trap 'signal_role_install 129' HUP
trap 'signal_role_install 130' INT
trap 'signal_role_install 143' TERM

mkdir -p "$backup" "$rollback"
chmod 700 "$HOME/.codex-script-backups" "$backup" "$rollback"
for file in $files; do
  if [ -f "$base/$file" ]; then
    cp -p "$base/$file" "$backup/$file"
    cp -p "$base/$file" "$rollback/$file"
  fi
done
started=1
: ATOMIC_MV
set_new="$new_files"
for file in $files; do
  staged=${set_new%% *}
  if [ "$set_new" = "$staged" ]; then
    set_new=""
  else
    set_new=${set_new#* }
  fi
  mv -f "$base/$staged" "$base/$file"
  chmod 755 "$base/$file"
done
if [ "$role" = broker ]; then
  mkdir -p "$HOME/.codex-slot"
  chmod 700 "$HOME/.codex-slot"
else
  mkdir -p "$HOME/.codex-slots"
  chmod 700 "$HOME/.codex-slots"
  CODEX_SLOT_EXIT_NODE="$exit_node"
  export CODEX_SLOT_EXIT_NODE
  : "$CODEX_SLOT_EXIT_NODE"
fi
ok=1
REMOTE_INSTALL
  final_command="${final_command//@ROLE@/$role}"
  final_command="${final_command//@UNIQUE@/$unique}"
  final_command="${final_command//@EXIT_NODE@/$exit_node}"
  final_command="${final_command//@LOCK_TTL@/$lock_ttl}"
  final_command="${final_command//@FILES@/$files_words}"
  final_command="${final_command//@NEW_FILES@/$new_words}"
  quoted_final_command="$(posix_single_quote "$final_command")"

  ssh "${SSH_OPTIONS[@]}" "$host" "/bin/sh -c $quoted_final_command"
  REMOTE_CLEANUP_HOST=""
  REMOTE_CLEANUP_PATHS=()
  printf 'Installed codex-slot %s on %s\n' "$role" "$host"
}

install_broker() {
  deploy_remote_role broker "$1" \
    "$SCRIPT_DIR/codex-slot-broker.mjs" \
    "$SCRIPT_DIR/codex-slot-store.mjs"
}

install_agent() {
  deploy_remote_role agent "$1" \
    "$SCRIPT_DIR/codex-slot-agent.mjs" \
    "$SCRIPT_DIR/codex-slot-store.mjs"
}

parse_args "$@"

case "$MODE" in
  client)
    install_client
    ;;
  broker)
    install_broker "$TARGET_HOST"
    ;;
  agent)
    install_agent "$TARGET_HOST"
    ;;
  all)
    install_client
    install_broker mmv
    install_agent xian-m4
    install_agent xian-m1
    ;;
esac
