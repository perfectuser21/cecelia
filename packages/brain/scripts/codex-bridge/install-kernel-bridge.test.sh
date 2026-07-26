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
canonical_root="$test_root/canonical-root"
m4_token_file="$canonical_root/Users/jinnuoshengyuan/.config/cecelia/kernel-fleet-bridge.token"
m1_token_file="$canonical_root/Users/xx-macmini/.config/cecelia/kernel-fleet-bridge.token"
arbitrary_token_file="$test_root/arbitrary-kernel-fleet-bridge.token"
install_dir="$test_root/LaunchAgents"
launch_log="$test_root/launchctl.log"
mkdir -p "$install_dir" "$(dirname "$m4_token_file")" "$(dirname "$m1_token_file")"
printf '%s\n' 'test-bridge-token-that-is-at-least-32-bytes' > "$m4_token_file"
printf '%s\n' 'test-bridge-token-that-is-at-least-32-bytes' > "$m1_token_file"
printf '%s\n' 'test-bridge-token-that-is-at-least-32-bytes' > "$arbitrary_token_file"
chmod 600 "$m4_token_file" "$m1_token_file" "$arbitrary_token_file"

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

if FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$arbitrary_token_file" >/dev/null 2>&1; then
  fail "production installer accepted a non-canonical token path"
fi

export NODE_ENV='test'
export KERNEL_BRIDGE_TEST_ONLY='1'
export KERNEL_BRIDGE_TEST_CANONICAL_ROOT="$canonical_root"

if bash "$INSTALLER" unknown-machine "$m4_token_file" >/dev/null 2>&1; then
  fail "installer accepted an unknown machine"
fi

if FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$m1_token_file" >/dev/null 2>&1; then
  fail "M4 installer accepted the M1 canonical token path"
fi
if FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$arbitrary_token_file" >/dev/null 2>&1; then
  fail "test-rooted installer accepted an arbitrary token path"
fi

chmod 644 "$m4_token_file"
if FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$m4_token_file" >/dev/null 2>&1; then
  fail "installer accepted a token file broader than 0600"
fi
chmod 600 "$m4_token_file"

if FAKE_HEALTH_MACHINE_ID=xian-mac-m1 \
  bash "$INSTALLER" xian-mac-m4 "$m4_token_file" >/dev/null 2>&1; then
  fail "installer returned success for mismatched canonical health"
fi

FAKE_HEALTH_MACHINE_ID=xian-mac-m4 \
  bash "$INSTALLER" xian-mac-m4 "$m4_token_file" >/dev/null
installed="$install_dir/com.perfect21.codex-bridge.plist"
assert_env "$installed" KERNEL_MACHINE_ID xian-mac-m4
assert_env "$installed" KERNEL_BRIDGE_TOKEN_FILE "$m4_token_file"
grep -Fq 'bootstrap gui/999' "$launch_log" || fail "installer did not bootstrap launchd"
grep -Fq 'kickstart -k gui/999/com.perfect21.codex-bridge' "$launch_log" \
  || fail "installer did not kickstart launchd"

: > "$launch_log"
FAKE_HEALTH_MACHINE_ID=xian-mac-m1 \
  bash "$INSTALLER" xian-mac-m1 "$m1_token_file" >/dev/null
assert_env "$installed" KERNEL_MACHINE_ID xian-mac-m1
assert_env "$installed" CODEX_ACCOUNT_ALLOWLIST team5
assert_env "$installed" KERNEL_BRIDGE_TOKEN_FILE "$m1_token_file"

echo "PASS: deterministic Kernel Bridge installer contract"
