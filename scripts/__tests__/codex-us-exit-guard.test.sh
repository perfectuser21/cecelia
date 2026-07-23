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
  if [[ "${MOCK_PREFS_EXIT_EMPTY:-0}" == "1" ]]; then
    printf '{"ExitNodeID":"mock-node-id","ExitNodeIP":""}\n'
  else
    printf '{"ExitNodeIP":"%s"}\n' "$(cat "$MOCK_EXIT_FILE")"
  fi
elif [[ "$1 $2" == "status --json" ]]; then
  python3 - "$MOCK_STATUS_FILE" "$MOCK_EXIT_FILE" <<'PY'
import json, sys
status_path, exit_path = sys.argv[1:]
with open(status_path) as f:
    data = json.load(f)
with open(exit_path) as f:
    current = f.read().strip()
if current:
    data["ExitNodeStatus"] = {"Online": True, "TailscaleIPs": [current + "/32"]}
for peer in (data.get("Peer") or {}).values():
    peer["ExitNode"] = current in (peer.get("TailscaleIPs") or [])
print(json.dumps(data))
PY
elif [[ "$1" == "set" ]]; then
  requested="${2#--exit-node=}"
  if [[ "$requested" == "100.71.151.105" && "${MOCK_FAIL_PRIMARY:-0}" == "1" ]]; then
    exit 1
  fi
  if [[ "$requested" == "100.79.41.61" && "${MOCK_FAIL_FALLBACK:-0}" == "1" ]]; then
    exit 1
  fi
  if [[ -z "$requested" && "${MOCK_FAIL_RESTORE:-0}" == "1" ]]; then
    exit 1
  fi
  printf '%s' "$requested" > "$MOCK_EXIT_FILE"
else
  exit 2
fi
SH

  cat > "${TEST_BIN}/sudo" <<'SH'
#!/usr/bin/env bash
echo "sudo $*" >> "$TEST_LOG"
[[ "${1:-}" == "-n" ]] && shift
exec "$@"
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

  chmod +x "${TEST_BIN}/tailscale" "${TEST_BIN}/curl" "${TEST_BIN}/dscacheutil" "${TEST_BIN}/sudo"
  export TEST_LOG MOCK_EXIT_FILE MOCK_COUNTRY_FILE MOCK_HTTP_CODE_FILE MOCK_STATUS_FILE
  export CODEX_HOSTS_FILE
  export CODEX_EXIT_PRIMARY="100.71.151.105"
  export CODEX_EXIT_FALLBACK="100.79.41.61"
  export PATH="${TEST_BIN}:${PATH}"
  unset MOCK_CHATGPT_TIMEOUT MOCK_DNS_IP MOCK_FAIL_PRIMARY MOCK_FAIL_FALLBACK MOCK_FAIL_RESTORE MOCK_PREFS_EXIT_EMPTY
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

test_macos_empty_exitnodeip_uses_status_exitnode() {
  setup
  printf '%s' '100.79.41.61' > "$MOCK_EXIT_FILE"
  export MOCK_PREFS_EXIT_EMPTY=1
  if run_prepare && ! grep -q '^tailscale set' "$TEST_LOG"; then
    pass "macOS prefs ExitNodeIP 为空时从 status 识别 SF 出口"
  else
    fail "macOS prefs ExitNodeIP 为空时从 status 识别 SF 出口" "$(cat "${TEST_TMP}/out") $(cat "$TEST_LOG")"
  fi
  teardown
}

test_no_exit_switches_to_m4_and_restore_clears_exit() {
  setup
  : > "$MOCK_EXIT_FILE"
  if ! run_prepare; then
    fail "无 exit 时切 M4，restore 后清空" "$(cat "${TEST_TMP}/out")"
  elif [[ "$(cat "$MOCK_EXIT_FILE")" != "100.71.151.105" ]]; then
    fail "无 exit 时切 M4，restore 后清空" "prepare 后出口=$(cat "$MOCK_EXIT_FILE")"
  elif ! bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1; then
    fail "无 exit 时切 M4，restore 后清空" "$(cat "${TEST_TMP}/out")"
  elif [[ -s "$MOCK_EXIT_FILE" ]]; then
    fail "无 exit 时切 M4，restore 后清空" "restore 后出口=$(cat "$MOCK_EXIT_FILE")"
  else
    pass "无 exit 时切 M4，restore 后清空"
  fi
  teardown
}

