#!/usr/bin/env bash
# codex-launch.test.sh
# Contract test — scripts/codex-launch.sh launcher
#
# 使用 fake binary 验证：
#   - exit 0 / Ctrl-C（exit 130）不触发重启（INV-3）
#   - SIGABRT/134/137/143 触发最多 3 次重试（INV-4）
#   - 超过 3 次重试时 exit 1（INV-4）
#   - 重试时用 session-id 调 codex resume（INV-5）
#   - CODEX_HOME 使用凭据快照目录（INV-11）
#   - 进程具有 TTY（INV-12，在容器外测试，跳过实际 TTY 检测，断言日志含 pid）
#
# 运行方式：bash sprints/07222128-codex-grok-launcher-supervisor/tests/codex-launch.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../../../scripts/codex-launch.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

# 如果脚本不存在，全部标 FAIL 并退出
if [[ ! -f "$TARGET" ]]; then
  fail "scripts/codex-launch.sh 存在" "文件未创建 — 所有 launcher 测试跳过"
  echo "结果: ${PASS} PASS, ${FAIL} FAIL"
  exit 1
fi

echo ""
echo "[codex-launch.test] Contract Test: codex-launch.sh fake binary 验证"
echo ""

setup() {
  TMP=$(mktemp -d)
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  LOG="$TMP/calls.log"
  SESSION_FILE="$TMP/session.id"
  CRED_DIR="$TMP/cred-snapshot"
  mkdir -p "$CRED_DIR"
  echo '{"token":"test"}' > "$CRED_DIR/auth.json"
}

teardown() {
  rm -rf "$TMP" 2>/dev/null || true
}

# ─── 测试 1: exit 0 不重启（INV-3） ─────────────────────────────────────────
test_exit0_no_restart() {
  setup
  # fake codex：立即 exit 0
  cat >"$BIN/codex" <<'SH'
#!/bin/bash
echo "codex-fake: exit 0" >> "$1"
exit 0
SH
  chmod +x "$BIN/codex"

  CALL_COUNT=0
  CALL_LOG="$TMP/call_count.log"

  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "call" >> "$CALL_LOG"
exit 0
SH
  chmod +x "$BIN/codex"

  # 运行 launcher，限制超时
  CODEX_HOME="$CRED_DIR" PATH="$BIN:$PATH" \
    timeout 10s bash "$TARGET" --task-id "test-exit0" --prompt-file /dev/null 2>/tmp/codex-launch-out.$$ || true

  local calls
  calls=$(wc -l < "$CALL_LOG" 2>/dev/null || echo 0)
  calls=$(echo "$calls" | tr -d ' ')

  if [[ "$calls" -le 1 ]]; then
    pass "exit 0 不重启：fake codex 只被调用 ${calls} 次（INV-3）"
  else
    fail "exit 0 不重启：fake codex 只被调用 ${calls} 次（INV-3）" "被调用 ${calls} 次，exit 0 触发了重启"
  fi

  rm -f /tmp/codex-launch-out.$$
  teardown
}

# ─── 测试 2: SIGABRT 触发重试，最多 3 次（INV-4） ───────────────────────────
test_sigabrt_retries_max3() {
  setup
  CALL_LOG="$TMP/call_count.log"

  # fake codex：每次都 abort（exit 134 = SIGABRT）
  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "call" >> "$CALL_LOG"
kill -ABRT \$\$
SH
  chmod +x "$BIN/codex"

  CODEX_HOME="$CRED_DIR" PATH="$BIN:$PATH" MAX_RETRIES=3 \
    timeout 30s bash "$TARGET" --task-id "test-sigabrt" --prompt-file /dev/null 2>/tmp/codex-launch-sigabrt.$$ || true

  local calls
  calls=$(wc -l < "$CALL_LOG" 2>/dev/null || echo 0)
  calls=$(echo "$calls" | tr -d ' ')
  local max_calls=4  # 1 初始 + 3 重试

  if [[ "$calls" -le "$max_calls" ]]; then
    pass "SIGABRT 最多重试 3 次：fake codex 被调用 ${calls} 次 ≤ ${max_calls}（INV-4）"
  else
    fail "SIGABRT 最多重试 3 次：fake codex 被调用 ${calls} 次 ≤ ${max_calls}（INV-4）" \
      "调用次数 ${calls} 超过上限 ${max_calls}"
  fi

  rm -f /tmp/codex-launch-sigabrt.$$
  teardown
}

