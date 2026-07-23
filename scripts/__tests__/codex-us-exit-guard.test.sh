#!/usr/bin/env bash
# codex-us-exit-guard.test.sh — 美国出口守卫单元测试（mock tailscale/curl/DNS）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-us-exit-guard.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

setup() {
  TEST_TMP="$(mktemp -d)"
  TEST_BIN="${TEST_TMP}/bin"
  TEST_LOG="${TEST_TMP}/calls.log"
  MOCK_EXIT_FILE="${TEST_TMP}/current-exit"
  MOCK_COUNTRY_FILE="${TEST_TMP}/country"
  MOCK_HTTP_CODE_FILE="${TEST_TMP}/http-code"
  MOCK_STATUS_FILE="${TEST_TMP}/status.json"
  CODEX_HOSTS_FILE="${TEST_TMP}/hosts"
  mkdir -p "$TEST_BIN"
  : > "$TEST_LOG"
  printf '%s' '100.71.151.105' > "$MOCK_EXIT_FILE"
  printf '%s' 'US' > "$MOCK_COUNTRY_FILE"
  printf '%s' '451' > "$MOCK_HTTP_CODE_FILE"
  printf '%s\n' '127.0.0.1 localhost' > "$CODEX_HOSTS_FILE"
  printf '%s\n' '{"Peer":{"m4":{"HostName":"perfect21","TailscaleIPs":["100.71.151.105"],"Online":true,"ExitNodeOption":true},"sf":{"HostName":"sf-vps","TailscaleIPs":["100.79.41.61"],"Online":true,"ExitNodeOption":true}}}' > "$MOCK_STATUS_FILE"

  cat > "${TEST_BIN}/tailscale" <<'SH'
#!/usr/bin/env bash
echo "tailscale $*" >> "$TEST_LOG"
if [[ "$1 $2" == "debug prefs" ]]; then
  printf '{"ExitNodeIP":"%s"}\n' "$(cat "$MOCK_EXIT_FILE")"
elif [[ "$1 $2" == "status --json" ]]; then
  cat "$MOCK_STATUS_FILE"
elif [[ "$1" == "set" ]]; then
  requested="${2#--exit-node=}"
  printf '%s' "$requested" > "$MOCK_EXIT_FILE"
else
  exit 2
fi
SH

  cat > "${TEST_BIN}/curl" <<'SH'
#!/usr/bin/env bash
echo "curl $*" >> "$TEST_LOG"
url="${*: -1}"
if [[ "$url" == *"cdn-cgi/trace"* ]]; then
  printf 'loc=%s\n' "$(cat "$MOCK_COUNTRY_FILE")"
  exit 0
fi
if [[ "${MOCK_CHATGPT_TIMEOUT:-0}" == "1" ]]; then
  exit 28
fi
cat "$MOCK_HTTP_CODE_FILE"
SH

  cat > "${TEST_BIN}/dscacheutil" <<'SH'
#!/usr/bin/env bash
echo "dscacheutil $*" >> "$TEST_LOG"
printf 'name: chatgpt.com\nip_address: %s\n' "${MOCK_DNS_IP:-104.18.32.47}"
SH

  chmod +x "${TEST_BIN}/tailscale" "${TEST_BIN}/curl" "${TEST_BIN}/dscacheutil"
  export TEST_LOG MOCK_EXIT_FILE MOCK_COUNTRY_FILE MOCK_HTTP_CODE_FILE MOCK_STATUS_FILE
  export CODEX_HOSTS_FILE
  export CODEX_EXIT_PRIMARY="100.71.151.105"
  export CODEX_EXIT_FALLBACK="100.79.41.61"
  export PATH="${TEST_BIN}:${PATH}"
  unset MOCK_CHATGPT_TIMEOUT MOCK_DNS_IP
}

teardown() { rm -rf "$TEST_TMP"; }

run_prepare() {
  bash "$TARGET" prepare "${TEST_TMP}/state" > "${TEST_TMP}/out" 2>&1
}

test_allowed_m4_passes_without_switching() {
  setup
  if run_prepare && ! grep -q '^tailscale set' "$TEST_LOG"; then
    pass "已选美国 M4 时直接通过且不切换"
  else
    fail "已选美国 M4 时直接通过且不切换" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

test_loopback_hosts_fails_before_network_change() {
  setup
  printf '%s\n' '127.0.0.1 chatgpt.com' >> "$CODEX_HOSTS_FILE"
  if run_prepare; then
    fail "hosts 回环覆盖时拒绝启动" "prepare 意外成功"
  elif ! grep -q '回环' "${TEST_TMP}/out"; then
    fail "hosts 回环覆盖时拒绝启动" "$(cat "${TEST_TMP}/out")"
  elif grep -q '^tailscale set' "$TEST_LOG"; then
    fail "hosts 回环覆盖时拒绝启动" "不应修改 Tailscale"
  else
    pass "hosts 回环覆盖时拒绝启动且不改路由"
  fi
  teardown
}

test_cn_public_egress_fails_closed() {
  setup
  printf '%s' 'CN' > "$MOCK_COUNTRY_FILE"
  if run_prepare; then
    fail "公网出口为 CN 时 fail closed" "prepare 意外成功"
  elif grep -q '不是 US' "${TEST_TMP}/out" && ! grep -q '^tailscale set' "$TEST_LOG"; then
    pass "公网出口为 CN 时 fail closed"
  else
    fail "公网出口为 CN 时 fail closed" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

test_chatgpt_transport_timeout_fails_closed() {
  setup
  export MOCK_CHATGPT_TIMEOUT=1
  if run_prepare; then
    fail "ChatGPT 传输超时时 fail closed" "prepare 意外成功"
  elif grep -q 'ChatGPT' "${TEST_TMP}/out" && ! grep -q '^tailscale set' "$TEST_LOG"; then
    pass "ChatGPT 传输超时时 fail closed"
  else
    fail "ChatGPT 传输超时时 fail closed" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

echo "=== codex-us-exit-guard.sh 测试 ==="
test_allowed_m4_passes_without_switching
test_loopback_hosts_fails_before_network_change
test_cn_public_egress_fails_closed
test_chatgpt_transport_timeout_fails_closed

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
