#!/usr/bin/env bash

set -eu

EX_CONFIG=78
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_AGENT="$SCRIPT_DIR/codex-slot-agent.mjs"
CONFIG_SOURCE=${CODEX_SLOT_CONFIG:-/etc/cecelia/codex-slot/agents.json}
INSTALL_ROOT=/
CUSTOM_ROOT=0

fail_config() {
  printf 'install-codex-slot: %s\n' "$1" >&2
  exit "$EX_CONFIG"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-root)
      [ "$#" -ge 2 ] || fail_config '--install-root requires an absolute path'
      INSTALL_ROOT=$2
      CUSTOM_ROOT=1
      shift 2
      ;;
    *)
      fail_config "unknown argument: $1"
      ;;
  esac
done

case "$INSTALL_ROOT" in
  /*) ;;
  *) fail_config '--install-root must be absolute' ;;
esac

# All fallible input checks happen before any install-root directory is made.
[ -f "$SOURCE_AGENT" ] || fail_config "agent source missing: $SOURCE_AGENT"
[ -f "$CONFIG_SOURCE" ] || fail_config "config missing: $CONFIG_SOURCE"
command -v node >/dev/null 2>&1 || fail_config 'node is required'

node - "$CONFIG_SOURCE" <<'NODE' || fail_config 'config must contain complete xian-m1/xian-m4 root mappings'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ids = new Set(['xian-m1', 'xian-m4']);
if (config.schema_version !== 1 || !Array.isArray(config.agents) || config.agents.length !== 2) {
  process.exit(1);
}
for (const agent of config.agents) {
  if (!ids.delete(agent.agent_id)
      || typeof agent.machine_registry_name !== 'string'
      || !agent.machine_registry_name
      || typeof agent.fleet_id !== 'string'
      || !agent.fleet_id
      || agent.root_attested !== true
      || typeof agent.mmv?.stable_node_id !== 'string'
      || !agent.mmv.stable_node_id
      || !Array.isArray(agent.mmv.allowed_ips)
      || agent.mmv.allowed_ips.length < 1) {
    process.exit(1);
  }
}
if (ids.size !== 0) process.exit(1);
NODE

if [ "$CUSTOM_ROOT" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  fail_config 'real installation must run as root'
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/codex-slot-install.XXXXXX") \
  || fail_config 'cannot create staging directory'
LIBEXEC_DIR="${INSTALL_ROOT%/}/usr/local/libexec"
CONFIG_DIR="${INSTALL_ROOT%/}/etc/cecelia/codex-slot"
AGENT_TARGET="$LIBEXEC_DIR/cecelia-codex-slot-agent"
CONFIG_TARGET="$CONFIG_DIR/agents.json"
AGENT_TEMP="$LIBEXEC_DIR/.cecelia-codex-slot-agent.$$"
CONFIG_TEMP="$CONFIG_DIR/.agents.json.$$"
AGENT_BACKUP="$LIBEXEC_DIR/.cecelia-codex-slot-agent.backup.$$"
CONFIG_BACKUP="$CONFIG_DIR/.agents.json.backup.$$"
AGENT_INSTALLED=0
CONFIG_INSTALLED=0
AGENT_BACKED_UP=0
CONFIG_BACKED_UP=0
INSTALL_COMMITTED=0

cleanup() {
  if [ "$INSTALL_COMMITTED" -eq 0 ]; then
    [ "$CONFIG_INSTALLED" -eq 0 ] || rm -f -- "$CONFIG_TARGET"
    [ "$AGENT_INSTALLED" -eq 0 ] || rm -f -- "$AGENT_TARGET"
    if [ "$CONFIG_BACKED_UP" -eq 1 ] && [ -e "$CONFIG_BACKUP" ]; then
      mv -- "$CONFIG_BACKUP" "$CONFIG_TARGET"
    fi
    if [ "$AGENT_BACKED_UP" -eq 1 ] && [ -e "$AGENT_BACKUP" ]; then
      mv -- "$AGENT_BACKUP" "$AGENT_TARGET"
    fi
  fi
  rm -f -- "$AGENT_TEMP" "$CONFIG_TEMP" "$AGENT_BACKUP" "$CONFIG_BACKUP"
  rm -rf -- "$STAGE"
}
trap cleanup EXIT HUP INT TERM

cp "$SOURCE_AGENT" "$STAGE/cecelia-codex-slot-agent"
cp "$CONFIG_SOURCE" "$STAGE/agents.json"
chmod 0755 "$STAGE/cecelia-codex-slot-agent"
chmod 0600 "$STAGE/agents.json"

mkdir -p "$LIBEXEC_DIR" "$CONFIG_DIR" \
  || fail_config 'cannot create installation directories'

# Prepare both files inside their destination filesystems before replacing
# either live target. A permission/disk failure therefore leaves no half-bundle.
install -m 0755 "$STAGE/cecelia-codex-slot-agent" "$AGENT_TEMP" \
  || fail_config 'cannot stage agent in installation directory'
install -m 0600 "$STAGE/agents.json" "$CONFIG_TEMP" \
  || fail_config 'cannot stage config in installation directory'

if [ "$(id -u)" -eq 0 ]; then
  chown 0:0 "$AGENT_TEMP" "$CONFIG_TEMP" \
    || fail_config 'cannot set root ownership on staged bundle'
fi

if [ -e "$AGENT_TARGET" ]; then
  mv -- "$AGENT_TARGET" "$AGENT_BACKUP" \
    || fail_config 'cannot preserve existing agent'
  AGENT_BACKED_UP=1
fi
if [ -e "$CONFIG_TARGET" ]; then
  mv -- "$CONFIG_TARGET" "$CONFIG_BACKUP" \
    || fail_config 'cannot preserve existing config'
  CONFIG_BACKED_UP=1
fi

mv -- "$AGENT_TEMP" "$AGENT_TARGET" \
  || fail_config 'cannot activate staged agent'
AGENT_INSTALLED=1
mv -- "$CONFIG_TEMP" "$CONFIG_TARGET" \
  || fail_config 'cannot activate staged config'
CONFIG_INSTALLED=1
INSTALL_COMMITTED=1

# Once both renames commit, backup cleanup is best-effort and cannot invalidate
# the installed pair.
rm -f -- "$AGENT_BACKUP" "$CONFIG_BACKUP"

printf 'installed agent=%s config=%s\n' \
  "$AGENT_TARGET" \
  "$CONFIG_TARGET"