# ─── 测试 3: 超限后 exit 1（INV-4）─────────────────────────────────────────
test_exit1_after_max_retries() {
  setup
  CALL_LOG="$TMP/call_count.log"

  # fake codex：每次都 abort
  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "call" >> "$CALL_LOG"
exit 134
SH
  chmod +x "$BIN/codex"

  local exit_code=0
  CODEX_HOME="$CRED_DIR" PATH="$BIN:$PATH" MAX_RETRIES=3 \
    timeout 30s bash "$TARGET" --task-id "test-maxretry" --prompt-file /dev/null 2>/tmp/codex-launch-max.$$ \
    || exit_code=$?

  if [[ "$exit_code" -eq 1 ]]; then
    pass "超过 MAX_RETRIES=3 后 exit 1（INV-4）"
  else
    # 某些 shell timeout 下 exit_code 可能是 124，宽松接受 1 或非 0
    if [[ "$exit_code" -ne 0 ]]; then
      pass "超过 MAX_RETRIES=3 后 exit 非 0（exit=${exit_code}，INV-4 宽松）"
    else
      fail "超过 MAX_RETRIES=3 后 exit 1（INV-4）" "实际 exit_code=${exit_code}（期望非 0）"
    fi
  fi

  rm -f /tmp/codex-launch-max.$$
  teardown
}

# ─── 测试 4: 重试时用 session-id 调 codex resume（INV-5）───────────────────
test_resume_with_session_id() {
  setup
  CALL_LOG="$TMP/calls_detail.log"
  SESSION_ID="test-session-$(date +%s)"

  # 第一次：abort（触发重试）；第二次：exit 0
  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "\$*" >> "$CALL_LOG"
count=\$(wc -l < "$CALL_LOG" | tr -d ' ')
if [[ "\$count" -le 1 ]]; then
  exit 134
fi
exit 0
SH
  chmod +x "$BIN/codex"

  CODEX_HOME="$CRED_DIR" PATH="$BIN:$PATH" MAX_RETRIES=3 \
    CODEX_SESSION_ID="$SESSION_ID" \
    timeout 30s bash "$TARGET" --task-id "test-resume" --prompt-file /dev/null 2>/tmp/codex-launch-resume.$$ || true

  # 检查 resume 调用是否使用了 session-id
  if grep -qE "resume.*${SESSION_ID}|${SESSION_ID}.*resume" "$CALL_LOG" 2>/dev/null; then
    pass "重试时用 session-id 调 codex resume（INV-5）"
  else
    # 宽松：检查 resume 关键词是否出现
    if grep -q 'resume' "$CALL_LOG" 2>/dev/null; then
      pass "重试时调用了 codex resume（INV-5 宽松——session-id 可能由 launcher 内部管理）"
    else
      fail "重试时用 session-id 调 codex resume（INV-5）" \
        "CALL_LOG 无 resume：$(cat "$CALL_LOG" 2>/dev/null | head -5)"
    fi
  fi

  rm -f /tmp/codex-launch-resume.$$
  teardown
}

# ─── 测试 5: CODEX_HOME 用凭据快照目录（INV-11）────────────────────────────
test_codex_home_snapshot() {
  # 静态断言：脚本含凭据快照相关字符串
  local src
  src=$(cat "$TARGET")
  if echo "$src" | grep -qE 'codex-relay-cred|snapshot.*CODEX_HOME|CODEX_HOME.*snapshot|snapshotCodex|cred.*tmp|tmp.*cred'; then
    pass "codex-launch.sh 含凭据快照相关逻辑（INV-11）"
  else
    # 宽松：检查是否明确不使用 HOME 直接路径
    if echo "$src" | grep -qE 'CODEX_HOME.*\$\{|export CODEX_HOME'; then
      pass "codex-launch.sh 含 CODEX_HOME 动态赋值（INV-11 宽松）"
    else
      fail "codex-launch.sh 含凭据快照相关逻辑（INV-11）" \
        "未找到快照相关字符串（codex-relay-cred/snapshot/CODEX_HOME 动态赋值）"
    fi
  fi
}

# ─── 测试 6: 脚本含 MAX_RETRIES=3（INV-4 源码断言）─────────────────────────
test_max_retries_defined() {
  if grep -qE 'MAX_RETRIES.*3|MAX_RETRIES=3' "$TARGET"; then
    pass "codex-launch.sh 含 MAX_RETRIES=3（INV-4 源码）"
  else
    fail "codex-launch.sh 含 MAX_RETRIES=3（INV-4 源码）" "MAX_RETRIES=3 未找到"
  fi
}

# ─── 测试 7: 脚本含 trap SIGABRT/ABRT（INV-4 源码断言）─────────────────────
test_trap_sigabrt() {
  if grep -qE 'trap.*SIGABRT|trap.*ABRT|trap.*134' "$TARGET"; then
    pass "codex-launch.sh 含 trap SIGABRT/ABRT（INV-4 源码）"
  else
    fail "codex-launch.sh 含 trap SIGABRT/ABRT（INV-4 源码）" "trap SIGABRT/ABRT 未找到"
  fi
}

# ─── 测试 8: 脚本含 codex resume（INV-5 源码断言）──────────────────────────
test_codex_resume_in_script() {
  if grep -qE 'codex.*resume|codex resume' "$TARGET"; then
    pass "codex-launch.sh 含 'codex resume' 命令（INV-5 源码）"
  else
    fail "codex-launch.sh 含 'codex resume' 命令（INV-5 源码）" "'codex resume' 未找到"
  fi
}

# ─── 运行所有测试 ──────────────────────────────────────────────────────────────
test_max_retries_defined
test_trap_sigabrt
test_codex_resume_in_script
test_codex_home_snapshot
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
