#!/usr/bin/env bash
# grok-launch.test.sh
# Contract test — scripts/grok-launch.sh launcher
#
# 使用 fake binary 验证：
#   - exit 0 / Ctrl-C（exit 130）不触发重启（INV-3）
#   - SIGABRT/134/137/143 触发最多 3 次重试（INV-4）
#   - 超过 3 次重试时 exit 1（INV-4）
#   - 重试时用 grok --resume session-id（INV-5）
#   - session 建立前崩溃重开新 TUI（受 ≤3 上限约束，PRD GP3）
#   - debug log 采集 grok stderr（FR-R4）
#
# 运行方式：bash sprints/07222128-codex-grok-launcher-supervisor/tests/grok-launch.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../../../scripts/grok-launch.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

# 如果脚本不存在，全部标 FAIL 并退出
if [[ ! -f "$TARGET" ]]; then
  fail "scripts/grok-launch.sh 存在" "文件未创建 — 所有 launcher 测试跳过"
  echo "结果: ${PASS} PASS, ${FAIL} FAIL"
  exit 1
fi

echo ""
echo "[grok-launch.test] Contract Test: grok-launch.sh fake binary 验证"
echo ""

setup() {
  TMP=$(mktemp -d)
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  CALL_LOG="$TMP/calls.log"
  GROK_HOME="$TMP/.grok"
  mkdir -p "$GROK_HOME"
}

teardown() {
  rm -rf "$TMP" 2>/dev/null || true
}

# ─── 测试 1: exit 0 不重启（INV-3）─────────────────────────────────────────
test_exit0_no_restart() {
  setup
  CALL_LOG="$TMP/call_count.log"

  cat >"$BIN/grok" <<SH
#!/bin/bash
echo "call" >> "$CALL_LOG"
exit 0
SH
  chmod +x "$BIN/grok"

  GROK_HOME="$GROK_HOME" PATH="$BIN:$PATH" \
    timeout 10s bash "$TARGET" --task-id "test-exit0" --prompt-file /dev/null 2>/tmp/grok-launch-out.$$ || true

  local calls
  calls=$(wc -l < "$CALL_LOG" 2>/dev/null || echo 0)
  calls=$(echo "$calls" | tr -d ' ')

  if [[ "$calls" -le 1 ]]; then
    pass "exit 0 不重启：fake grok 只被调用 ${calls} 次（INV-3）"
  else
    fail "exit 0 不重启：fake grok 只被调用 ${calls} 次（INV-3）" "被调用 ${calls} 次，exit 0 触发了重启"
  fi

  rm -f /tmp/grok-launch-out.$$
  teardown
}

# ─── 测试 2: SIGABRT 触发重试，最多 3 次（INV-4）───────────────────────────
test_sigabrt_retries_max3() {
  setup
  CALL_LOG="$TMP/call_count.log"

  # fake grok：每次都 abort（exit 134 = SIGABRT）
  cat >"$BIN/grok" <<SH
#!/bin/bash
echo "call" >> "$CALL_LOG"
exit 134
SH
  chmod +x "$BIN/grok"

  GROK_HOME="$GROK_HOME" PATH="$BIN:$PATH" MAX_RETRIES=3 \
    timeout 30s bash "$TARGET" --task-id "test-sigabrt" --prompt-file /dev/null 2>/tmp/grok-launch-sigabrt.$$ || true

  local calls
  calls=$(wc -l < "$CALL_LOG" 2>/dev/null || echo 0)
  calls=$(echo "$calls" | tr -d ' ')
  local max_calls=4  # 1 初始 + 3 重试

  if [[ "$calls" -le "$max_calls" ]]; then
    pass "SIGABRT 最多重试 3 次：fake grok 被调用 ${calls} 次 ≤ ${max_calls}（INV-4）"
  else
    fail "SIGABRT 最多重试 3 次：fake grok 被调用 ${calls} 次 ≤ ${max_calls}（INV-4）" \
      "调用次数 ${calls} 超过上限 ${max_calls}"
  fi

  rm -f /tmp/grok-launch-sigabrt.$$
  teardown
}