test_non_us_exit_restores_original_after_session() {
  setup
  printf '%s' '100.86.118.99' > "$MOCK_EXIT_FILE"
  if run_prepare && bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1 && \
     [[ "$(cat "$MOCK_EXIT_FILE")" == "100.86.118.99" ]]; then
    pass "非美国出口在会话后恢复原节点"
  else
    fail "非美国出口在会话后恢复原节点" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

test_m4_unavailable_falls_back_to_sf() {
  setup
  : > "$MOCK_EXIT_FILE"
  printf '%s\n' '{"Peer":{"m4":{"HostName":"perfect21","TailscaleIPs":["100.71.151.105"],"Online":false,"ExitNodeOption":true},"sf":{"HostName":"sf-vps","TailscaleIPs":["100.79.41.61"],"Online":true,"ExitNodeOption":true}}}' > "$MOCK_STATUS_FILE"
  if run_prepare && [[ "$(cat "$MOCK_EXIT_FILE")" == "100.79.41.61" ]]; then
    pass "美国 M4 不可用时回退 SF"
  else
    fail "美国 M4 不可用时回退 SF" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

test_both_candidates_unavailable_fails() {
  setup
  : > "$MOCK_EXIT_FILE"
  printf '%s\n' '{"Peer":{"m4":{"HostName":"perfect21","TailscaleIPs":["100.71.151.105"],"Online":false,"ExitNodeOption":true},"sf":{"HostName":"sf-vps","TailscaleIPs":["100.79.41.61"],"Online":false,"ExitNodeOption":true}}}' > "$MOCK_STATUS_FILE"
  if run_prepare; then
    fail "两个美国候选都不可用时失败" "prepare 意外成功"
  elif grep -q '两个美国出口节点均不可用' "${TEST_TMP}/out" && ! grep -q '^tailscale set' "$TEST_LOG"; then
    pass "两个美国候选都不可用时失败"
  else
    fail "两个美国候选都不可用时失败" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

test_prepare_verification_failure_rolls_back_immediately() {
  setup
  : > "$MOCK_EXIT_FILE"
  printf '%s' 'CN' > "$MOCK_COUNTRY_FILE"
  if run_prepare; then
    fail "切换后验证失败立即回滚" "prepare 意外成功"
  elif [[ -s "$MOCK_EXIT_FILE" ]]; then
    fail "切换后验证失败立即回滚" "残留出口=$(cat "$MOCK_EXIT_FILE")"
  elif ! grep -q '公网出口不是 US' "${TEST_TMP}/out"; then
    fail "切换后验证失败立即回滚" "$(cat "${TEST_TMP}/out")"
  else
    pass "切换后验证失败立即回滚"
  fi
  teardown
}

test_restore_failure_returns_nonzero() {
  setup
  : > "$MOCK_EXIT_FILE"
  if ! run_prepare; then
    fail "恢复失败返回非零" "prepare 失败: $(cat "${TEST_TMP}/out")"
  else
    export MOCK_FAIL_RESTORE=1
    if bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1; then
      fail "恢复失败返回非零" "restore 意外成功"
    elif grep -q '恢复 Tailscale exit node 失败' "${TEST_TMP}/out"; then
      pass "恢复失败返回非零"
    else
      fail "恢复失败返回非零" "$(cat "${TEST_TMP}/out")"
    fi
  fi
  teardown
}

echo "=== codex-us-exit-guard.sh 测试 ==="
test_allowed_m4_passes_without_switching
test_loopback_hosts_fails_before_network_change
test_cn_public_egress_fails_closed
test_chatgpt_transport_timeout_fails_closed
test_macos_empty_exitnodeip_uses_status_exitnode
test_no_exit_switches_to_m4_and_restore_clears_exit
test_non_us_exit_restores_original_after_session
test_m4_unavailable_falls_back_to_sf
test_both_candidates_unavailable_fails
test_prepare_verification_failure_rolls_back_immediately
test_restore_failure_returns_nonzero

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
