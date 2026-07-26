#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-kernel-bridge.sh"
M4_PLIST="$SCRIPT_DIR/com.perfect21.codex-bridge.plist"
M1_PLIST="$SCRIPT_DIR/com.perfect21.codex-bridge-m1.plist"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_env() {
  local plist="$1"
  local key="$2"
  local value="$3"
  local block
  block="$(grep -A1 -F "<key>${key}</key>" "$plist" || true)"
  grep -Fq "<string>${value}</string>" <<<"$block" \
    || fail "$(basename "$plist") missing ${key}=${value}"
}

[[ -f "$INSTALLER" ]] || fail "installer does not exist"

assert_env "$M4_PLIST" KERNEL_MACHINE_ID xian-mac-m4
assert_env "$M1_PLIST" KERNEL_MACHINE_ID xian-mac-m1
assert_env "$M4_PLIST" KERNEL_BRIDGE_TOKEN_FILE \
  /Users/jinnuoshengyuan/.config/cecelia/kernel-fleet-bridge.token
assert_env "$M1_PLIST" KERNEL_BRIDGE_TOKEN_FILE \
  /Users/xx-macmini/.config/cecelia/kernel-fleet-bridge.token
assert_env "$M4_PLIST" CODEX_ACCOUNT_ALLOWLIST team1,team2,team3,team4,team5
assert_env "$M1_PLIST" CODEX_ACCOUNT_ALLOWLIST team5

if grep -Fq '<key>KERNEL_BRIDGE_TOKEN</key>' "$M4_PLIST" "$M1_PLIST"; then
  fail "a plist embeds a Bridge token"
fi

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
token_file="$test_root/kernel-fleet-bridge.token"
install_dir="$test_root/LaunchAgents"
launch_log="$test_root/launchctl.log"
mkdir -p "$install_dir"
printf '%s\n' 'test-bridge-token-that-is-at-least-32-bytes' > "$token_file"
chmod 600 "$token_file"

launchctl() {
  printf '%s\n' "$*" >> "$launch_log"
}
curl() {
  printf '{"kernel_harness_protocol":"v1","canonical_machine_id":"%s"}\n' \
    "${FAKE_HEALTH_MACHINE_ID:?}"
}
export -f launchctl curl
export launch_log
export KERNEL_BRIDGE_INSTALL_DIR="$install_dir"
export KERNEL_BRIDGE_LAUNCH_DOMAIN='gui/999'

if bash "$INSTALLER" unknown-machine "$token_file" >/dev/null 2>&1; then
  fail "installer accepted an unknown machine"
fi

chmod 644 "$token_file"
if FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$token_file" >/dev/null 2>&1; then
  fail "installer accepted a token file broader than 0600"
fi
chmod 600 "$token_file"

if FAKE_HEALTH_MACHINE_ID=xian-mac-m1 \
  bash "$INSTALLER" xian-mac-m4 "$token_file" >/dev/null 2>&1; then
  fail "installer returned success for mismatched canonical health"
fi

FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$token_file" >/dev/null
installed="$install_dir/com.perfect21.codex-bridge.plist"
assert_env "$installed" KERNEL_MACHINE_ID xian-mac-m4
assert_env "$installed" KERNEL_BRIDGE_TOKEN_FILE "$token_file"
grep -Fq 'bootstrap gui/999' "$launch_log" || fail "installer did not bootstrap launchd"
grep -Fq 'kickstart -k gui/999/com.perfect21.codex-bridge' "$launch_log" \
  || fail "installer did not kickstart launchd"

: > "$launch_log"
FAKE_HEALTH_MACHINE_ID=xian-mac-m1 \
  bash "$INSTALLER" xian-mac-m1 "$token_file" >/dev/null
assert_env "$installed" KERNEL_MACHINE_ID xian-mac-m1
assert_env "$installed" CODEX_ACCOUNT_ALLOWLIST team5

echo "PASS: deterministic Kernel Bridge installer contract"
