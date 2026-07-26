#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <xian-mac-m4|xian-mac-m1> <token-file>" >&2
  exit 64
fi

machine_id="$1"
token_file="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$machine_id" in
  xian-mac-m4)
    source_plist="$script_dir/com.perfect21.codex-bridge.plist"
    canonical_token_file='/Users/jinnuoshengyuan/.config/cecelia/kernel-fleet-bridge.token'
    bridge_ip='100.86.57.69'
    ;;
  xian-mac-m1)
    source_plist="$script_dir/com.perfect21.codex-bridge-m1.plist"
    canonical_token_file='/Users/xx-macmini/.config/cecelia/kernel-fleet-bridge.token'
    bridge_ip='100.88.166.55'
    ;;
  *)
    echo "unknown Kernel Bridge machine: $machine_id" >&2
    exit 64
    ;;
esac

plist_token_file="$canonical_token_file"
test_canonical_root="${KERNEL_BRIDGE_TEST_CANONICAL_ROOT:-}"
if [[ -n "$test_canonical_root" ]]; then
  if [[ "${NODE_ENV:-}" != 'test' || "${KERNEL_BRIDGE_TEST_ONLY:-}" != '1' ]]; then
    echo "test canonical root requires NODE_ENV=test and KERNEL_BRIDGE_TEST_ONLY=1" >&2
    exit 65
  fi
  if [[ "$test_canonical_root" != /* \
    || "$test_canonical_root" =~ [^A-Za-z0-9_./-] ]]; then
    echo "test canonical root must be an absolute path without shell metacharacters" >&2
    exit 65
  fi
  canonical_token_file="${test_canonical_root%/}${canonical_token_file}"
fi

if [[ "$token_file" != /* || "$token_file" =~ [^A-Za-z0-9_./-] ]]; then
  echo "token file must be an absolute path without shell metacharacters" >&2
  exit 65
fi
if [[ "$token_file" != "$canonical_token_file" ]]; then
  echo "token file does not match the canonical path for $machine_id" >&2
  exit 65
fi
if [[ ! -f "$token_file" || -L "$token_file" ]]; then
  echo "token file must be a regular non-symlink file" >&2
  exit 65
fi

token_mode="$(stat -f '%Lp' "$token_file" 2>/dev/null \
  || stat -c '%a' "$token_file" 2>/dev/null \
  || true)"
if [[ "$token_mode" != '600' ]]; then
  echo "token file mode must be 0600" >&2
  exit 65
fi

for command_name in launchctl curl jq; do
  command -v "$command_name" >/dev/null \
    || { echo "required command not found: $command_name" >&2; exit 69; }
done

install_dir="${KERNEL_BRIDGE_INSTALL_DIR:-${HOME:?}/Library/LaunchAgents}"
launch_domain="${KERNEL_BRIDGE_LAUNCH_DOMAIN:-gui/$(id -u)}"
installed_plist="$install_dir/com.perfect21.codex-bridge.plist"
mkdir -p "$install_dir"

escaped_token_file="${token_file//\\/\\\\}"
escaped_token_file="${escaped_token_file//&/\\&}"
escaped_token_file="${escaped_token_file//|/\\|}"
temporary_plist="$(mktemp "$install_dir/.codex-bridge.XXXXXX")"
trap 'rm -f "$temporary_plist"' EXIT
sed "s|<string>${plist_token_file}</string>|<string>${escaped_token_file}</string>|" \
  "$source_plist" > "$temporary_plist"
chmod 600 "$temporary_plist"

launchctl bootout "$launch_domain/com.perfect21.codex-bridge" >/dev/null 2>&1 || true
mv "$temporary_plist" "$installed_plist"
trap - EXIT
launchctl bootstrap "$launch_domain" "$installed_plist"
launchctl kickstart -k "$launch_domain/com.perfect21.codex-bridge"

curl -sf "http://${bridge_ip}:3458/health" |
  jq -e --arg id "$machine_id" \
    '.kernel_harness_protocol=="v1" and .canonical_machine_id==$id' >/dev/null

echo "Kernel Bridge installed and healthy: $machine_id"