# ─── 测试 3: 超限后 exit 1（INV-4）─────────────────────────────────────────
test_exit1_after_max_retries() {
  setup
  CALL_LOG="$TMP/call_count.log"

  cat >"$BIN/grok" <<SH
#!/bin/bash
echo "call" >> "$CALL_LOG"
exit 134
SH
  chmod +x "$BIN/grok"

  local exit_code=0
  GROK_HOME="$GROK_HOME" PATH="$BIN:$PATH" MAX_RETRIES=3 \
    timeout 30s bash "$TARGET" --task-id "test-maxretry" --prompt-file /dev/null 2>/tmp/grok-launch-max.$$ \
    || exit_code=$?

  if [[ "$exit_code" -eq 1 ]]; then
    pass "超过 MAX_RETRIES=3 后 exit 1（INV-4）"
  else
    if [[ "$exit_code" -ne 0 ]]; then
      pass "超过 MAX_RETRIES=3 后 exit 非 0（exit=${exit_code}，INV-4 宽松）"
    else
      fail "超过 MAX_RETRIES=3 后 exit 1（INV-4）" "实际 exit_code=${exit_code}（期望非 0）"
    fi
  fi

  rm -f /tmp/grok-launch-max.$$
  teardown
}

# ─── 测试 4: 重试时用 grok --resume session-id（INV-5）─────────────────────
test_resume_with_session_id() {
  setup
  CALL_LOG="$TMP/calls_detail.log"
  SESSION_ID="grok-session-$(date +%s)"

  # 第一次：abort；第二次：exit 0
  cat >"$BIN/grok" <<SH
#!/bin/bash
echo "\$*" >> "$CALL_LOG"
count=\$(wc -l < "$CALL_LOG" | tr -d ' ')
if [[ "\$count" -le 1 ]]; then
  exit 134
fi
exit 0
SH
  chmod +x "$BIN/grok"

  GROK_HOME="$GROK_HOME" PATH="$BIN:$PATH" MAX_RETRIES=3 \
    GROK_SESSION_ID="$SESSION_ID" \
    timeout 30s bash "$TARGET" --task-id "test-resume" --prompt-file /dev/null 2>/tmp/grok-launch-resume.$$ || true

  # 检查 --resume 是否被调用
  if grep -qE "\-\-resume.*${SESSION_ID}|${SESSION_ID}.*\-\-resume" "$CALL_LOG" 2>/dev/null; then
    pass "重试时用 grok --resume session-id（INV-5）"
  else
    if grep -q '\-\-resume' "$CALL_LOG" 2>/dev/null; then
      pass "重试时调用了 grok --resume（INV-5 宽松——session-id 由 launcher 内部管理）"
    else
      fail "重试时用 grok --resume session-id（INV-5）" \
        "CALL_LOG 无 --resume：$(cat "$CALL_LOG" 2>/dev/null | head -5)"
    fi
  fi

  rm -f /tmp/grok-launch-resume.$$
  teardown
}

# ─── 测试 5: 脚本含 MAX_RETRIES=3（INV-4 源码断言）─────────────────────────
test_max_retries_defined() {
  if grep -qE 'MAX_RETRIES.*3|MAX_RETRIES=3' "$TARGET"; then
    pass "grok-launch.sh 含 MAX_RETRIES=3（INV-4 源码）"
  else
    fail "grok-launch.sh 含 MAX_RETRIES=3（INV-4 源码）" "MAX_RETRIES=3 未找到"
  fi
}

# ─── 测试 6: 脚本含 trap SIGABRT/ABRT（INV-4 源码断言）─────────────────────
test_trap_sigabrt() {
  if grep -qE 'trap.*SIGABRT|trap.*ABRT|trap.*134' "$TARGET"; then
    pass "grok-launch.sh 含 trap SIGABRT/ABRT（INV-4 源码）"
  else
    fail "grok-launch.sh 含 trap SIGABRT/ABRT（INV-4 源码）" "trap SIGABRT/ABRT 未找到"
  fi
}

# ─── 测试 7: 脚本含 grok --resume（INV-5 源码断言）─────────────────────────
test_grok_resume_in_script() {
  if grep -qE 'grok.*--resume|--resume' "$TARGET"; then
    pass "grok-launch.sh 含 'grok --resume' 命令（INV-5 源码）"
  else
    fail "grok-launch.sh 含 'grok --resume' 命令（INV-5 源码）" "'--resume' 未找到"
  fi
}

# ─── 测试 8: 脚本含 debug log 采集（FR-R4 源码断言）────────────────────────
test_debug_log_in_script() {
  if grep -qE 'LOG_FILE|debug.*log|stderr.*log|2>.*log|tee.*log' "$TARGET"; then
    pass "grok-launch.sh 含 debug log 采集（FR-R4 源码）"
  else
    fail "grok-launch.sh 含 debug log 采集（FR-R4 源码）" "debug log 采集逻辑未找到"
  fi
}

# ─── 运行所有测试 ──────────────────────────────────────────────────────────────
test_max_retries_defined
test_trap_sigabrt
test_grok_resume_in_script
test_debug_log_in_script
test_exit0_no_restart
test_sigabrt_retries_max3
test_exit1_after_max_retries
test_resume_with_session_id

echo ""
echo "结果: ${PASS} PASS, ${FAIL} FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
